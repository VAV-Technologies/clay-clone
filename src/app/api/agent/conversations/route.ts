// POST /api/agent/conversations — Create a new conversation, persist the
//   user's first message, run one planner turn, persist the assistant
//   reply (including any structured plan), return the conversation +
//   messages.
//
// GET /api/agent/conversations — List conversations for the sidebar.
//
// Note: there is no auth in this app — these endpoints are open in the
// same way the rest of /api/* is. The bearer-auth middleware (if any
// is added later) should allow these or require the standard token.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema, ensureAgentTables } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import { runPlannerTurn, deriveTitle } from '@/lib/agent/planner';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    // Defensive: guarantees the agent tables exist on Turso before the first
    // insert of a freshly-deployed instance can race against the migration.
    try {
      await ensureAgentTables();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'unknown';
      console.error('[agent/conversations] ensureAgentTables failed:', errMsg);
      return NextResponse.json(
        { error: `Database not ready: ${errMsg}` },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const prompt = (body.prompt as string | undefined)?.trim();
    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const now = new Date();
    const conversationId = `conv_${generateId()}`;
    const userMsgId = `msg_${generateId()}`;
    const title = deriveTitle(prompt);

    // Insert conversation + user message first so they're persisted even if
    // the planner call fails.
    await db.insert(schema.agentConversations).values({
      id: conversationId,
      title,
      status: 'planning',
      initialPrompt: prompt,
      campaignId: null,
      planJson: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.agentMessages).values({
      id: userMsgId,
      conversationId,
      role: 'user',
      content: prompt,
      planJson: null,
      toolName: null,
      toolArgs: null,
      toolResult: null,
      createdAt: now,
    });

    // Run the planner turn
    let planner;
    try {
      planner = await runPlannerTurn({
        history: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[agent/conversations] planner failed:', errMsg);
      // Still return the conversation so the user can retry from the chat page.
      await db
        .update(schema.agentConversations)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(schema.agentConversations.id, conversationId));
      return NextResponse.json(
        {
          conversationId,
          error: `Planner failed: ${errMsg}`,
          messages: [{ id: userMsgId, role: 'user', content: prompt, createdAt: now.toISOString() }],
        },
        { status: 500 },
      );
    }

    const assistantMsgId = `msg_${generateId()}`;
    const assistantNow = new Date();
    await db.insert(schema.agentMessages).values({
      id: assistantMsgId,
      conversationId,
      role: 'assistant',
      content: planner.assistantText,
      planJson: planner.planJson ?? null,
      toolName: null,
      toolArgs: null,
      toolResult: null,
      createdAt: assistantNow,
    });

    // Update conversation: store the latest plan, advance status if approval-ready.
    await db
      .update(schema.agentConversations)
      .set({
        status: planner.nextAction === 'awaiting_approval' ? 'awaiting_approval' : 'planning',
        planJson: planner.planJson ?? null,
        updatedAt: assistantNow,
      })
      .where(eq(schema.agentConversations.id, conversationId));

    return NextResponse.json(
      {
        conversationId,
        title,
        status: planner.nextAction === 'awaiting_approval' ? 'awaiting_approval' : 'planning',
        nextAction: planner.nextAction,
        planJson: planner.planJson ?? null,
        clarifyingQuestions: planner.clarifyingQuestions ?? [],
        messages: [
          { id: userMsgId, role: 'user', content: prompt, createdAt: now.toISOString() },
          {
            id: assistantMsgId,
            role: 'assistant',
            content: planner.assistantText,
            planJson: planner.planJson ?? null,
            createdAt: assistantNow.toISOString(),
          },
        ],
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[agent/conversations] POST error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to create conversation';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    await ensureAgentTables().catch(() => undefined); // silent — empty list is fine if it fails
    const rows = await db
      .select()
      .from(schema.agentConversations)
      .orderBy(desc(schema.agentConversations.updatedAt))
      .limit(200);

    return NextResponse.json({
      conversations: rows.map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        campaignId: r.campaignId,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[agent/conversations] GET error:', error);
    return NextResponse.json({ error: 'Failed to list conversations' }, { status: 500 });
  }
}

