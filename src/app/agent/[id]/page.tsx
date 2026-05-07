'use client';

// /agent/[id] — Campaign Builder chat page.
// Sidebar + thread + plan card + preview gate + live campaign progress.
// Polls /api/campaigns/[id] every 5s when a campaign is running so the user
// sees step-by-step progress without WebSockets.

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Plus,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { ToastProvider, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then(m => m.AnimatedBackground),
  { ssr: false },
);

// ── Types mirroring the API response shapes ───────────────────────────────────

interface ConversationListItem {
  id: string;
  title: string;
  status: string;
  campaignId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PlanStep { type: string; params?: Record<string, unknown> }
interface PlanStage {
  title: string;
  summary: string;
  notes?: string[];
  steps: PlanStep[];
}
interface CampaignPlan {
  name: string;
  rationale: string;
  source: 'ai-ark' | 'clay';
  stages: PlanStage[];
}

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  planJson: CampaignPlan | null;
  createdAt: string;
}

interface CampaignStepSnapshot {
  step: number;
  type: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface CampaignSnapshot {
  id: string;
  name: string;
  status: string;
  workbookId: string | null;
  progress: { currentStep: number; totalSteps: number; completedSteps: number };
  steps: CampaignStepSnapshot[];
  createdAt: string;
  completedAt: string | null;
}

interface ConversationResponse {
  conversation: {
    id: string;
    title: string;
    status: string;
    initialPrompt: string;
    campaignId: string | null;
    planJson: CampaignPlan | null;
    createdAt: string;
    updatedAt: string;
  };
  messages: AgentMessage[];
  campaign: CampaignSnapshot | null;
}

interface PreviewResponse {
  estimatedTotal: number | null;
  preview: unknown[];
  previewCount: number;
  source: 'ai-ark' | 'clay';
}

// ── The chat page ─────────────────────────────────────────────────────────────

function AgentChatPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params?.id;
  const router = useRouter();
  const toast = useToast();

  const [conversation, setConversation] = useState<ConversationResponse['conversation'] | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [campaign, setCampaign] = useState<CampaignSnapshot | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [previewState, setPreviewState] = useState<{
    loading: boolean;
    data: PreviewResponse | null;
  }>({ loading: false, data: null });
  const [chosenLimit, setChosenLimit] = useState<number | null>(null);
  const [launching, setLaunching] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);

  const fetchConversation = useCallback(async () => {
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/agent/conversations/${conversationId}`);
      if (!res.ok) {
        toast.error('Failed to load conversation');
        return;
      }
      const data: ConversationResponse = await res.json();
      setConversation(data.conversation);
      setMessages(data.messages);
      setCampaign(data.campaign);
    } catch {
      toast.error('Failed to load conversation');
    } finally {
      setLoading(false);
    }
  }, [conversationId, toast]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/conversations');
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      // Silent — sidebar is non-critical
    }
  }, []);

  useEffect(() => {
    fetchConversation();
    fetchConversations();
  }, [fetchConversation, fetchConversations]);

  // Auto-scroll thread to bottom when messages change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, campaign]);

  // Poll the linked campaign every 5s while it's running.
  useEffect(() => {
    if (!campaign || !conversation?.campaignId) return;
    if (campaign.status !== 'running' && campaign.status !== 'pending') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/${conversation.campaignId}`);
        if (!res.ok) return;
        const data = await res.json();
        // Map the raw /api/campaigns response into our snapshot shape
        setCampaign({
          id: data.id,
          name: data.name,
          status: data.status,
          workbookId: data.workbookId,
          progress: data.progress,
          steps: data.steps || [],
          createdAt: data.createdAt,
          completedAt: data.completedAt,
        });
        if (data.status === 'complete' || data.status === 'error' || data.status === 'cancelled') {
          // Refresh conversation status too
          fetchConversation();
        }
      } catch {
        // ignore — keep polling
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [campaign, conversation?.campaignId, fetchConversation]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');
    // Optimistic user message
    setMessages(prev => [
      ...prev,
      {
        id: `tmp_${Date.now()}`,
        role: 'user',
        content: text,
        planJson: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await fetch(`/api/agent/conversations/${conversationId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Agent failed to reply');
      }
      // Refresh from server (handles message IDs and any plan changes)
      await fetchConversation();
      await fetchConversations();
    } catch {
      toast.error('Network error');
    } finally {
      setSending(false);
    }
  };

  const runPreview = async () => {
    if (!conversationId || previewState.loading) return;
    setPreviewState({ loading: true, data: null });
    try {
      const res = await fetch(`/api/agent/conversations/${conversationId}/preview`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Preview failed');
        setPreviewState({ loading: false, data: null });
        return;
      }
      setPreviewState({ loading: false, data });
      // Set a sensible default limit
      const total = data.estimatedTotal as number | null;
      if (total != null) {
        if (total <= 100) setChosenLimit(total);
        else if (total <= 1000) setChosenLimit(Math.min(500, total));
        else setChosenLimit(1000);
      }
    } catch {
      toast.error('Preview failed');
      setPreviewState({ loading: false, data: null });
    }
  };

  const launchCampaign = async () => {
    if (!conversationId || launching) return;
    setLaunching(true);
    try {
      const res = await fetch(`/api/agent/conversations/${conversationId}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedLimit: chosenLimit }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Launch failed');
        setLaunching(false);
        return;
      }
      setPreviewState({ loading: false, data: null });
      await fetchConversation();
      await fetchConversations();
      toast.success('Campaign launched');
    } catch {
      toast.error('Launch failed');
    } finally {
      setLaunching(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen relative flex items-center justify-center">
        <AnimatedBackground />
        <Loader2 className="w-8 h-8 text-lavender animate-spin relative z-10" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="min-h-screen relative flex items-center justify-center">
        <AnimatedBackground />
        <div className="relative z-10 text-center text-white/70">
          <p>Conversation not found.</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 px-3 py-1 border border-white/10 hover:border-white/30 transition"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  const latestPlan: CampaignPlan | null =
    [...messages].reverse().find(m => m.role === 'assistant' && m.planJson)?.planJson ||
    conversation.planJson ||
    null;

  const showPreviewGate =
    conversation.status === 'awaiting_approval' ||
    conversation.status === 'previewing' ||
    !!previewState.data;
  const launched = !!conversation.campaignId;

  return (
    // h-screen (not min-h-screen) so the inner flex children have a bounded
    // height. Without this, the thread's `flex-1 overflow-y-auto` has no
    // ceiling to scroll within and the whole page grows instead.
    <div className="h-screen overflow-hidden relative flex">
      <AnimatedBackground />

      {/* Sidebar */}
      <aside className="relative z-10 w-72 border-r border-white/10 bg-midnight/60 backdrop-blur-sm flex flex-col h-full">
        <div className="p-4 border-b border-white/10 flex items-center gap-2">
          <button
            onClick={() => router.push('/')}
            className="p-1.5 hover:bg-white/5 transition"
            title="Back to home"
          >
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </button>
          <button
            onClick={() => router.push('/')}
            className="flex-1 flex items-center gap-2 px-3 py-1.5 border border-white/10 hover:border-white/30 transition text-sm text-white/80"
          >
            <Plus className="w-4 h-4" />
            New campaign
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-2">
          <div className="px-4 py-2 text-xs uppercase tracking-wider text-white/30">
            Past conversations
          </div>
          {conversations.length === 0 ? (
            <div className="px-4 py-2 text-sm text-white/30">No conversations yet</div>
          ) : (
            conversations.map(c => (
              <ConversationRow
                key={c.id}
                conversation={c}
                isActive={c.id === conversation.id}
                onOpen={() => router.push(`/agent/${c.id}`)}
                onDeleted={async () => {
                  await fetchConversations();
                  // If the user just deleted the conversation they're currently
                  // viewing, send them back to home.
                  if (c.id === conversation.id) router.push('/');
                }}
              />
            ))
          )}
        </div>
      </aside>

      {/* Main pane */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 h-full">
        {/* Header */}
        <header className="border-b border-white/10 bg-midnight/50 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-medium text-white truncate">{conversation.title}</h1>
            <div className="text-xs text-white/40 mt-0.5">
              <StatusPill status={conversation.status} />
              {campaign && (
                <span className="ml-2">
                  · Campaign {campaign.progress.completedSteps}/{campaign.progress.totalSteps}{' '}
                  steps
                </span>
              )}
            </div>
          </div>
          {campaign?.workbookId && (
            <a
              href={`/workbook/${campaign.workbookId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-3 py-1 text-sm border border-white/10 hover:border-white/30 transition text-white/70"
            >
              Open workbook <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </header>

        {/* Thread */}
        <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-4">
          {messages.map(m => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {/* Thinking bubble — visible while the planner round-trip is in
              flight. Sits beneath the user's just-sent message until the
              real assistant reply arrives. */}
          {sending && <ThinkingBubble />}

          {/* Plan card — shown after the most recent assistant message that carries a plan */}
          {latestPlan && !launched && (
            <PlanCard
              plan={latestPlan}
              status={conversation.status}
              onApprove={runPreview}
              previewLoading={previewState.loading}
            />
          )}

          {/* Preview gate */}
          {showPreviewGate && previewState.data && !launched && (
            <PreviewGate
              data={previewState.data}
              chosenLimit={chosenLimit}
              setChosenLimit={setChosenLimit}
              onLaunch={launchCampaign}
              onCancel={() => setPreviewState({ loading: false, data: null })}
              launching={launching}
            />
          )}

          {/* Live campaign progress */}
          {campaign && (
            <CampaignProgressCard campaign={campaign} workbookHref={campaign.workbookId ? `/workbook/${campaign.workbookId}` : null} />
          )}
        </div>

        {/* Input */}
        <div className="border-t border-white/10 bg-midnight/50 backdrop-blur-sm px-6 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              disabled={sending}
              placeholder={
                conversation.status === 'awaiting_approval'
                  ? 'Type "approve" to launch, or ask for changes...'
                  : 'Refine the plan, ask questions...'
              }
              rows={2}
              className="flex-1 px-3 py-2 bg-white/5 border border-white/10 backdrop-blur-md
                         text-white placeholder:text-white/30
                         focus:border-lavender focus:outline-none focus:ring-2 focus:ring-lavender/20
                         resize-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="p-2.5 bg-lavender/20 border border-lavender/30 hover:bg-lavender/30
                         disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="Send"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-lavender" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConversationRow({
  conversation,
  isActive,
  onOpen,
  onDeleted,
}: {
  conversation: ConversationListItem;
  isActive: boolean;
  onOpen: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleting) return;
    const ok = window.confirm(
      `Delete "${conversation.title}"? This removes the conversation and cancels any running campaign linked to it.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/agent/conversations/${conversation.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete');
        setDeleting(false);
        return;
      }
      if (data.cancelledCampaign) toast.success('Conversation deleted, campaign cancelled');
      else toast.success('Conversation deleted');
      await onDeleted();
    } catch {
      toast.error('Failed to delete');
      setDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        'group relative flex items-start gap-1 px-4 py-2 text-sm hover:bg-white/5 transition cursor-pointer',
        isActive && 'bg-white/[0.04] border-l-2 border-lavender',
      )}
      onClick={onOpen}
    >
      <div className="flex-1 min-w-0">
        <div className="text-white/80 truncate">{conversation.title}</div>
        <div className="text-xs text-white/30 mt-0.5">
          <StatusPill status={conversation.status} compact />
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 transition flex-shrink-0"
        title="Delete conversation"
      >
        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function StatusPill({ status, compact }: { status: string; compact?: boolean }) {
  const map: Record<string, { label: string; cls: string }> = {
    planning: { label: 'Planning', cls: 'text-blue-300/80' },
    awaiting_approval: { label: 'Ready to run', cls: 'text-amber-300/90' },
    previewing: { label: 'Previewing', cls: 'text-amber-300/90' },
    running: { label: 'Running', cls: 'text-lavender' },
    complete: { label: 'Complete', cls: 'text-emerald-300/90' },
    error: { label: 'Error', cls: 'text-red-400/90' },
    cancelled: { label: 'Cancelled', cls: 'text-white/40' },
  };
  const entry = map[status] || { label: status, cls: 'text-white/40' };
  return (
    <span className={cn('inline-block', entry.cls, compact ? 'text-xs' : 'text-xs')}>
      ● {entry.label}
    </span>
  );
}

function ThinkingBubble() {
  // Cycle through hint phrases so the long-running planner call (5-30s) feels
  // alive rather than stuck. Pure cosmetic — none of these reflect the
  // agent's actual internal state, since gpt-5-mini's chain-of-thought
  // isn't surfaced.
  const phrases = [
    'Reading your prompt',
    'Thinking through filters',
    'Drafting stage breakdown',
    'Picking the right step types',
    'Almost there',
  ];
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const phraseTimer = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % phrases.length);
    }, 4000);
    const elapsedTimer = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => {
      clearInterval(phraseTimer);
      clearInterval(elapsedTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex justify-start">
      <div className="px-4 py-3 bg-white/5 border border-white/10 backdrop-blur-md min-w-[280px]">
        <div className="text-xs text-white/40 mb-1">Agent</div>
        <div className="text-sm text-white/70 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-lavender animate-spin flex-shrink-0" />
          <span>{phrases[phraseIdx]}</span>
          <span className="ml-auto text-xs text-white/30 tabular-nums">{elapsed}s</span>
        </div>
        <div className="mt-2 flex gap-1">
          <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
          <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const [showDetails, setShowDetails] = useState(false);
  if (message.role === 'tool' || message.role === 'system') return null;

  // Fallback display for already-stored messages with empty content (older
  // turns from before the planner-side fallback was added). New turns are
  // guaranteed non-empty server-side now.
  const trimmed = (message.content || '').trim();
  const hasPlan = !!message.planJson;
  const displayText = trimmed
    ? trimmed
    : hasPlan
      ? `Drafted a plan: **${(message.planJson as CampaignPlan).name}**. Review below.`
      : '(No reply text — the agent didn\'t produce any. Try asking again.)';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] px-4 py-3 backdrop-blur-md',
          isUser
            ? 'bg-lavender/15 border border-lavender/30 text-white'
            : 'bg-white/5 border border-white/10 text-white/90',
        )}
      >
        <div className="text-xs text-white/40 mb-1">{isUser ? 'You' : 'Agent'}</div>
        <div className={cn('text-sm whitespace-pre-wrap', !trimmed && 'text-white/50 italic')}>{displayText}</div>
        {!isUser && hasPlan && (
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="mt-2 text-xs text-white/35 hover:text-white/70 transition flex items-center gap-1"
          >
            {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {showDetails ? 'Hide details' : 'Show what the agent decided'}
          </button>
        )}
        {!isUser && hasPlan && showDetails && (
          <div className="mt-2 pt-2 border-t border-white/10 space-y-2 text-xs text-white/55">
            <div>
              <span className="text-white/40">Rationale: </span>
              {(message.planJson as CampaignPlan).rationale}
            </div>
            <div>
              <span className="text-white/40">Source: </span>
              {(message.planJson as CampaignPlan).source === 'ai-ark' ? 'AI Ark' : 'Clay'}
              <span className="text-white/40"> · Stages: </span>
              {(message.planJson as CampaignPlan).stages.length}
            </div>
            <details className="text-white/45">
              <summary className="cursor-pointer hover:text-white/70 select-none">
                Raw plan JSON
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto bg-black/30 border border-white/5 p-2 text-[10px] leading-snug whitespace-pre-wrap">
                {JSON.stringify(message.planJson, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  status,
  onApprove,
  previewLoading,
}: {
  plan: CampaignPlan;
  status: string;
  onApprove: () => void;
  previewLoading: boolean;
}) {
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set());

  const toggleStage = (i: number) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="bg-white/[0.03] border border-white/15 backdrop-blur-md p-5 max-w-3xl">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Proposed plan</div>
          <h3 className="text-lg font-medium text-white">{plan.name}</h3>
        </div>
        <span className="text-xs px-2 py-0.5 border border-white/10 text-white/60">
          {plan.source === 'ai-ark' ? 'AI Ark' : 'Clay'}
        </span>
      </div>

      <p className="text-sm text-white/60 mb-4">{plan.rationale}</p>

      <div className="space-y-2">
        {plan.stages.map((stage, i) => {
          const open = expandedStages.has(i);
          return (
            <div key={i} className="border border-white/5">
              <button
                onClick={() => toggleStage(i)}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition"
              >
                {open ? (
                  <ChevronDown className="w-4 h-4 text-white/40 mt-0.5 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-white/40 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{stage.title}</div>
                  <div className="text-xs text-white/50 mt-0.5">{stage.summary}</div>
                </div>
              </button>
              {open && (
                <div className="px-9 pb-3 text-xs space-y-2">
                  {stage.notes && stage.notes.length > 0 && (
                    <div className="text-white/50 space-y-0.5">
                      {stage.notes.map((n, j) => (
                        <div key={j}>· {n}</div>
                      ))}
                    </div>
                  )}
                  <div className="text-white/40">
                    {stage.steps.length} step{stage.steps.length === 1 ? '' : 's'}:{' '}
                    {stage.steps.map(s => s.type).join(' → ')}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(status === 'planning' || status === 'awaiting_approval') && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onApprove}
            disabled={previewLoading}
            className="px-4 py-2 bg-lavender/20 border border-lavender/40 hover:bg-lavender/30
                       text-white text-sm transition disabled:opacity-50"
          >
            {previewLoading ? 'Running preview...' : 'Approve & Run →'}
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewGate({
  data,
  chosenLimit,
  setChosenLimit,
  onLaunch,
  onCancel,
  launching,
}: {
  data: PreviewResponse;
  chosenLimit: number | null;
  setChosenLimit: (n: number | null) => void;
  onLaunch: () => void;
  onCancel: () => void;
  launching: boolean;
}) {
  const total = data.estimatedTotal;
  const presets = total
    ? [
        { label: 'All', value: total },
        ...(total > 1000 ? [{ label: '1,000', value: 1000 }] : []),
        ...(total > 500 ? [{ label: '500', value: 500 }] : []),
        ...(total > 100 ? [{ label: '100', value: 100 }] : []),
      ].filter((p, i, arr) => arr.findIndex(x => x.value === p.value) === i)
    : [];

  return (
    <div className="bg-amber-500/5 border border-amber-300/30 backdrop-blur-md p-5 max-w-3xl">
      <div className="text-xs text-amber-300/80 uppercase tracking-wider mb-2">
        Search preview
      </div>
      <p className="text-sm text-white/85">
        Found <span className="font-medium text-white">~{total?.toLocaleString() ?? '?'}</span>{' '}
        matching results.{' '}
        {total && total > 1000 ? 'Pick a limit before fetching to keep costs sane.' : 'How many should we fetch?'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {presets.map(p => (
          <button
            key={p.label}
            onClick={() => setChosenLimit(p.value)}
            className={cn(
              'px-3 py-1.5 text-sm border transition',
              chosenLimit === p.value
                ? 'border-amber-300/60 bg-amber-300/10 text-white'
                : 'border-white/10 text-white/70 hover:border-white/30',
            )}
          >
            {p.label}
          </button>
        ))}
        <input
          type="number"
          min={1}
          value={chosenLimit ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            setChosenLimit(Number.isFinite(n) && n > 0 ? n : null);
          }}
          placeholder="Custom"
          className="w-28 px-2 py-1.5 text-sm bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-amber-300/40"
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-white/60 hover:text-white/90 transition"
        >
          Cancel
        </button>
        <button
          onClick={onLaunch}
          disabled={!chosenLimit || launching}
          className="px-4 py-2 bg-lavender/20 border border-lavender/40 hover:bg-lavender/30
                     text-white text-sm transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {launching ? 'Launching...' : `Launch with ${chosenLimit?.toLocaleString() || '0'} →`}
        </button>
      </div>
    </div>
  );
}

function CampaignProgressCard({
  campaign,
  workbookHref,
}: {
  campaign: CampaignSnapshot;
  workbookHref: string | null;
}) {
  const sendReadyStep = campaign.steps.find(
    s => s.type === 'materialize_send_ready' && s.status === 'complete',
  );
  const sendReadyTableId = (sendReadyStep?.result?.tableId as string | undefined) || null;

  return (
    <div className="bg-white/[0.03] border border-white/15 backdrop-blur-md p-5 max-w-3xl">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Campaign progress</div>
          <h3 className="text-lg font-medium text-white">{campaign.name}</h3>
        </div>
        <StatusPill status={campaign.status} />
      </div>

      <div className="space-y-1.5">
        {campaign.steps.map(s => (
          <StepRow key={s.step} step={s} />
        ))}
      </div>

      {campaign.status === 'complete' && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {sendReadyTableId && workbookHref ? (
            <a
              href={`${workbookHref}?sheet=${sendReadyTableId}`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-emerald-500/15 border border-emerald-300/30 hover:bg-emerald-500/25
                         text-white text-sm transition flex items-center gap-2"
            >
              Open Send-Ready sheet <ExternalLink className="w-3 h-3" />
            </a>
          ) : workbookHref ? (
            <a
              href={workbookHref}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 border border-white/15 hover:border-white/30 text-white/80 text-sm transition flex items-center gap-2"
            >
              Open workbook <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: CampaignStepSnapshot }) {
  let icon;
  let textCls = 'text-white/70';
  if (step.status === 'complete') {
    icon = <CheckCircle2 className="w-4 h-4 text-emerald-400/90" />;
    textCls = 'text-white/90';
  } else if (step.status === 'running') {
    icon = <Loader2 className="w-4 h-4 text-lavender animate-spin" />;
    textCls = 'text-white';
  } else if (step.status === 'error') {
    icon = <AlertCircle className="w-4 h-4 text-red-400/90" />;
    textCls = 'text-red-300/90';
  } else if (step.status === 'skipped' || step.status === 'cancelled') {
    icon = <XCircle className="w-4 h-4 text-white/30" />;
    textCls = 'text-white/40';
  } else {
    icon = <Circle className="w-4 h-4 text-white/20" />;
    textCls = 'text-white/40';
  }

  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className={textCls}>
          {humanizeStep(step.type)}
          {step.result && Object.keys(step.result).length > 0 && (
            <span className="ml-2 text-xs text-white/40">{summarizeResult(step.type, step.result)}</span>
          )}
        </div>
        {step.error && (
          <div className="mt-0.5 text-xs text-red-300/80 line-clamp-2">{step.error}</div>
        )}
      </div>
    </div>
  );
}

function humanizeStep(type: string): string {
  const map: Record<string, string> = {
    create_workbook: 'Create workbook',
    search_companies: 'Search companies',
    search_people: 'Search people',
    create_sheet: 'Create sheet',
    import_rows: 'Import rows',
    filter_rows: 'Filter rows',
    find_domains: 'Find missing domains (web search)',
    qualify_titles: 'Qualify job titles',
    find_emails: 'Find emails',
    find_emails_waterfall: 'Find emails (AI Ark → Ninjer → TryKitt)',
    clean_company_name: 'Clean company names',
    clean_person_name: 'Clean person names',
    materialize_send_ready: 'Build Send-Ready sheet',
    lookup: 'Lookup',
    enrich: 'AI enrich',
    cleanup: 'Cleanup empty rows',
  };
  return map[type] || type;
}

function summarizeResult(type: string, result: Record<string, unknown>): string {
  if (type === 'search_companies' || type === 'search_people') {
    return result.totalCount ? `${result.totalCount} found` : '';
  }
  if (type === 'import_rows') {
    return result.rowCount ? `${result.rowCount} imported` : '';
  }
  if (type === 'filter_rows' || type === 'cleanup') {
    return result.removed ? `${result.removed} removed` : '';
  }
  if (type === 'find_domains') {
    return result.backfilled ? `${result.backfilled} backfilled` : '';
  }
  if (type === 'qualify_titles') {
    return result.removed ? `${result.removed} removed (${((result.unqualifiedRate as number) * 100).toFixed(0)}% bad)` : 'no-op';
  }
  if (type === 'find_emails_waterfall') {
    return result.finalCount ? `${result.finalCount} with email` : '';
  }
  if (type === 'clean_company_name' || type === 'clean_person_name') {
    return result.processed ? `${result.processed} cleaned` : '';
  }
  if (type === 'materialize_send_ready') {
    return result.rowCount ? `${result.rowCount} rows ready` : '';
  }
  return '';
}

export default function AgentPage() {
  return (
    <ToastProvider>
      <AgentChatPage />
    </ToastProvider>
  );
}
