// GET    /api/agent/conversations/[id] — return the conversation, its full
//        message thread, and (if launched) a snapshot of the linked campaign.
// DELETE /api/agent/conversations/[id] — delete the conversation and its
//        messages. If a campaign is linked and still running, cancel it
//        first so cron stops advancing it.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema, ensureAgentTables } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import type { CampaignStep } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureAgentTables().catch(() => undefined);
    const [conversation] = await db
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, params.id))
      .limit(1);

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = await db
      .select()
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.conversationId, conversation.id))
      .orderBy(asc(schema.agentMessages.createdAt));

    let campaignSnapshot: Record<string, unknown> | null = null;
    if (conversation.campaignId) {
      const [campaign] = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, conversation.campaignId))
        .limit(1);
      if (campaign) {
        const steps = campaign.steps as CampaignStep[];
        const completedSteps = steps.filter(s => s.status === 'complete').length;
        campaignSnapshot = {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          workbookId: campaign.workbookId,
          progress: {
            currentStep: campaign.currentStepIndex + 1,
            totalSteps: steps.length,
            completedSteps,
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
          createdAt: campaign.createdAt.toISOString(),
          completedAt: campaign.completedAt?.toISOString() || null,
        };
      }
    }

    // If a workbook is attached, fetch its name + sheet count so the client
    // can render a meaningful chip without a second roundtrip.
    let attachedWorkbookName: string | null = null;
    let attachedWorkbookSheetCount = 0;
    if (conversation.attachedWorkbookId) {
      const [wb] = await db.select().from(schema.projects)
        .where(eq(schema.projects.id, conversation.attachedWorkbookId)).limit(1);
      if (wb) {
        attachedWorkbookName = wb.name;
        const tables = await db.select().from(schema.tables)
          .where(eq(schema.tables.projectId, wb.id));
        attachedWorkbookSheetCount = tables.length;
      }
    }

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        initialPrompt: conversation.initialPrompt,
        campaignId: conversation.campaignId,
        planJson: conversation.planJson,
        attachedWorkbookId: conversation.attachedWorkbookId,
        attachedWorkbookName,
        attachedWorkbookSheetCount,
        attachedCsv: conversation.attachedCsv,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        planJson: m.planJson,
        toolName: m.toolName,
        toolArgs: m.toolArgs,
        toolResult: m.toolResult,
        createdAt: m.createdAt.toISOString(),
      })),
      campaign: campaignSnapshot,
    });
  } catch (error) {
    console.error('[agent/conversations/:id] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch conversation' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureAgentTables().catch(() => undefined);

    const [conversation] = await db
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, params.id))
      .limit(1);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // If a campaign is linked and still running, cancel it so the cron stops
    // advancing it. We don't delete the campaign itself — keeping the row
    // preserves audit history and the workbook it produced.
    let cancelledCampaign = false;
    if (conversation.campaignId) {
      const [campaign] = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, conversation.campaignId))
        .limit(1);
      if (campaign && (campaign.status === 'running' || campaign.status === 'pending')) {
        await db
          .update(schema.campaigns)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(schema.campaigns.id, conversation.campaignId));
        cancelledCampaign = true;
      }
    }

    // Cascade delete: messages first (FK constraint), then the conversation.
    await db
      .delete(schema.agentMessages)
      .where(eq(schema.agentMessages.conversationId, conversation.id));
    await db
      .delete(schema.agentConversations)
      .where(eq(schema.agentConversations.id, conversation.id));

    return NextResponse.json({ success: true, cancelledCampaign });
  } catch (error) {
    console.error('[agent/conversations/:id] DELETE error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to delete';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
