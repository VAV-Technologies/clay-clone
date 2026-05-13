import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import { executeStep } from '@/lib/campaign-executor';
import type { CampaignStep, CampaignContext } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/campaigns — Create and start a campaign
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, steps: rawSteps } = body as { name: string; steps: CampaignStep[] };

    if (!name || !rawSteps || !Array.isArray(rawSteps) || rawSteps.length === 0) {
      return NextResponse.json({ error: 'name and steps[] are required' }, { status: 400 });
    }

    // Initialize all steps as pending
    const steps: CampaignStep[] = rawSteps.map(s => ({
      ...s,
      status: 'pending' as const,
      result: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
    }));

    // Auto-prepend create_workbook ONLY when the campaign is building
    // fresh data and the caller forgot the first step. Skip when the plan
    // already opens with create_workbook OR with use_existing_workbook —
    // the latter binds an existing workbook, so prepending would leave an
    // orphan empty workbook in the projects list.
    const firstType = steps[0].type;
    if (firstType !== 'create_workbook' && firstType !== 'use_existing_workbook') {
      steps.unshift({
        type: 'create_workbook',
        params: { name },
        status: 'pending',
      });
    }

    const now = new Date();
    const campaignId = `camp_${generateId()}`;
    const context: CampaignContext = { sheets: {} };

    // Insert campaign
    await db.insert(schema.campaigns).values({
      id: campaignId,
      name,
      status: 'running',
      steps,
      currentStepIndex: 0,
      context,
      createdAt: now,
      updatedAt: now,
    });

    // Execute first step immediately (create_workbook is instant)
    try {
      steps[0].status = 'running';
      steps[0].startedAt = new Date().toISOString();

      const { result, contextUpdate } = await executeStep(steps[0], context, campaignId);

      steps[0].status = 'complete';
      steps[0].result = result;
      steps[0].completedAt = new Date().toISOString();

      const updatedContext = { ...context, ...contextUpdate };

      await db.update(schema.campaigns).set({
        steps,
        currentStepIndex: 1,
        context: updatedContext,
        workbookId: updatedContext.workbookId || null,
        updatedAt: new Date(),
      }).where(eq(schema.campaigns.id, campaignId));

      return NextResponse.json({
        id: campaignId,
        name,
        status: 'running',
        workbookId: updatedContext.workbookId,
        currentStep: 2,
        totalSteps: steps.length,
        message: `Campaign started. ${steps.length - 1} steps remaining. Check progress: GET /api/campaigns/${campaignId}`,
      }, { status: 201 });
    } catch (stepError) {
      const errorMsg = stepError instanceof Error ? stepError.message : 'Unknown error';
      steps[0].status = 'error';
      steps[0].error = errorMsg;

      await db.update(schema.campaigns).set({
        steps,
        status: 'error',
        error: `Step 1 failed: ${errorMsg}`,
        updatedAt: new Date(),
      }).where(eq(schema.campaigns.id, campaignId));

      return NextResponse.json({
        id: campaignId,
        status: 'error',
        error: `Step 1 failed: ${errorMsg}`,
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error creating campaign:', error);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}

// GET /api/campaigns — List all campaigns
export async function GET() {
  try {
    const allCampaigns = await db.select().from(schema.campaigns);

    const summary = allCampaigns.map(c => {
      const steps = c.steps as CampaignStep[];
      const completedSteps = steps.filter(s => s.status === 'complete').length;
      const currentStep = steps[c.currentStepIndex];

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        workbookId: c.workbookId,
        progress: `${completedSteps}/${steps.length} steps`,
        currentStep: currentStep ? { type: currentStep.type, status: currentStep.status } : null,
        createdAt: c.createdAt.toISOString(),
        completedAt: c.completedAt?.toISOString() || null,
      };
    });

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error listing campaigns:', error);
    return NextResponse.json({ error: 'Failed to list campaigns' }, { status: 500 });
  }
}
