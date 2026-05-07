'use client';

// / — Agent X home. Just a centered greeting + prompt box. Submitting routes
// the user into a new agent conversation at /agent/[id]. The workbook library
// (search / storage / new folder / new workbook / project list) lives at
// /tables; both surfaces share AppNav at the top.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ToastProvider, useToast } from '@/components/ui';
import { AppNav } from '@/components/layout/AppNav';

const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

function AgentHomeContent() {
  const router = useRouter();
  const toast = useToast();

  const [agentPrompt, setAgentPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
      const data = await res.json();
      if (!res.ok || !data.conversationId) {
        toast.error(data.error || 'Failed to start agent');
        setSubmitting(false);
        return;
      }
      router.push(`/agent/${data.conversationId}`);
    } catch {
      toast.error('Failed to start agent');
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
            className="border border-white/10 bg-white/[0.02] backdrop-blur-md
                       px-8 py-14 sm:px-14 sm:py-20 lg:px-20 lg:py-24
                       text-center"
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
                <button
                  type="submit"
                  disabled={!agentPrompt.trim() || submitting}
                  className="px-3 py-1 border border-white/15 hover:border-white/40 hover:text-white/70 transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Starting...' : 'Start →'}
                </button>
              </div>
            </form>
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
