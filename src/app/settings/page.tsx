'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Settings as SettingsIcon, Eye, EyeOff, Save } from 'lucide-react';
import { AppNav } from '@/components/layout/AppNav';
import { GlassCard, GlassInput, GlassButton, ToastProvider, useToast } from '@/components/ui';

const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false },
);

interface SecretFieldDef {
  env: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}
interface ProviderDef {
  provider: string;
  label: string;
  note?: string;
  fields: SecretFieldDef[];
}
interface SecretStatus {
  key: string;
  configured: boolean;
  source: 'db' | 'env' | 'unset';
  preview: string | null;
}

function StatusChip({ status }: { status?: SecretStatus }) {
  if (!status || !status.configured) {
    return <span className="text-xs px-2 py-0.5 border border-white/10 text-white/40">Not set</span>;
  }
  if (status.source === 'env') {
    return (
      <span
        className="text-xs px-2 py-0.5 border border-amber-400/30 text-amber-300"
        title="Loaded from an environment variable (not yet saved to the store)"
      >
        From environment · {status.preview}
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 border border-emerald-400/30 text-emerald-300">
      Saved · {status.preview}
    </span>
  );
}

function SettingsContent() {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SecretStatus>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [revealingProvider, setRevealingProvider] = useState<string | null>(null);

  // Load once on mount. `toast` from useToast() is a fresh object each render
  // (the provider doesn't memoize its value), so this effect intentionally has
  // no deps — depending on `toast` would refetch every render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          toast.error('Failed to load settings', data.error || `HTTP ${res.status}`);
          return;
        }
        setProviders(data.providers || []);
        const map: Record<string, SecretStatus> = {};
        for (const s of (data.statuses || []) as SecretStatus[]) map[s.key] = s;
        setStatuses(map);
      } catch (e) {
        if (!cancelled) toast.error('Failed to load settings', (e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyStatuses(list: SecretStatus[]) {
    const map: Record<string, SecretStatus> = {};
    for (const s of list) map[s.key] = s;
    setStatuses(map);
  }

  async function revealCard(p: ProviderDef) {
    setRevealingProvider(p.provider);
    try {
      const res = await fetch('/api/settings/reveal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Reveal failed', data.error || `HTTP ${res.status}`);
        return;
      }
      const vals: Record<string, string> = data.values || {};
      const keys = p.fields.map((f) => f.env);
      setValues((prev) => {
        const next = { ...prev };
        for (const k of keys) if (k in vals) next[k] = vals[k];
        return next;
      });
      setBaseline((prev) => {
        const next = { ...prev };
        for (const k of keys) if (k in vals) next[k] = vals[k];
        return next;
      });
      setShown((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = true;
        return next;
      });
    } catch (e) {
      toast.error('Reveal failed', (e as Error).message);
    } finally {
      setRevealingProvider(null);
    }
  }

  async function saveCard(p: ProviderDef) {
    // Only send fields the user actually entered/changed. Empty input = leave unchanged.
    const payload: Record<string, string> = {};
    for (const f of p.fields) {
      const v = values[f.env] ?? '';
      if (v === '') continue;
      if (baseline[f.env] !== undefined && baseline[f.env] === v) continue; // revealed but untouched
      payload[f.env] = v;
    }
    if (Object.keys(payload).length === 0) {
      toast.info('Nothing to save', 'Enter a new value first');
      return;
    }
    setSavingProvider(p.provider);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Save failed', data.error || `HTTP ${res.status}`);
        return;
      }
      applyStatuses(data.statuses || []);
      setBaseline((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(payload)) next[k] = payload[k];
        return next;
      });
      // Clear hidden inputs back to the masked placeholder; keep revealed ones visible.
      setValues((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(payload)) if (!shown[k]) next[k] = '';
        return next;
      });
      toast.success('Saved', `${p.label} updated — effective immediately`);
    } catch (e) {
      toast.error('Save failed', (e as Error).message);
    } finally {
      setSavingProvider(null);
    }
  }

  return (
    <main className="relative z-10 max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-2">
        <SettingsIcon className="w-6 h-6 text-lavender" />
        <h1 className="text-2xl font-display text-white tracking-tight">Settings</h1>
      </div>
      <p className="text-white/50 text-sm mb-6 max-w-2xl">
        Provider API keys &amp; credentials used across enrichment. Changes take effect immediately — no
        redeploy. Values are stored encrypted; the original environment variables remain as a fallback, so a
        blank field keeps whatever is already configured.
      </p>

      {loading ? (
        <div className="text-white/50 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          {providers.map((p) => (
            <GlassCard key={p.provider} padding="lg">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg text-white font-medium">{p.label}</h2>
                  {p.note && <p className="text-xs text-white/50 mt-0.5">{p.note}</p>}
                </div>
                <GlassButton
                  size="sm"
                  variant="ghost"
                  loading={revealingProvider === p.provider}
                  onClick={() => revealCard(p)}
                >
                  <Eye className="w-3.5 h-3.5" /> Reveal
                </GlassButton>
              </div>

              <div className="space-y-3">
                {p.fields.map((f) => {
                  const st = statuses[f.env];
                  const isShown = !!shown[f.env];
                  const isSecret = !!f.secret;
                  return (
                    <div key={f.env}>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm text-white/70">{f.label}</label>
                        <StatusChip status={st} />
                      </div>
                      <div className="relative">
                        <GlassInput
                          type={isSecret && !isShown ? 'password' : 'text'}
                          value={values[f.env] ?? ''}
                          placeholder={f.placeholder || (st?.preview ? `Current: ${st.preview}` : 'Not set')}
                          onChange={(e) => setValues((v) => ({ ...v, [f.env]: e.target.value }))}
                          className={isSecret ? 'pr-10' : undefined}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        {isSecret && (
                          <button
                            type="button"
                            onClick={() => setShown((s) => ({ ...s, [f.env]: !s[f.env] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                            title={isShown ? 'Hide' : 'Show'}
                          >
                            {isShown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end mt-4">
                <GlassButton
                  variant="primary"
                  size="md"
                  loading={savingProvider === p.provider}
                  onClick={() => saveCard(p)}
                >
                  <Save className="w-4 h-4" /> Save {p.label}
                </GlassButton>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </main>
  );
}

export default function SettingsPage() {
  return (
    <ToastProvider>
      <div className="h-screen overflow-y-auto relative">
        <AnimatedBackground />
        <AppNav />
        <SettingsContent />
      </div>
    </ToastProvider>
  );
}
