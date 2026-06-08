import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, sql } from 'drizzle-orm';
import { executeStep } from '@/lib/campaign-executor';
import type { CampaignStep, CampaignContext } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — enough for search steps

// GET /api/cron/process-campaigns — Advance running campaigns
export async function GET() {
  try {
    const runningCampaigns = await db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.status, 'running'));

    if (runningCampaigns.length === 0) {
      return NextResponse.json({ message: 'No active campaigns' });
    }

    const results: Array<{ id: string; action: string }> = [];

    for (const campaign of runningCampaigns) {
      const steps = campaign.steps as CampaignStep[];
      const context = (campaign.context || { sheets: {} }) as CampaignContext;
      const stepIndex = campaign.currentStepIndex;

      // Check if all steps are done
      if (stepIndex >= steps.length) {
        await db.update(schema.campaigns).set({
          status: 'complete',
          updatedAt: new Date(),
          completedAt: new Date(),
        }).where(eq(schema.campaigns.id, campaign.id));
        results.push({ id: campaign.id, action: 'completed' });
        continue;
      }

      const currentStep = steps[stepIndex];

      // If step is already running, skip (it was started by a previous cron tick or the POST handler)
      // Long-running steps (find_emails, enrich) may have been kicked off already
      if (currentStep.status === 'running') {
        results.push({ id: campaign.id, action: `step ${stepIndex + 1} still running (${currentStep.type})` });
        continue;
      }

      // If step is already complete, advance — guarded by a compare-and-set on
      // currentStepIndex so two concurrent ticks can't both advance (skipping a
      // step). Only the tick that still sees the old index wins (QA finding D-004).
      if (currentStep.status === 'complete') {
        const nextIndex = stepIndex + 1;
        const isLast = nextIndex >= steps.length;
        const advanced = await db.update(schema.campaigns).set({
          currentStepIndex: nextIndex,
          status: isLast ? 'complete' : 'running',
          completedAt: isLast ? new Date() : null,
          updatedAt: new Date(),
        }).where(and(
          eq(schema.campaigns.id, campaign.id),
          eq(schema.campaigns.currentStepIndex, stepIndex)
        )).returning({ id: schema.campaigns.id });
        results.push({
          id: campaign.id,
          action: advanced.length === 0
            ? 'advance lost race, skipping'
            : (isLast ? 'completed' : `advanced to step ${nextIndex + 1}`),
        });
        continue;
      }

      // Atomically claim this pending step before executing: flip its JSON
      // status pending->running ONLY if it is still pending. If a concurrent
      // tick already claimed it, this matches 0 rows and we skip — preventing
      // double-execution of the same step (QA finding D-004). Using a conditional
      // json_set/json_extract (not an updatedAt CAS) avoids same-second races.
      const stepPath = `$[${stepIndex}].status`;
      const claimed = (await db.all(sql`
        UPDATE campaigns
        SET steps = json_set(steps, ${stepPath}, 'running'),
            updated_at = ${Math.floor(Date.now() / 1000)}
        WHERE id = ${campaign.id}
          AND json_extract(steps, ${stepPath}) = 'pending'
        RETURNING id
      `)) as unknown[];
      if (claimed.length === 0) {
        results.push({ id: campaign.id, action: `step ${stepIndex + 1} claimed by another tick, skipping` });
        continue;
      }

      // Execute the pending step (we now exclusively own it)
      try {
        currentStep.status = 'running';
        currentStep.startedAt = new Date().toISOString();

        console.log(`[campaign:${campaign.id}] Executing step ${stepIndex + 1}/${steps.length}: ${currentStep.type}`);

        const { result, contextUpdate } = await executeStep(currentStep, context, campaign.id);

        currentStep.status = 'complete';
        currentStep.result = result;
        currentStep.completedAt = new Date().toISOString();

        const updatedContext = { ...context, ...contextUpdate };
        const nextIndex = stepIndex + 1;
        const isLastStep = nextIndex >= steps.length;

        await db.update(schema.campaigns).set({
          steps,
          currentStepIndex: nextIndex,
          context: updatedContext,
          workbookId: updatedContext.workbookId || campaign.workbookId,
          status: isLastStep ? 'complete' : 'running',
          completedAt: isLastStep ? new Date() : null,
          updatedAt: new Date(),
        }).where(eq(schema.campaigns.id, campaign.id));

        results.push({
          id: campaign.id,
          action: isLastStep
            ? `completed (all ${steps.length} steps done)`
            : `step ${stepIndex + 1} complete (${currentStep.type}), advancing to ${nextIndex + 1}`,
        });
      } catch (stepError) {
        const errorMsg = stepError instanceof Error ? stepError.message : 'Unknown error';
        console.error(`[campaign:${campaign.id}] Step ${stepIndex + 1} failed:`, errorMsg);

        currentStep.status = 'error';
        currentStep.error = errorMsg;

        await db.update(schema.campaigns).set({
          steps,
          status: 'error',
          error: `Step ${stepIndex + 1} (${currentStep.type}) failed: ${errorMsg}`,
          updatedAt: new Date(),
        }).where(eq(schema.campaigns.id, campaign.id));

        results.push({ id: campaign.id, action: `error at step ${stepIndex + 1}: ${errorMsg}` });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error('Error processing campaigns:', error);
    return NextResponse.json({ error: 'Failed to process campaigns' }, { status: 500 });
  }
}
