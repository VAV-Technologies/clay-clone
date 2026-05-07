'use client';

// / — Agent X home. Just a centered greeting + prompt box. Submitting routes
// the user into a new agent conversation at /agent/[id]. The workbook library
// (search / storage / new folder / new workbook / project list) lives at
// /tables; both surfaces share AppNav at the top.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2, Trash2 } from 'lucide-react';
import { ToastProvider, useToast } from '@/components/ui';
import { AppNav } from '@/components/layout/AppNav';
import { cn } from '@/lib/utils';

interface ConversationListItem {
  id: string;
  title: string;
  status: string;
  campaignId: string | null;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  awaiting_approval: 'Ready to run',
  previewing: 'Previewing',
  running: 'Running',
  complete: 'Complete',
  error: 'Error',
  cancelled: 'Cancelled',
};

const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

function AgentHomeContent() {
  const router = useRouter();
  const toast = useToast();

  const [agentPrompt, setAgentPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Past-conversations panel: hidden by default, fetched on first open.
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ConversationListItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/agent/conversations');
      if (res.ok) {
        const data = await res.json();
        setHistory(data.conversations || []);
      } else {
        toast.error('Failed to load conversations');
      }
    } catch {
      toast.error('Failed to load conversations');
    } finally {
      setLoadingHistory(false);
    }
  };

  const toggleHistory = async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    await fetchHistory();
  };

  const handleDeleteConversation = async (e: React.MouseEvent, conv: ConversationListItem) => {
    e.stopPropagation();
    if (deletingId) return;
    const ok = window.confirm(
      `Delete "${conv.title}"? This removes the conversation and cancels any running campaign linked to it.`,
    );
    if (!ok) return;
    setDeletingId(conv.id);
    try {
      const res = await fetch(`/api/agent/conversations/${conv.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete');
        return;
      }
      toast.success(data.cancelledCampaign ? 'Deleted, campaign cancelled' : 'Deleted');
      setHistory((prev) => prev.filter((c) => c.id !== conv.id));
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };
  // Compute time-of-day after mount so SSR/CSR agree (server is UTC).
  const [timeOfDay, setTimeOfDay] = useState<string | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    if (h < 5) setTimeOfDay('night');
    else if (h < 12) setTimeOfDay('morning');
    else if (h < 17) setTimeOfDay('afternoon');
    else if (h < 21) setTimeOfDay('evening');
    else setTimeOfDay('night');
  }, []);

  const handleSubmit = async (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    const prompt = agentPrompt.trim();
    if (!prompt || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/agent/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      // Robustly extract an error message: try JSON, fall back to body text,
      // fall back to status code so we never silently land on the generic
      // "Failed to start agent" string when the server actually told us why.
      let data: { conversationId?: string; error?: string } = {};
      let rawText = '';
      try {
        rawText = await res.text();
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        // body wasn't JSON — keep rawText as-is for the error toast
      }
      if (!res.ok || !data.conversationId) {
        const detail =
          data.error ||
          (rawText && rawText.length < 300 ? rawText : '') ||
          `HTTP ${res.status}`;
        toast.error(`Failed to start agent: ${detail}`);
        console.error('[agent home] start failed', { status: res.status, body: rawText });
        setSubmitting(false);
        return;
      }
      router.push(`/agent/${data.conversationId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      toast.error(`Failed to start agent: ${msg}`);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col">
      <AnimatedBackground />
      <AppNav />

      {/* Greeting + prompt, boxed and vertically centred in the viewport.
          The outer section uses the same max-w-4xl + px-6 as AppNav so the
          box's left edge aligns with the "D" of Dataflow and the right edge
          aligns with the lightning icon. */}
      <main className="relative z-10 flex-1 flex items-center justify-center pb-24">
        <section className="w-full max-w-4xl px-6">
          <div
            className="px-8 py-14 sm:px-14 sm:py-20 lg:px-20 lg:py-24 text-center"
          >
            <p
              className="text-xl text-white/55 leading-tight tracking-wide"
              style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 300 }}
            >
              {timeOfDay ? `Good ${timeOfDay},` : ' '}
            </p>
            <h2
              className="mt-1 text-5xl text-white/85"
              style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 300, fontStyle: 'italic' }}
            >
              What would you like to build today?
            </h2>

            <form onSubmit={handleSubmit} className="mt-10 text-left">
              <textarea
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                disabled={submitting}
                placeholder="Build me a list of CEOs of consulting firms in Malaysia with $10M+ revenue..."
                rows={3}
                className="w-full px-5 py-4
                           bg-white/5 border border-white/10
                           text-white placeholder:text-white/30
                           focus:border-lavender focus:outline-none focus:ring-2 focus:ring-lavender/20
                           backdrop-blur-md resize-none
                           disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-white/30">
                <span>Press Enter to start. Shift+Enter for newline.</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleHistory}
                    className={cn(
                      'px-3 py-1 border transition',
                      showHistory
                        ? 'border-white/40 text-white/80'
                        : 'border-white/15 hover:border-white/40 hover:text-white/70',
                    )}
                  >
                    {showHistory ? 'Hide conversations' : 'Open conversations'}
                  </button>
                  <button
                    type="submit"
                    disabled={!agentPrompt.trim() || submitting}
                    className="px-3 py-1 border border-white/15 hover:border-white/40 hover:text-white/70 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Starting...' : 'Start →'}
                  </button>
                </div>
              </div>
            </form>

            {/* Past conversations — collapsible. Click any row to jump in. */}
            {showHistory && (
              <div className="mt-8 pt-6 border-t border-white/10 text-left">
                <div className="text-xs text-white/30 uppercase tracking-wider mb-3">
                  Past conversations
                </div>
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 text-lavender animate-spin" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-sm text-white/40 py-4">No conversations yet.</div>
                ) : (
                  <div className="divide-y divide-white/5 border border-white/5">
                    {history.map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => router.push(`/agent/${conv.id}`)}
                        className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white/85 truncate">{conv.title}</div>
                          <div className="text-xs text-white/40 mt-0.5">
                            {STATUS_LABELS[conv.status] ?? conv.status} ·{' '}
                            {new Date(conv.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteConversation(e, conv)}
                          disabled={deletingId === conv.id}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-white/40 hover:text-red-400 transition flex-shrink-0"
                          title="Delete conversation"
                        >
                          {deletingId === conv.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function HomePage() {
  return (
    <ToastProvider>
      <AgentHomeContent />
    </ToastProvider>
  );
}
