'use client';

import { useState, useEffect } from 'react';
import { Link2, X, Play, AlertCircle, Check, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import { ConditionSection } from '@/components/shared/ConditionSection';
import { type FilterOperator } from '@/lib/filter-utils';
import type { Column } from '@/lib/db/schema';

interface LookUpPanelProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
}

export function LookUpPanel({ isOpen, onClose, tableId }: LookUpPanelProps) {
  const { columns, sheets, activeSheetId, fetchTable } = useTableStore();

  // Source sheet selection
  const [sourceSheetId, setSourceSheetId] = useState('');
  const [sourceColumns, setSourceColumns] = useState<Column[]>([]);
  const [loadingSourceCols, setLoadingSourceCols] = useState(false);

  // Column mapping
  const [inputColumnId, setInputColumnId] = useState('');   // Column in current sheet
  const [matchColumnId, setMatchColumnId] = useState('');    // Column in source sheet to match
  const [returnColumnId, setReturnColumnId] = useState('');  // Column in source sheet to pull

  // Output
  const [newColumnName, setNewColumnName] = useState('');

  // Run condition
  const [condColumnId, setCondColumnId] = useState('');
  const [condOperator, setCondOperator] = useState<FilterOperator>('is_empty');
  const [condValue, setCondValue] = useState('');

  // State
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ processedCount: number; matchedCount: number; unmatchedCount: number } | null>(null);

  // Other sheets in this workbook (exclude current)
  const otherSheets = sheets.filter(s => s.id !== activeSheetId);

  // Fetch source sheet columns when selection changes
  useEffect(() => {
    if (!sourceSheetId) {
      setSourceColumns([]);
      setMatchColumnId('');
      setReturnColumnId('');
      return;
    }

    setLoadingSourceCols(true);
    fetch(`/api/columns?tableId=${sourceSheetId}`)
      .then(r => r.json())
      .then(cols => {
        setSourceColumns(cols);
        setMatchColumnId('');
        setReturnColumnId('');
      })
      .catch(() => setSourceColumns([]))
      .finally(() => setLoadingSourceCols(false));
  }, [sourceSheetId]);

  // Auto-fill column name when return column changes
  useEffect(() => {
    if (!returnColumnId || sourceColumns.length === 0) return;
    const returnCol = sourceColumns.find(c => c.id === returnColumnId);
    const sourceSheet = sheets.find(s => s.id === sourceSheetId);
    if (returnCol && sourceSheet) {
      setNewColumnName(`${returnCol.name} (from ${sourceSheet.name})`);
    }
  }, [returnColumnId, sourceColumns, sourceSheetId, sheets]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSourceSheetId('');
      setSourceColumns([]);
      setInputColumnId('');
      setMatchColumnId('');
      setReturnColumnId('');
      setNewColumnName('');
      setError(null);
      setResult(null);
    }
  }, [isOpen]);

  const canRun = sourceSheetId && inputColumnId && matchColumnId && returnColumnId && newColumnName.trim();

  const handleRun = async () => {
    if (!canRun) return;
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      // 1. Create the new column in current table
      const colRes = await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, name: newColumnName.trim(), type: 'text' }),
      });
      if (!colRes.ok) throw new Error('Failed to create column');
      const newCol = await colRes.json();

      // 2. Run the lookup (with optional condition)
      const lookupBody: Record<string, unknown> = {
        tableId,
        sourceTableId: sourceSheetId,
        inputColumnId,
        matchColumnId,
        returnColumnId,
        targetColumnId: newCol.id,
      };
      if (condColumnId) {
        lookupBody.condition = { columnId: condColumnId, operator: condOperator, value: condValue };
      }
      const lookupRes = await fetch('/api/lookup/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lookupBody),
      });

      if (!lookupRes.ok) {
        const err = await lookupRes.json().catch(() => ({ error: 'Lookup failed' }));
        throw new Error(err.error);
      }

      const data = await lookupRes.json();
      setResult(data);

      // 3. Reload table to show new column + data
      await fetchTable(tableId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  if (!isOpen) return null;

  const selectClasses = 'w-full bg-white/5 border border-white/10 px-3 py-2 pr-9 text-sm text-white focus:outline-none focus:border-lavender appearance-none bg-[length:16px_16px] bg-[position:right_0.5rem_center] bg-no-repeat bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2716%27%20height%3D%2716%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27rgba(255%2C255%2C255%2C0.4)%27%20stroke-width%3D%272%27%3E%3Cpath%20d%3D%27M6%209l6%206%206-6%27/%3E%3C/svg%3E")]';

  return (
    <div className="fixed inset-y-0 right-0 w-96 glass-sidebar flex flex-col z-40 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-emerald-400" />
          <h2 className="font-semibold text-white">Look Up</h2>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/10 transition-colors">
          <X className="w-5 h-5 text-white/60" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Source Sheet */}
        <div>
          <label className="text-sm font-medium text-white/70 mb-2 block">Source Sheet</label>
          <p className="text-xs text-white/40 mb-2">Which sheet to pull data from</p>
          {otherSheets.length === 0 ? (
            <p className="text-sm text-amber-400">No other sheets in this workbook. Add a sheet first.</p>
          ) : (
            <select value={sourceSheetId} onChange={e => setSourceSheetId(e.target.value)} className={selectClasses}>
              <option value="">Select sheet...</option>
              {otherSheets.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Match By */}
        {sourceSheetId && (
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">Match By</label>
            <p className="text-xs text-white/40 mb-2">Connect rows using a shared identifier</p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-white/50 mb-1 block">This sheet</label>
                <select value={inputColumnId} onChange={e => setInputColumnId(e.target.value)} className={selectClasses}>
                  <option value="">Select column...</option>
                  {columns.filter(c => c.type !== 'enrichment').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <ArrowRight className="w-4 h-4 text-white/30 mt-5 flex-shrink-0" />
              <div className="flex-1">
                <label className="text-xs text-white/50 mb-1 block">{sheets.find(s => s.id === sourceSheetId)?.name || 'Source'}</label>
                {loadingSourceCols ? (
                  <div className="flex items-center gap-2 py-2 text-white/40 text-sm">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                  </div>
                ) : (
                  <select value={matchColumnId} onChange={e => setMatchColumnId(e.target.value)} className={selectClasses}>
                    <option value="">Select column...</option>
                    {sourceColumns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Pull Column */}
        {sourceSheetId && matchColumnId && (
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">Pull Column</label>
            <p className="text-xs text-white/40 mb-2">Which data to bring into this sheet</p>
            <select value={returnColumnId} onChange={e => setReturnColumnId(e.target.value)} className={selectClasses}>
              <option value="">Select column to pull...</option>
              {sourceColumns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Column Name */}
        {returnColumnId && (
          <div>
            <label className="text-sm font-medium text-white/70 mb-2 block">New Column Name</label>
            <input
              type="text"
              value={newColumnName}
              onChange={e => setNewColumnName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-lavender"
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 space-y-1">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <p className="text-sm text-emerald-400 font-medium">Look up complete</p>
            </div>
            <div className="text-xs text-white/50 space-y-0.5 pl-6">
              <p>{result.matchedCount} rows matched</p>
              {result.unmatchedCount > 0 && <p>{result.unmatchedCount} rows had no match</p>}
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
          matchCount={0}
          totalCount={0}
        />
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <GlassButton
          variant="primary"
          className="w-full"
          onClick={handleRun}
          disabled={!canRun || isRunning}
          loading={isRunning}
        >
          <Link2 className="w-4 h-4 mr-1" />
          Create Look Up
        </GlassButton>
      </div>
    </div>
  );
}
