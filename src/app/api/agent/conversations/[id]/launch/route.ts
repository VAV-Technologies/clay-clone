// POST /api/agent/conversations/[id]/launch — Take the conversation's stored
// plan, apply an optional confirmed search-result limit, POST it as a fresh
// /api/campaigns campaign, link the resulting campaign back to the
// conversation, transition the conversation to "running".

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  applySearchLimit,
  flattenPlanToSteps,
  validatePlan,
} from '@/lib/agent/plan-schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function internalBaseUrl(req: NextRequest): string {
  return process.env.APP_URL || req.nextUrl.origin;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const confirmedLimit =
      typeof body.confirmedLimit === 'number' && body.confirmedLimit > 0
        ? Math.floor(body.confirmedLimit)
        : undefined;

    const [conversation] = await db
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, params.id))
      .limit(1);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (conversation.campaignId) {
      return NextResponse.json(
        { error: `Conversation already launched as campaign ${conversation.campaignId}` },
        { status: 400 },
      );
    }
    if (!conversation.planJson) {
      return NextResponse.json(
        { error: 'No plan attached. Ask the agent to draft a plan, then approve it before launching.' },
        { status: 400 },
      );
    }

    const validated = validatePlan(conversation.planJson);
    if (!validated.valid) {
      return NextResponse.json(
        { error: `Stored plan is invalid: ${validated.error}` },
        { status: 400 },
      );
    }
    let plan = validated.plan;

    if (confirmedLimit !== undefined) {
      plan = applySearchLimit(plan, confirmedLimit);
    }

    const steps = flattenPlanToSteps(plan);
    if (steps.length === 0) {
      return NextResponse.json({ error: 'Plan has no steps to execute' }, { status: 400 });
    }

    // Stamp the plan's data source onto every search step so the executor
    // can dispatch search_companies / search_people to the right API
    // (Clay vs AI Ark). Filter shapes differ between sources, so the step
    // carrying its source alongside its filters is the cleanest contract.
    for (const s of steps) {
      if (s.type === 'search_companies' || s.type === 'search_people') {
        s.params = { ...s.params, source: plan.source };
      }
    }

    // For import_csv steps, substitute "__PLACEHOLDER__" data with the
    // conversation's attachedCsv.rows. The planner uses the placeholder so
    // it doesn't have to embed the entire CSV in planJson.
    for (const s of steps) {
      if (s.type === 'import_csv' && s.params.data === '__PLACEHOLDER__') {
        if (!conversation.attachedCsv) {
          return NextResponse.json(
            { error: 'Plan contains import_csv with placeholder data but no CSV is attached to the conversation.' },
            { status: 400 },
          );
        }
        s.params = { ...s.params, data: conversation.attachedCsv.rows };
      }
    }

    const campaignsRes = await fetch(`${internalBaseUrl(request)}/api/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DATAFLOW_API_KEY}`,
      },
      body: JSON.stringify({ name: plan.name, steps }),
    });

    if (!campaignsRes.ok) {
      const text = await campaignsRes.text().catch(() => '');
      return NextResponse.json(
        { error: `Campaign launch failed: ${campaignsRes.status} ${text.slice(0, 400)}` },
        { status: 502 },
      );
    }

    const campaign = await campaignsRes.json();
    const campaignId = campaign.id as string;

    const now = new Date();
    await db
      .update(schema.agentConversations)
      .set({
        campaignId,
        status: 'running',
        // Persist the limit-adjusted plan so subsequent reads see what was actually launched.
        planJson: plan,
        updatedAt: now,
      })
      .where(eq(schema.agentConversations.id, conversation.id));

    return NextResponse.json({
      conversationId: conversation.id,
      campaignId,
      status: 'running',
      workbookId: campaign.workbookId ?? null,
      totalSteps: campaign.totalSteps ?? steps.length,
      message: campaign.message ?? 'Campaign launched. The cron processor will advance it step by step.',
    });
  } catch (error) {
    console.error('[agent/launch] error:', error);
    const msg = error instanceof Error ? error.message : 'Launch failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
