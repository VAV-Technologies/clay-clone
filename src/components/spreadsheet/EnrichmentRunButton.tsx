'use client';

import { useState, useRef, useEffect } from 'react';
import { Play, Square, RotateCcw, Loader2, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';
import type { Column, CellValue } from '@/lib/db/schema';

interface EnrichmentRunButtonProps {
  column: Column;
  tableId: string;
}

type RunMode = 'all' | 'incomplete' | 'force' | 'custom';

const BATCH_SIZE = 3; // Process 3 rows at a time to stay within Vercel timeout

export function EnrichmentRunButton({ column, tableId }: EnrichmentRunButtonProps) {
  const { rows, updateCell, addColumn, fetchTable } = useTableStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customRowCount, setCustomRowCount] = useState('10');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
        setShowCustomInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus custom input when shown
  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus();
      customInputRef.current.select();
    }
  }, [showCustomInput]);

  const handleRunEnrichment = async (mode: RunMode, customCount?: number) => {
    setIsDropdownOpen(false);
    setShowCustomInput(false);

    if (!column.enrichmentConfigId) return;

    // Determine which rows to process based on mode
    let rowsToProcess = [...rows];

    if (mode === 'custom' && customCount) {
      rowsToProcess = rows.slice(0, customCount);
    } else if (mode === 'incomplete') {
      rowsToProcess = rows.filter((row) => {
        const cellValue = row.data[column.id];
        if (!cellValue || !cellValue.value) return true;
        if (cellValue.status === 'error') return true;
        return false;
      });
    }
    // 'all' and 'force' use all rows

    if (rowsToProcess.length === 0) {
      return;
    }

    setIsRunning(true);
    cancelledRef.current = false;
    setProgress({ completed: 0, total: rowsToProcess.length });

    // Mark all target cells as 'processing'
    for (const row of rowsToProcess) {
      updateCell(row.id, column.id, { value: null, status: 'processing' });
    }

    try {
      // Process in batches
      for (let i = 0; i < rowsToProcess.length; i += BATCH_SIZE) {
        // Check for cancellation
        if (cancelledRef.current) {
          // Mark remaining as cancelled
          for (let j = i; j < rowsToProcess.length; j++) {
            updateCell(rowsToProcess[j].id, column.id, {
              value: null,
              status: 'error',
              error: 'Cancelled by user',
            });
          }
          break;
        }

        const batch = rowsToProcess.slice(i, i + BATCH_SIZE);
        const batchRowIds = batch.map(r => r.id);

        try {
          const response = await fetch('/api/enrichment/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              configId: column.enrichmentConfigId,
              tableId,
              targetColumnId: column.id,
              rowIds: batchRowIds,
              onlyEmpty: mode === 'incomplete',
              includeErrors: mode === 'incomplete',
              forceRerun: mode === 'force',
            }),
          });

          if (!response.ok) {
            throw new Error('API request failed');
          }

          const data = await response.json();

          // Update cells from results
          if (data.results) {
            for (const result of data.results) {
              if (result.data && result.data[column.id]) {
                updateCell(result.rowId, column.id, result.data[column.id]);
              }
              // Also update any output columns
              if (result.data) {
                for (const [colId, cellData] of Object.entries(result.data)) {
                  if (colId !== column.id) {
                    updateCell(result.rowId, colId, cellData as CellValue);
                  }
                }
              }
            }
          }

          // Add any new columns to the store
          if (data.newColumns && data.newColumns.length > 0) {
            for (const newCol of data.newColumns) {
              addColumn(newCol);
            }
          }

          // Update progress
          setProgress(prev => ({
            ...prev,
            completed: Math.min(i + BATCH_SIZE, rowsToProcess.length),
          }));

        } catch (batchError) {
          console.error('Batch error:', batchError);
          // Mark batch as error
          for (const row of batch) {
            updateCell(row.id, column.id, {
              value: null,
              status: 'error',
              error: (batchError as Error).message,
            });
          }
          setProgress(prev => ({
            ...prev,
            completed: Math.min(i + BATCH_SIZE, rowsToProcess.length),
          }));
        }
      }

    } catch (error) {
      console.error('Error running enrichment:', error);
    } finally {
      setIsRunning(false);
      setProgress({ completed: 0, total: 0 });
      // Refresh table to get latest state
      fetchTable(tableId);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) {
      handleCancel();
    } else {
      setIsDropdownOpen(!isDropdownOpen);
    }
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      <button
        onClick={handleButtonClick}
        className={cn(
          'flex items-center justify-center w-5 h-5 rounded transition-colors',
          'border',
          isRunning
            ? 'text-red-400 bg-red-500/20 border-red-500/30 hover:bg-red-500/30'
            : 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30 hover:bg-emerald-500/30'
        )}
        title={isRunning ? `Stop (${progressPercent}%)` : 'Run enrichment'}
      >
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Play className="w-3 h-3" />
        )}
      </button>

      {/* Progress indicator */}
      {isRunning && progress.total > 0 && (
        <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white/10 rounded overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Dropdown menu */}
      {isDropdownOpen && !isRunning && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px]
                        bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/10
                        rounded-lg shadow-xl overflow-hidden">
          <button
            onClick={() => handleRunEnrichment('all')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80
                       hover:bg-white/10 transition-colors text-left"
          >
            <Play className="w-4 h-4 text-lavender" />
            Run on All Rows
          </button>
          <button
            onClick={() => handleRunEnrichment('incomplete')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80
                       hover:bg-white/10 transition-colors text-left"
          >
            <Play className="w-4 h-4 text-emerald-400" />
            Run on Incomplete
          </button>
          <div className="border-t border-white/10" />
          {/* Custom row count option */}
          {!showCustomInput ? (
            <button
              onClick={() => setShowCustomInput(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80
                         hover:bg-white/10 transition-colors text-left"
            >
              <Hash className="w-4 h-4 text-cyan-400" />
              Run Custom Amount...
            </button>
          ) : (
            <div className="px-3 py-2 space-y-2">
              <label className="text-xs text-white/50">Run first N rows:</label>
              <div className="flex gap-2">
                <input
                  ref={customInputRef}
                  type="number"
                  min="1"
                  max={rows.length}
                  value={customRowCount}
                  onChange={(e) => setCustomRowCount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const count = parseInt(customRowCount, 10);
                      if (count > 0) {
                        handleRunEnrichment('custom', count);
                      }
                    } else if (e.key === 'Escape') {
                      setShowCustomInput(false);
                    }
                  }}
                  className="w-20 px-2 py-1 text-sm bg-white/10 border border-white/20
                             rounded text-white focus:outline-none focus:border-cyan-400"
                />
                <button
                  onClick={() => {
                    const count = parseInt(customRowCount, 10);
                    if (count > 0) {
                      handleRunEnrichment('custom', count);
                    }
                  }}
                  className="px-2 py-1 text-sm bg-cyan-500/20 border border-cyan-500/30
                             rounded text-cyan-400 hover:bg-cyan-500/30 transition-colors"
                >
                  Run
                </button>
              </div>
              <p className="text-xs text-white/40">of {rows.length} total rows</p>
            </div>
          )}
          <div className="border-t border-white/10" />
          <button
            onClick={() => handleRunEnrichment('force')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80
                       hover:bg-white/10 transition-colors text-left"
          >
            <RotateCcw className="w-4 h-4 text-amber-400" />
            Force Re-run All
          </button>
        </div>
      )}
    </div>
  );
}
