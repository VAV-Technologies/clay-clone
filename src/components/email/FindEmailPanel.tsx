'use client';

import { useState, useEffect, useMemo } from 'react';
import { Mail, X, Play, TestTube, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import { ConditionSection } from '@/components/shared/ConditionSection';
import { applyFilter, type FilterOperator, type RowLike } from '@/lib/filter-utils';

interface FindEmailPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type ProviderId = 'ninjer' | 'trykitt' | 'ai_ark' | 'betterenrich';

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'ninjer', label: 'Ninjer' },
  { id: 'trykitt', label: 'TryKitt' },
  { id: 'ai_ark', label: 'AI Ark' },
  { id: 'betterenrich', label: 'BetterEnrich' },
];
const PROVIDER_LABEL = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label])) as Record<ProviderId, string>;
const ENDPOINT_FOR: Record<ProviderId, string> = {
  ninjer: '/api/find-email/run',
  trykitt: '/api/find-email/trykitt',
  ai_ark: '/api/find-email/ai-ark',
  betterenrich: '/api/find-email/betterenrich',
};
// Per-provider result column (shared by Single mode and each Waterfall stage).
const PROVIDER_COLUMN: Record<ProviderId, { name: string; actionKind: string }> = {
  ninjer: { name: 'Email', actionKind: 'find_email_ninjer' },
  trykitt: { name: 'Email (TryKitt)', actionKind: 'find_email_trykitt' },
  ai_ark: { name: 'Email (AI Ark)', actionKind: 'find_email_aiark' },
  betterenrich: { name: 'Email (BetterEnrich)', actionKind: 'find_email_betterenrich' },
};
const looksLikeEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FindEmailResult {
  rowId: string;
  success: boolean;
  email: string | null;
  status: string;
  enrichmentData?: Record<string, string | number | null>;
  metadata?: { timeTakenMs: number };
  error?: string;
}

export function FindEmailPanel({ isOpen, onClose }: FindEmailPanelProps) {
  const { currentTable, columns, rows, selectedRows, updateCell, addColumn, fetchTable } = useTableStore();

  const [mode, setMode] = useState<'single' | 'waterfall'>('single');
  const [provider, setProvider] = useState<ProviderId>('ninjer');
  const [waterfallProviders, setWaterfallProviders] = useState<ProviderId[]>([]);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'full_name' | 'first_last'>('full_name');
  const [fullNameColumnId, setFullNameColumnId] = useState('');
  const [firstNameColumnId, setFirstNameColumnId] = useState('');
  const [lastNameColumnId, setLastNameColumnId] = useState('');
  const [domainColumnId, setDomainColumnId] = useState('');
  const [linkedinColumnId, setLinkedinColumnId] = useState('');

  // Run condition
  const [condColumnId, setCondColumnId] = useState('');
  const [condOperator, setCondOperator] = useState<FilterOperator>('is_empty');
  const [condValue, setCondValue] = useState('');

  const [isRunning, setIsRunning] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<{
    found: number; catchAll: number; notFound: number; errors: number; skipped: number; submitted: number;
  } | null>(null);

  // Auto-detect columns on open
  useEffect(() => {
    if (!isOpen || columns.length === 0) return;

    // Reset state
    setError(null);
    setResultSummary(null);
    setProgress({ completed: 0, total: 0 });
    setStageLabel(null);

    const nonEnrichmentCols = columns.filter(c => c.type !== 'enrichment');

    // Auto-detect domain
    const domainCol = nonEnrichmentCols.find(c =>
      /domain|website|url|company.*domain/i.test(c.name)
    );
    if (domainCol) setDomainColumnId(domainCol.id);

    // Auto-detect full name
    const fullNameCol = nonEnrichmentCols.find(c =>
      /^(full.?)?name$/i.test(c.name) && !/first|last|domain/i.test(c.name)
    );
    if (fullNameCol) setFullNameColumnId(fullNameCol.id);

    // Auto-detect first/last
    const firstCol = nonEnrichmentCols.find(c => /first.?name/i.test(c.name));
    const lastCol = nonEnrichmentCols.find(c => /last.?name/i.test(c.name));
    if (firstCol) setFirstNameColumnId(firstCol.id);
    if (lastCol) setLastNameColumnId(lastCol.id);

    // Auto-detect LinkedIn URL (optional input, used by BetterEnrich)
    const linkedinCol = nonEnrichmentCols.find(c => /linkedin|li.?url|profile.*url/i.test(c.name));
    if (linkedinCol) setLinkedinColumnId(linkedinCol.id);

    // If first+last found but no full name, switch to first_last mode
    if (firstCol && lastCol && !fullNameCol) {
      setInputMode('first_last');
    }
  }, [isOpen, columns]);

  const tableId = currentTable?.id;
  const baseRowCount = selectedRows.size > 0 ? selectedRows.size : rows.length;

  // Compute condition-filtered row count
  const { conditionMatchCount, conditionFilteredIds } = useMemo(() => {
    const baseIds = selectedRows.size > 0 ? Array.from(selectedRows) : rows.map(r => r.id);
    if (!condColumnId) {
      return { conditionMatchCount: baseIds.length, conditionFilteredIds: baseIds };
    }
    const filter = { columnId: condColumnId, operator: condOperator, value: condValue };
    const filtered = baseIds.filter(id => {
      const row = rows.find(r => r.id === id);
      return row ? applyFilter(row as unknown as RowLike, filter, columns) : false;
    });
    return { conditionMatchCount: filtered.length, conditionFilteredIds: filtered };
  }, [rows, selectedRows, columns, condColumnId, condOperator, condValue]);

  const rowCount = condColumnId ? conditionMatchCount : baseRowCount;

  const canRun = (() => {
    if (!domainColumnId) return false;
    if (mode === 'waterfall' && waterfallProviders.length === 0) return false;
    if (inputMode === 'full_name') return !!fullNameColumnId;
    return !!(firstNameColumnId && lastNameColumnId);
  })();

  const toggleWaterfall = (id: ProviderId) =>
    setWaterfallProviders((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const getOrCreateProviderColumn = async (p: ProviderId): Promise<string> => {
    // One result column per provider, shared by Single mode and Waterfall mode —
    // a waterfall just writes each stage's results into that provider's column.
    // Reusing the per-provider actionKind keeps per-cell retry working via the
    // existing /api/find-email/retry-cell.
    const { name, actionKind } = PROVIDER_COLUMN[p];
    const existing = columns.find(c => c.name === name && c.actionKind === actionKind);
    if (existing) return existing.id;

    const res = await fetch('/api/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId,
        name,
        type: 'enrichment',
        actionKind,
        actionConfig: {
          inputMode,
          fullNameColumnId: inputMode === 'full_name' ? fullNameColumnId : undefined,
          firstNameColumnId: inputMode === 'first_last' ? firstNameColumnId : undefined,
          lastNameColumnId: inputMode === 'first_last' ? lastNameColumnId : undefined,
          domainColumnId,
          linkedinColumnId: linkedinColumnId || undefined,
        },
      }),
    });
    const col = await res.json();
    addColumn(col);
    return col.id;
  };

  // Shared request body for every find-email provider route. linkedinColumnId is
  // always sent now (LinkedIn is a default mapping field) — only BetterEnrich
  // reads it; the other routes ignore unknown fields.
  const bodyFor = (rowIds: string[], resultColumnId: string) => ({
    tableId,
    rowIds,
    inputMode,
    fullNameColumnId: inputMode === 'full_name' ? fullNameColumnId : undefined,
    firstNameColumnId: inputMode === 'first_last' ? firstNameColumnId : undefined,
    lastNameColumnId: inputMode === 'first_last' ? lastNameColumnId : undefined,
    domainColumnId,
    linkedinColumnId: linkedinColumnId || undefined,
    resultColumnId,
  });

  const processRows = async (rowIds: string[]) => {
    if (!tableId) return;

    setError(null);
    setResultSummary(null);

    const resultColumnId = await getOrCreateProviderColumn(provider);

    // Mark cells as processing
    for (const rowId of rowIds) {
      updateCell(rowId, resultColumnId, { value: null, status: 'processing' });
    }

    setProgress({ completed: 0, total: rowIds.length });

    const summary = { found: 0, catchAll: 0, notFound: 0, errors: 0, skipped: 0, submitted: 0 };
    const BATCH_SIZE = 20;

    for (let i = 0; i < rowIds.length; i += BATCH_SIZE) {
      const batch = rowIds.slice(i, i + BATCH_SIZE);

      const response = await fetch(ENDPOINT_FOR[provider], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyFor(batch, resultColumnId)),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `API error ${response.status}`);
      }

      const data = await response.json();

      // Update local cells from results
      for (const result of data.results) {
        // 'submitted' is the async AI Ark case — leave the cell in 'processing'
        // until the webhook fires and the next fetchTable picks up the result.
        const cellStatus: 'complete' | 'error' | 'processing' =
          result.status === 'submitted'
            ? 'processing'
            : result.success
              ? 'complete'
              : 'error';
        updateCell(result.rowId, resultColumnId, {
          value: result.email || null,
          status: cellStatus,
          enrichmentData: result.enrichmentData,
          metadata: result.metadata,
          error: result.error,
        });

        // Track summary
        if (result.status === 'found') summary.found++;
        else if (result.status === 'catch_all') summary.catchAll++;
        else if (result.status === 'not_found') summary.notFound++;
        else if (result.status === 'skipped') summary.skipped++;
        else if (result.status === 'submitted') summary.submitted++;
        else if (result.status === 'error') summary.errors++;
      }

      setProgress({ completed: Math.min(i + batch.length, rowIds.length), total: rowIds.length });
    }

    setResultSummary(summary);
    await fetchTable(tableId, true);
  };

  // Run ONE provider over rowIds in batches, calling onResult for each row.
  const runProviderBatch = async (
    p: ProviderId,
    rowIds: string[],
    resultColumnId: string,
    onResult: (r: FindEmailResult) => void,
  ) => {
    const BATCH_SIZE = 20;
    for (let i = 0; i < rowIds.length; i += BATCH_SIZE) {
      const batch = rowIds.slice(i, i + BATCH_SIZE);
      const response = await fetch(ENDPOINT_FOR[p], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyFor(batch, resultColumnId)),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `API error ${response.status}`);
      }
      const data = await response.json();
      for (const result of (data.results as FindEmailResult[]) || []) onResult(result);
    }
  };

  // Waterfall: run the chosen providers IN ORDER into ONE COLUMN PER PROVIDER.
  // Each stage runs only on rows still missing a valid email, so later providers'
  // columns are naturally sparse (true fall-through — NOT N× the cost). Client-side
  // so it isn't bound by the 240s ingress timeout (AI Ark is awaited via polling).
  const runWaterfall = async (rowIds: string[]) => {
    if (!tableId || waterfallProviders.length === 0) return;
    setError(null);
    setResultSummary(null);

    // Create/reuse one column per provider in the chain up front so the full
    // waterfall structure is visible even before the later stages run.
    const colFor: Partial<Record<ProviderId, string>> = {};
    for (const p of waterfallProviders) colFor[p] = await getOrCreateProviderColumn(p);

    setProgress({ completed: 0, total: rowIds.length });
    const remaining = new Set(rowIds);
    const failures: string[] = [];
    const POLL_MS = 8000;
    const POLL_CAP_MS = 150000;

    for (const p of waterfallProviders) {
      if (remaining.size === 0) break;
      const colId = colFor[p]!;
      const targets = Array.from(remaining);
      setStageLabel(`${PROVIDER_LABEL[p]} — checking ${targets.length}`);
      setProgress({ completed: rowIds.length - targets.length, total: rowIds.length });
      for (const id of targets) updateCell(id, colId, { value: null, status: 'processing' });

      try {
        await runProviderBatch(p, targets, colId, (result) => {
          const cellStatus: 'complete' | 'error' | 'processing' =
            result.status === 'submitted' ? 'processing' : result.success ? 'complete' : 'error';
          updateCell(result.rowId, colId, {
            value: result.email || null,
            status: cellStatus,
            enrichmentData: result.enrichmentData,
            error: result.error,
          });
          // Sync providers resolve inline; AI Ark stays 'submitted' until we poll.
          if (p !== 'ai_ark' && looksLikeEmail(result.email)) remaining.delete(result.rowId);
        });

        // AI Ark is async — wait for its webhooks to fill its column, refreshing
        // `remaining` from the freshly-fetched rows before the next provider runs.
        if (p === 'ai_ark') {
          const startedAt = Date.now();
          while (Date.now() - startedAt < POLL_CAP_MS) {
            await sleep(POLL_MS);
            await fetchTable(tableId, true);
            const freshRows = useTableStore.getState().rows;
            let stillProcessing = 0;
            for (const id of targets) {
              const cell = freshRows.find((r) => r.id === id)?.data?.[colId];
              if (looksLikeEmail(cell?.value)) remaining.delete(id);
              else if (cell?.status === 'processing') stillProcessing++;
            }
            setStageLabel(`AI Ark — ${stillProcessing} still processing`);
            if (stillProcessing === 0) break;
          }
        }
      } catch (err) {
        // A provider-level failure (missing key, 500, …) must NOT kill the chain —
        // record it and continue so the remaining providers still get a shot.
        failures.push(`${PROVIDER_LABEL[p]}: ${(err as Error).message}`);
      }
    }

    setProgress({ completed: rowIds.length, total: rowIds.length });
    setStageLabel(null);
    setResultSummary({
      found: rowIds.length - remaining.size,
      catchAll: 0,
      notFound: remaining.size,
      errors: 0,
      skipped: 0,
      submitted: 0,
    });
    if (failures.length) {
      setError(`Some providers were skipped (the chain continued): ${failures.join('; ')}`);
    }
    await fetchTable(tableId, true);
  };

  const handleRun = async () => {
    setIsRunning(true);
    try {
      const rowIds = condColumnId ? conditionFilteredIds : (
        selectedRows.size > 0 ? Array.from(selectedRows) : rows.map(r => r.id)
      );
      await (mode === 'waterfall' ? runWaterfall(rowIds) : processRows(rowIds));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const firstRowId = rows[0]?.id;
      if (!firstRowId) throw new Error('No rows to test');
      await (mode === 'waterfall' ? runWaterfall([firstRowId]) : processRows([firstRowId]));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsTesting(false);
    }
  };

  if (!isOpen) return null;

  const selectClasses = 'select-chevron w-full bg-white/5 border border-white/10 pl-3 pr-9 py-2 text-sm text-white focus:outline-none focus:border-lavender';

  return (
    <div className="absolute inset-y-0 right-0 w-96 z-30 flex flex-col bg-midnight-100 border border-white/10 shadow-2xl animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-cyan-400" />
          <h2 className="font-semibold text-white">Find Email</h2>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/10 transition-colors">
          <X className="w-5 h-5 text-white/60" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Provider: Single (dropdown) or Waterfall (ordered tap-list) */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-white/70">Provider</label>

          {/* Single | Waterfall mode toggle */}
          <div className="flex border border-white/10 overflow-hidden">
            <button
              onClick={() => setMode('single')}
              className={cn(
                'flex-1 px-3 py-2 text-sm transition-colors border-r border-white/10',
                mode === 'single' ? 'bg-cyan-500/20 text-white' : 'bg-white/5 text-white/50 hover:text-white'
              )}
            >
              Single
            </button>
            <button
              onClick={() => setMode('waterfall')}
              className={cn(
                'flex-1 px-3 py-2 text-sm transition-colors',
                mode === 'waterfall' ? 'bg-cyan-500/20 text-white' : 'bg-white/5 text-white/50 hover:text-white'
              )}
            >
              Waterfall
            </button>
          </div>

          {mode === 'single' ? (
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
              className={selectClasses}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-white/40">
                Tap providers in the order they should run. Each one only fills the rows the previous couldn't. Tap again to remove.
              </p>
              <div className="border border-white/10 divide-y divide-white/10 overflow-hidden">
                {PROVIDERS.map((p) => {
                  const order = waterfallProviders.indexOf(p.id);
                  const selected = order !== -1;
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleWaterfall(p.id)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 text-sm transition-colors',
                        selected ? 'bg-cyan-500/20 text-white' : 'bg-white/5 text-white/50 hover:text-white'
                      )}
                    >
                      <span>{p.label}</span>
                      {selected ? (
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cyan-400 text-midnight-100 text-xs font-semibold">
                          {order + 1}
                        </span>
                      ) : (
                        <span className="text-xs text-white/30">Add</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {((mode === 'single' && provider === 'ai_ark') || (mode === 'waterfall' && waterfallProviders.includes('ai_ark'))) && (
            <p className="text-xs text-amber-300/80">
              AI Ark is async — those rows are submitted and resolve over the next 1-2 minutes via webhook{mode === 'waterfall' ? '; the waterfall waits for them before moving to the next provider.' : '. Cells sit on "submitted" until the webhook fires — refresh to see results land.'}
            </p>
          )}
          {((mode === 'single' && provider === 'betterenrich') || (mode === 'waterfall' && waterfallProviders.includes('betterenrich'))) && (
            <p className="text-xs text-white/40">
              BetterEnrich runs its own work-email waterfall and verifies each hit (status, verifier, ESP). Map a LinkedIn URL column below to boost match rates.
            </p>
          )}
        </div>

        {/* Input Mode Toggle */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-white/70">Input Mode</label>
          <div className="flex border border-white/10 overflow-hidden">
            <button
              onClick={() => setInputMode('full_name')}
              className={cn(
                'flex-1 px-3 py-2 text-sm transition-colors',
                inputMode === 'full_name'
                  ? 'bg-cyan-500/20 text-white border-r border-white/10'
                  : 'bg-white/5 text-white/50 hover:text-white border-r border-white/10'
              )}
            >
              Full Name
            </button>
            <button
              onClick={() => setInputMode('first_last')}
              className={cn(
                'flex-1 px-3 py-2 text-sm transition-colors',
                inputMode === 'first_last'
                  ? 'bg-cyan-500/20 text-white'
                  : 'bg-white/5 text-white/50 hover:text-white'
              )}
            >
              First + Last Name
            </button>
          </div>
        </div>

        {/* Column Mapping */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-white/70">Column Mapping</label>

          {inputMode === 'full_name' ? (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-white/40 mb-1 block">Name Column</label>
                <select
                  value={fullNameColumnId}
                  onChange={(e) => setFullNameColumnId(e.target.value)}
                  className={selectClasses}
                >
                  <option value="">Select column...</option>
                  {columns.filter(c => c.type !== 'enrichment').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-white/40 mb-1 block">First Name Column</label>
                <select
                  value={firstNameColumnId}
                  onChange={(e) => setFirstNameColumnId(e.target.value)}
                  className={selectClasses}
                >
                  <option value="">Select column...</option>
                  {columns.filter(c => c.type !== 'enrichment').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Last Name Column</label>
                <select
                  value={lastNameColumnId}
                  onChange={(e) => setLastNameColumnId(e.target.value)}
                  className={selectClasses}
                >
                  <option value="">Select column...</option>
                  {columns.filter(c => c.type !== 'enrichment').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-white/40 mb-1 block">Domain Column</label>
            <select
              value={domainColumnId}
              onChange={(e) => setDomainColumnId(e.target.value)}
              className={selectClasses}
            >
              <option value="">Select column...</option>
              {columns.filter(c => c.type !== 'enrichment').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-white/40 mb-1 block">
              LinkedIn URL Column <span className="text-white/30">(optional)</span>
            </label>
            <select
              value={linkedinColumnId}
              onChange={(e) => setLinkedinColumnId(e.target.value)}
              className={selectClasses}
            >
              <option value="">None</option>
              {columns.filter(c => c.type !== 'enrichment').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Info */}
        <div className="text-xs text-white/40">
          Will process {rowCount} {rowCount === 1 ? 'row' : 'rows'}
          {selectedRows.size > 0 ? ' (selected)' : ''}.
          Creates one result column — click any cell to view all returned datapoints (status, confidence, source) and extract any of them as a new column.
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Progress */}
        {(isRunning || isTesting) && progress.total > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                {stageLabel || 'Processing...'}
              </span>
              <span>{progress.completed} / {progress.total}</span>
            </div>
            <div className="w-full h-1.5 bg-white/10 overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-300"
                style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Results Summary */}
        {resultSummary && !isRunning && !isTesting && (
          <div className="p-3 bg-white/5 border border-white/10 space-y-1.5">
            <p className="text-sm font-medium text-white/80">Results</p>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {resultSummary.found > 0 && (
                <span className="text-emerald-400">Found: {resultSummary.found}</span>
              )}
              {resultSummary.submitted > 0 && (
                <span className="text-cyan-400">Submitted: {resultSummary.submitted}</span>
              )}
              {resultSummary.catchAll > 0 && (
                <span className="text-amber-400">Catch-all: {resultSummary.catchAll}</span>
              )}
              {resultSummary.notFound > 0 && (
                <span className="text-white/40">Not found: {resultSummary.notFound}</span>
              )}
              {resultSummary.skipped > 0 && (
                <span className="text-white/30">Skipped: {resultSummary.skipped}</span>
              )}
              {resultSummary.errors > 0 && (
                <span className="text-red-400">Errors: {resultSummary.errors}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Run Condition */}
      <div className="px-4 pb-2">
        <ConditionSection
          columns={columns}
          columnId={condColumnId}
          operator={condOperator}
          value={condValue}
          onColumnChange={setCondColumnId}
          onOperatorChange={setCondOperator}
          onValueChange={setCondValue}
          onClear={() => { setCondColumnId(''); setCondOperator('is_empty'); setCondValue(''); }}
          matchCount={conditionMatchCount}
          totalCount={baseRowCount}
        />
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 space-y-2">
        <GlassButton
          variant="ghost"
          className="w-full"
          size="sm"
          onClick={handleTest}
          disabled={!canRun || isRunning || isTesting || rows.length === 0}
          loading={isTesting}
        >
          <TestTube className="w-4 h-4 mr-1" />
          Test 1 Row
        </GlassButton>

        <GlassButton
          variant="primary"
          className="w-full"
          onClick={handleRun}
          disabled={!canRun || isRunning || isTesting || rowCount === 0}
          loading={isRunning}
        >
          <Play className="w-4 h-4 mr-1" />
          {condColumnId
            ? `Find Emails (${rowCount.toLocaleString()} matching)`
            : selectedRows.size > 0
              ? `Find Emails (${selectedRows.size} Selected)`
              : `Find Emails (${rows.length.toLocaleString()})`}
        </GlassButton>
      </div>
    </div>
  );
}
