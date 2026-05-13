'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Terminal, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { getCliCredentials } from './actions';

interface CliAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CliAccessModal({ isOpen, onClose }: CliAccessModalProps) {
  const [creds, setCreds] = useState<{ apiKey: string; baseUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Fetch the key the first time the modal opens.
  useEffect(() => {
    if (!isOpen || creds) return;
    setLoading(true);
    getCliCredentials()
      .then(setCreds)
      .catch(() => setCreds({ apiKey: '', baseUrl: 'https://dataflow-pi.vercel.app' }))
      .finally(() => setLoading(false));
  }, [isOpen, creds]);

  // Reset reveal state every time we close so the next open hides again.
  useEffect(() => {
    if (!isOpen) setRevealed(false);
  }, [isOpen]);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(id);
      setTimeout(() => setCopiedKey(prev => (prev === id ? null : prev)), 1500);
    } catch {
      /* no-op — older browsers without clipboard API */
    }
  };

  const baseUrl = creds?.baseUrl || 'https://dataflow-pi.vercel.app';
  const apiKey = creds?.apiKey || '';
  const keyDisplay = revealed ? apiKey : apiKey ? '•'.repeat(Math.min(40, apiKey.length)) : '';
  const setKeyCmd = `agent-x set-key ${apiKey || '<your-key>'}`;
  const installPs = `irm ${baseUrl}/cli/install.ps1 | iex`;
  const installSh = `curl -fsSL ${baseUrl}/cli/install.sh | bash`;
  const tryCmd = 'agent-x docs';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" title="Get CLI access" description="Drive Agent X from your terminal — same model, same data, same campaigns.">
      <div className="space-y-5 text-sm text-white/80">
        {/* Step 1 — Install */}
        <Step n={1} label="Install">
          <p className="text-xs text-white/55 mb-2">Pick the line for your shell.</p>
          <Code label="Windows (PowerShell)" cmd={installPs} onCopy={() => copy(installPs, 'ps')} copied={copiedKey === 'ps'} />
          <Code label="macOS / Linux / Git Bash" cmd={installSh} onCopy={() => copy(installSh, 'sh')} copied={copiedKey === 'sh'} />
          <p className="text-xs text-white/45 mt-2">
            Requires Node ≥ 18. Installs to <code className="text-white/65 bg-white/5 px-1">~/.local/bin/agent-x</code>.
          </p>
        </Step>

        {/* Step 2 — Set key */}
        <Step n={2} label="Save your API key">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-white/55">Your key:</span>
            <code className="flex-1 text-xs text-white/85 bg-white/5 border border-white/10 px-2 py-1 font-mono break-all">
              {loading ? 'loading…' : keyDisplay || '(not configured on server)'}
            </code>
            <button
              onClick={() => setRevealed(v => !v)}
              className="p-1.5 text-white/55 hover:text-white/90 border border-white/10 hover:border-white/30 transition"
              title={revealed ? 'Hide' : 'Reveal'}
              disabled={!apiKey}
            >
              {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => copy(apiKey, 'key')}
              className="p-1.5 text-white/55 hover:text-white/90 border border-white/10 hover:border-white/30 transition"
              title="Copy key only"
              disabled={!apiKey}
            >
              {copiedKey === 'key' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <Code label="Run this in your terminal" cmd={setKeyCmd} onCopy={() => copy(setKeyCmd, 'setkey')} copied={copiedKey === 'setkey'} mask={!revealed && !!apiKey ? apiKey : undefined} />
          <p className="text-xs text-white/45 mt-2">
            Saved to <code className="text-white/65 bg-white/5 px-1">~/.config/agent-x/env</code>. Won&apos;t ask again.
          </p>
        </Step>

        {/* Step 3 — Try it */}
        <Step n={3} label="Try it">
          <Code label="Read the rules + API spec" cmd={tryCmd} onCopy={() => copy(tryCmd, 'try')} copied={copiedKey === 'try'} />
          <p className="text-xs text-white/45 mt-2">
            The CLI is execution-only — the planner brain is <strong className="text-white/70">you</strong> (or Claude Code).
            From an LLM-capable terminal, just say: <em>&quot;use agent-x to find 50 CFOs of manufacturing companies in Vietnam.&quot;</em> Claude reads <code className="text-white/65 bg-white/5 px-1">/cli/AGENT-X-GUIDE.md</code>, drafts the plan, gets your approval, and submits via <code className="text-white/65 bg-white/5 px-1">agent-x api POST /api/campaigns</code>.
          </p>
        </Step>

        {/* Footer links */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-white/55">
            <Terminal className="w-3.5 h-3.5" />
            <span>Full subcommand reference + every API endpoint:</span>
          </div>
          <a
            href={`${baseUrl}/cli/AGENT-X-GUIDE.md`}
            target="_blank"
            rel="noreferrer"
            className="text-lavender hover:underline flex items-center gap-1"
          >
            /cli/AGENT-X-GUIDE.md <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </Modal>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 flex items-center justify-center text-xs font-medium text-white/60 border border-white/15">
          {n}
        </span>
        <h3 className="text-sm font-medium text-white/90">{label}</h3>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

function Code({
  label,
  cmd,
  onCopy,
  copied,
  mask,
}: {
  label?: string;
  cmd: string;
  onCopy: () => void;
  copied: boolean;
  mask?: string;
}) {
  // When `mask` is supplied (i.e. the unrevealed API key), replace it with
  // bullets in the visible string but still copy the real value.
  const visible = mask ? cmd.replace(mask, '•'.repeat(Math.min(40, mask.length))) : cmd;
  return (
    <div className="mb-2">
      {label && <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">{label}</div>}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 text-xs text-white/90 bg-black/40 border border-white/10 px-3 py-2 font-mono break-all">
          {visible}
        </code>
        <button
          onClick={onCopy}
          className="px-2 py-2 text-white/55 hover:text-white/90 border border-white/10 hover:border-white/30 transition flex-shrink-0"
          title="Copy"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
