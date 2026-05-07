import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CampaignStep } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

// GET /api/campaigns/[id] — Get campaign status
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [campaign] = await db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.id, params.id)).limit(1);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const steps = campaign.steps as CampaignStep[];
    const completedSteps = steps.filter(s => s.status === 'complete').length;
    const currentStep = steps[campaign.currentStepIndex];
    const errorSteps = steps.filter(s => s.status === 'error');

    // Build results summary from completed steps
    const results: Record<string, unknown> = {};
    for (const step of steps) {
      if (step.result) {
        if (step.type === 'search_companies') results.companiesFound = step.result.totalCount;
        if (step.type === 'search_people') results.peopleFound = step.result.totalCount;
        if (step.type === 'import_rows') results[`${step.params.sheet || 'sheet'}_rows`] = step.result.rowCount;
        if (step.type === 'find_emails') {
          results.emailsProcessed = step.result.processedCount;
          results.emailsFound = step.result.foundCount;
        }
        if (step.type === 'filter_rows' || step.type === 'cleanup') {
          results.rowsRemoved = ((results.rowsRemoved as number) || 0) + (step.result.removed as number || 0);
        }
      }
    }

    // Get final table ID
    const context = campaign.context as Record<string, unknown> | null;
    const sheets = (context?.sheets || {}) as Record<string, { tableId: string }>;
    const sheetNames = Object.keys(sheets);
    const lastSheet = sheetNames.length > 0 ? sheets[sheetNames[sheetNames.length - 1]] : null;
    if (lastSheet) results.exportTableId = lastSheet.tableId;
    if (campaign.workbookId) results.workbookId = campaign.workbookId;

    return NextResponse.json({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      workbookId: campaign.workbookId,
      progress: {
        currentStep: campaign.currentStepIndex + 1,
        totalSteps: steps.length,
        completedSteps,
        currentStepType: currentStep?.type || null,
        currentStepStatus: currentStep?.status || null,
      },
      steps: steps.map((s, i) => ({
        step: i + 1,
        type: s.type,
        status: s.status,
        result: s.result || null,
        error: s.error || null,
        startedAt: s.startedAt || null,
        completedAt: s.completedAt || null,
      })),
      results,
      errors: errorSteps.length > 0 ? errorSteps.map(s => ({ type: s.type, error: s.error })) : null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
      completedAt: campaign.completedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    return NextResponse.json({ error: 'Failed to fetch campaign' }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id] — Cancel a campaign
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [campaign] = await db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.id, params.id)).limit(1);

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.status === 'complete' || campaign.status === 'cancelled') {
      return NextResponse.json({ error: `Campaign already ${campaign.status}` }, { status: 400 });
    }

    await db.update(schema.campaigns).set({
      status: 'cancelled',
      updatedAt: new Date(),
    }).where(eq(schema.campaigns.id, params.id));

    return NextResponse.json({ success: true, message: 'Campaign cancelled' });
  } catch (error) {
    console.error('Error cancelling campaign:', error);
    return NextResponse.json({ error: 'Failed to cancel campaign' }, { status: 500 });
  }
}

// POST /api/campaigns/[id] — Retry a failed campaign. Resets the errored
// step to 'pending', clears the error, flips status back to 'running'
// so the cron picks it up on the next tick.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = (body.action as string | undefined) || 'retry';

    if (action !== 'retry') {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const [campaign] = await db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.id, params.id)).limit(1);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    if (campaign.status !== 'error') {
      return NextResponse.json(
        { error: `Can only retry errored campaigns; this one is ${campaign.status}` },
        { status: 400 },
      );
    }

    const steps = campaign.steps as CampaignStep[];
    // Reset the first errored step (and any subsequent error/skipped) to pending.
    let resetCount = 0;
    let firstErrorIndex = -1;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].status === 'error' || steps[i].status === 'skipped') {
        if (firstErrorIndex === -1) firstErrorIndex = i;
        steps[i] = {
          ...steps[i],
          status: 'pending',
          error: undefined,
          startedAt: undefined,
          completedAt: undefined,
        };
        resetCount++;
      }
    }
    // Also reset any 'running' step that got stuck — shouldn't happen normally
    // but if maxDuration hit we want to retry it cleanly.
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].status === 'running') {
        steps[i] = { ...steps[i], status: 'pending', startedAt: undefined };
        if (firstErrorIndex === -1) firstErrorIndex = i;
      }
    }

    if (resetCount === 0) {
      return NextResponse.json(
        { error: 'Campaign has no errored steps to retry' },
        { status: 400 },
      );
    }

    await db.update(schema.campaigns).set({
      status: 'running',
      currentStepIndex: firstErrorIndex >= 0 ? firstErrorIndex : campaign.currentStepIndex,
      steps,
      error: null,
      updatedAt: new Date(),
    }).where(eq(schema.campaigns.id, params.id));

    return NextResponse.json({
      success: true,
      message: `Reset ${resetCount} step(s); campaign back to running. Cron will resume on next tick.`,
      resumingAtStep: (firstErrorIndex >= 0 ? firstErrorIndex : campaign.currentStepIndex) + 1,
    });
  } catch (error) {
    console.error('Error retrying campaign:', error);
    const msg = error instanceof Error ? error.message : 'Failed to retry campaign';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
