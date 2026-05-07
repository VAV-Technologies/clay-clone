// GET /api/agent/conversations/[id] — return the conversation, its full
// message thread, and (if launched) a snapshot of the linked campaign.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import type { CampaignStep } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
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

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        initialPrompt: conversation.initialPrompt,
        campaignId: conversation.campaignId,
        planJson: conversation.planJson,
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
