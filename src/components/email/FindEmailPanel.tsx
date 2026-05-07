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

export function FindEmailPanel({ isOpen, onClose }: FindEmailPanelProps) {
  const { currentTable, columns, rows, selectedRows, updateCell, addColumn, fetchTable } = useTableStore();

  const [provider, setProvider] = useState<'ninjer' | 'trykitt' | 'ai_ark'>('ninjer');
  const [inputMode, setInputMode] = useState<'full_name' | 'first_last'>('full_name');
  const [fullNameColumnId, setFullNameColumnId] = useState('');
  const [firstNameColumnId, setFirstNameColumnId] = useState('');
  const [lastNameColumnId, setLastNameColumnId] = useState('');
  const [domainColumnId, setDomainColumnId] = useState('');

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
    if (inputMode === 'full_name') return !!fullNameColumnId;
    return !!(firstNameColumnId && lastNameColumnId);
  })();

  const getOrCreateOutputColumns = async (): Promise<{ emailColId: string; statusColId: string }> => {
    // Check if "Email" and "Email Status" columns already exist
    const existingEmailCol = columns.find(c => c.name === 'Email' && c.type === 'text');
    const existingStatusCol = columns.find(c => c.name === 'Email Status' && c.type === 'text');

    let emailColId = existingEmailCol?.id || '';
    let statusColId = existingStatusCol?.id || '';

    if (!emailColId) {
      const res = await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, name: 'Email', type: 'text' }),
      });
      const col = await res.json();
      addColumn(col);
      emailColId = col.id;
    }

    if (!statusColId) {
      const res = await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, name: 'Email Status', type: 'text' }),
      });
      const col = await res.json();
      addColumn(col);
      statusColId = col.id;
    }

    return { emailColId, statusColId };
  };

  const processRows = async (rowIds: string[]) => {
    if (!tableId) return;

    setError(null);
    setResultSummary(null);

    const { emailColId, statusColId } = await getOrCreateOutputColumns();

    // Mark cells as processing
    for (const rowId of rowIds) {
      updateCell(rowId, emailColId, { value: null, status: 'processing' });
      updateCell(rowId, statusColId, { value: null, status: 'processing' });
    }

    setProgress({ completed: 0, total: rowIds.length });

    const summary = { found: 0, catchAll: 0, notFound: 0, errors: 0, skipped: 0, submitted: 0 };
    const BATCH_SIZE = 20;

    for (let i = 0; i < rowIds.length; i += BATCH_SIZE) {
      const batch = rowIds.slice(i, i + BATCH_SIZE);

      const endpoint =
        provider === 'trykitt'
          ? '/api/find-email/trykitt'
          : provider === 'ai_ark'
            ? '/api/find-email/ai-ark'
            : '/api/find-email/run';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId,
          rowIds: batch,
          inputMode,
          fullNameColumnId: inputMode === 'full_name' ? fullNameColumnId : undefined,
          firstNameColumnId: inputMode === 'first_last' ? firstNameColumnId : undefined,
          lastNameColumnId: inputMode === 'first_last' ? lastNameColumnId : undefined,
          domainColumnId,
          emailColumnId: emailColId,
          emailStatusColumnId: statusColId,
        }),
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
        updateCell(result.rowId, emailColId, {
          value: result.email || '',
          status: cellStatus,
        });
        updateCell(result.rowId, statusColId, {
          value: result.status,
          status: cellStatus,
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

  const handleRun = async () => {
    setIsRunning(true);
    try {
      const rowIds = condColumnId ? conditionFilteredIds : (
        selectedRows.size > 0 ? Array.from(selectedRows) : rows.map(r => r.id)
      );
      await processRows(rowIds);
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
      await processRows([firstRowId]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsTesting(false);
    }
  };

  if (!isOpen) return null;

  const selectClasses = 'w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-lavender';

  return (
    <div className="fixed inset-y-0 right-0 w-96 glass-sidebar flex flex-col z-40 animate-slide-in">
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
        {/* Provider Toggle */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-white/70">Provider</label>
          <div className="flex border border-white/10 overflow-hidden">
            <button
              onClick={() => setProvider('ninjer')}
              className={cn(
                'flex-1 px-3 py-2 text-sm transition-colors border-r border-white/10',
                provider === 'ninjer'
                  ? 'bg-cyan-500/20 text-white'
                  : 'bg-white/5 text-white/50 hover:text-white'
              )}
            >
              Ninjer
            </button>
            <button
              onClick={() => setProvider('trykitt')}
              className={cn(
                'flex-1 px-3 py-2 text-sm transition-colors border-r border-white/10',
                provider === 'trykitt'
                  ? 'bg-cyan-500/20 text-white'
                  : 'bg-white/5 text-white/50 hover:text-white'
              )}
            >
              TryKitt
            </button>
            <button
              onClick={() => setProvider('ai_ark')}
              className={cn(
                'flex-1 px-3 py-2 text-sm transition-colors',
                provider === 'ai_ark'
                  ? 'bg-cyan-500/20 text-white'
                  : 'bg-white/5 text-white/50 hover:text-white'
              )}
            >
              AI Ark
            </button>
          </div>
          {provider === 'ai_ark' && (
            <p className="text-xs text-amber-300/80">
              AI Ark is async. Each row is searched + submitted to AI Ark; emails arrive at our webhook over the next 1-2 minutes. Cells will sit on "submitted" until the webhook fires — refresh the table to see results land.
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
        </div>

        {/* Info */}
        <div className="text-xs text-white/40">
          Will process {rowCount} {rowCount === 1 ? 'row' : 'rows'}
          {selectedRows.size > 0 ? ' (selected)' : ''}.
          Creates "Email" and "Email Status" columns.
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
                Processing...
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
