// POST /api/agent/conversations/[id]/preview — Run a search-count preview for
// the first search step in the conversation's current plan. The frontend uses
// this to show "Found ~N matches — how many do you want to fetch?" before
// launching the campaign.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CampaignPlan } from '@/lib/agent/plan-schema';
import { findFirstSearchStep, validatePlan } from '@/lib/agent/plan-schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function internalBaseUrl(req: NextRequest): string {
  return process.env.APP_URL || req.nextUrl.origin;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [conversation] = await db
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, params.id))
      .limit(1);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (!conversation.planJson) {
      return NextResponse.json(
        { error: 'No plan attached to this conversation. Ask the agent to draft a plan first.' },
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
    const plan: CampaignPlan = validated.plan;

    const firstSearch = findFirstSearchStep(plan);
    if (!firstSearch) {
      return NextResponse.json(
        { error: 'Plan has no search step — nothing to preview.' },
        { status: 400 },
      );
    }

    const filters = (firstSearch.params.filters as Record<string, unknown>) || {};
    const searchType = firstSearch.type === 'search_companies' ? 'companies' : 'people';

    // The planner emits Clay-shaped filters (country_names, sizes,
    // minimum_member_count, seniority_levels, job_title_keywords/mode).
    // AI Ark uses a different schema (accountLocation, employeeSize:[{start,end}],
    // seniority, titleKeywords/titleMode) — sending Clay fields to AI Ark
    // returns the unfiltered ~70M-row database count. Until we add proper
    // filter translation, force Clay regardless of plan.source. The
    // campaign-executor calls Clay anyway, so this also makes preview
    // counts match the real list size.
    if (plan.source !== 'clay') {
      console.warn(
        `[agent/preview] plan.source="${plan.source}" but planner emits Clay filters — forcing Clay preview`,
      );
    }
    const previewPath = '/api/add-data/preview';

    const res = await fetch(`${internalBaseUrl(request)}${previewPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DATAFLOW_API_KEY}`,
      },
      body: JSON.stringify({ searchType, filters }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Preview failed: ${res.status} ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const data = await res.json();

    // Persist a "previewing" status so the UI knows we're past plan stage.
    await db
      .update(schema.agentConversations)
      .set({ status: 'previewing', updatedAt: new Date() })
      .where(eq(schema.agentConversations.id, conversation.id));

    return NextResponse.json({
      conversationId: conversation.id,
      status: 'previewing',
      searchType: data.searchType,
      estimatedTotal: data.estimatedTotal ?? data.totalCount ?? null,
      preview: data.preview ?? data.sample ?? [],
      previewCount: data.previewCount ?? (Array.isArray(data.preview) ? data.preview.length : 0),
      source: plan.source,
    });
  } catch (error) {
    console.error('[agent/preview] error:', error);
    const msg = error instanceof Error ? error.message : 'Preview failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
