// POST /api/agent/conversations/[id]/turn — Append a user follow-up to an
// existing conversation, run the planner against the full history, persist
// the assistant reply, and return the new messages plus updated status.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema, ensureAgentTables } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import { runPlannerTurn, type PlannerHistoryItem } from '@/lib/agent/planner';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Recognize a bare "approve" turn so we can short-circuit the LLM round.
// The planner is instructed to leave an approved plan unchanged, but in
// practice it sometimes re-emits stage titles / step phrasing. Doing this
// server-side makes approval idempotent + saves a turn's worth of tokens.
function isPureApproval(raw: string): boolean {
  const t = raw.toLowerCase().trim().replace(/[.!]+$/, '');
  if (!t || t.length > 40) return false;
  if (t.includes('?')) return false;
  if (/\b(but|however|though|except|change|swap|replace|drop|remove|add(?!.*\bplease\b)|also|instead|smaller|bigger|fewer|more|less|only|just|narrow|broaden|wider|tighter)\b/.test(t)) return false;
  const phrases = new Set([
    'approve','approved','approve it','approve this','approve please',
    'go','go ahead','lets go',"let's go",
    'looks good','looks great','lgtm',
    'run it','run this','run that','run',
    'ship it','ship this','ship',
    'yes','yep','yeah','yup','y',
    'ok','okay','okay go','ok go',
    'sounds good','sounds great','perfect','great',
    'do it','do this',
    'confirm','confirmed','confirm it',
    'proceed','proceed please',
  ]);
  return phrases.has(t);
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureAgentTables().catch(() => undefined);
    const body = await request.json().catch(() => ({}));
    const message = (body.message as string | undefined)?.trim();
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    const modelOverride = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

    const [conversation] = await db
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, params.id))
      .limit(1);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    if (conversation.status === 'cancelled' || conversation.status === 'complete') {
      return NextResponse.json(
        { error: `Conversation is ${conversation.status}; cannot accept new turns. Start a new conversation.` },
        { status: 400 },
      );
    }

    const now = new Date();
    const userMsgId = `msg_${generateId()}`;
    await db.insert(schema.agentMessages).values({
      id: userMsgId,
      conversationId: conversation.id,
      role: 'user',
      content: message,
      planJson: null,
      toolName: null,
      toolArgs: null,
      toolResult: null,
      createdAt: now,
    });

    // Short-circuit: pure approval keywords on a conversation that already
    // has a plan in planning|awaiting_approval|previewing — skip the LLM
    // round entirely. Without this the planner sometimes re-edits stage
    // titles on "approve" even though its system prompt says not to.
    if (
      isPureApproval(message) &&
      conversation.planJson &&
      (conversation.status === 'planning' ||
        conversation.status === 'awaiting_approval' ||
        conversation.status === 'previewing')
    ) {
      const assistantMsgId = `msg_${generateId()}`;
      const assistantNow = new Date();
      const assistantText =
        'Plan approved. Run preview to see how many matches we expect, then launch when you\'re happy with the count.';
      await db.insert(schema.agentMessages).values({
        id: assistantMsgId,
        conversationId: conversation.id,
        role: 'assistant',
        content: assistantText,
        planJson: null,
        toolName: null,
        toolArgs: null,
        toolResult: null,
        createdAt: assistantNow,
      });
      await db
        .update(schema.agentConversations)
        .set({ status: 'awaiting_approval', updatedAt: assistantNow })
        .where(eq(schema.agentConversations.id, conversation.id));
      return NextResponse.json({
        conversationId: conversation.id,
        status: 'awaiting_approval',
        nextAction: 'awaiting_approval',
        planJson: conversation.planJson,
        clarifyingQuestions: [],
        messages: [
          { id: userMsgId, role: 'user', content: message, createdAt: now.toISOString() },
          {
            id: assistantMsgId,
            role: 'assistant',
            content: assistantText,
            planJson: null,
            createdAt: assistantNow.toISOString(),
          },
        ],
      });
    }

    // Pull the full thread (now including the just-inserted user msg).
    const messages = await db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.conversationId, conversation.id))
      .orderBy(asc(schema.agentMessages.createdAt));

    const history: PlannerHistoryItem[] = messages.map(m => ({
      role: m.role,
      content: m.content,
      planJson: m.planJson ?? undefined,
    }));

    let planner;
    try {
      planner = await runPlannerTurn({ history, model: modelOverride });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[agent/turn] planner failed:', errMsg);
      return NextResponse.json({ error: `Planner failed: ${errMsg}` }, { status: 500 });
    }

    const assistantMsgId = `msg_${generateId()}`;
    const assistantNow = new Date();
    await db.insert(schema.agentMessages).values({
      id: assistantMsgId,
      conversationId: conversation.id,
      role: 'assistant',
      content: planner.assistantText,
      planJson: planner.planJson ?? null,
      toolName: null,
      toolArgs: null,
      toolResult: null,
      createdAt: assistantNow,
    });

    // Convert planner.nextAction to a conversation status. Keep `running` /
    // `complete` if the campaign has already launched — the user can still
    // chat about the running campaign without us reverting status.
    let newStatus: typeof conversation.status = conversation.status;
    if (conversation.status === 'planning' || conversation.status === 'awaiting_approval' || conversation.status === 'previewing') {
      if (planner.nextAction === 'awaiting_approval') {
        newStatus = 'awaiting_approval';
      } else if (planner.nextAction === 'await_user_reply') {
        newStatus = 'planning';
      }
    }

    await db
      .update(schema.agentConversations)
      .set({
        status: newStatus,
        // Only overwrite the persisted plan if the planner produced a fresh one.
        ...(planner.planJson ? { planJson: planner.planJson } : {}),
        updatedAt: assistantNow,
      })
      .where(eq(schema.agentConversations.id, conversation.id));

    return NextResponse.json({
      conversationId: conversation.id,
      status: newStatus,
      nextAction: planner.nextAction,
      planJson: planner.planJson ?? conversation.planJson ?? null,
      clarifyingQuestions: planner.clarifyingQuestions ?? [],
      messages: [
        { id: userMsgId, role: 'user', content: message, createdAt: now.toISOString() },
        {
          id: assistantMsgId,
          role: 'assistant',
          content: planner.assistantText,
          planJson: planner.planJson ?? null,
          createdAt: assistantNow.toISOString(),
        },
      ],
    });
  } catch (error) {
    console.error('[agent/turn] error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to process turn';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
