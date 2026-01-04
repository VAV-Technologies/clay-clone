'use client';

import { useState, useRef, useEffect } from 'react';
import { Play, Square, RotateCcw, Loader2, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';
import type { Column } from '@/lib/db/schema';

interface EnrichmentRunButtonProps {
  column: Column;
  tableId: string;
}

type RunMode = 'all' | 'incomplete' | 'force' | 'custom';

export function EnrichmentRunButton({ column, tableId }: EnrichmentRunButtonProps) {
  const { activeEnrichmentJobs, setActiveJob, rows, updateCell } = useTableStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customRowCount, setCustomRowCount] = useState('10');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const activeJobId = activeEnrichmentJobs.get(column.id);
  const isRunning = !!activeJobId;

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

  // Poll for job progress
  useEffect(() => {
    if (!activeJobId) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsPolling(false);
      return;
    }

    setIsPolling(true);

    const pollProgress = async () => {
      try {
        const response = await fetch(`/api/enrichment/run?jobId=${activeJobId}`);
        if (!response.ok) {
          // Job not found, clear it
          setActiveJob(column.id, null);
          return;
        }

        const data = await response.json();

        // Update cells with new data if there are completed rows
        if (data.newlyCompletedRowIds && data.newlyCompletedRowIds.length > 0) {
          // Fetch updated row data
          const rowsResponse = await fetch(`/api/rows?tableId=${tableId}`);
          if (rowsResponse.ok) {
            const updatedRows = await rowsResponse.json();
            // Update cells for completed rows
            for (const rowId of data.newlyCompletedRowIds) {
              const updatedRow = updatedRows.find((r: { id: string }) => r.id === rowId);
              if (updatedRow && updatedRow.data[column.id]) {
                updateCell(rowId, column.id, updatedRow.data[column.id]);
              }
            }
          }
        }

        // Check if job is complete
        if (data.status === 'complete' || data.status === 'cancelled') {
          setActiveJob(column.id, null);
        }
      } catch (error) {
        console.error('Error polling job progress:', error);
      }
    };

    // Poll immediately and then every 2 seconds
    pollProgress();
    pollIntervalRef.current = setInterval(pollProgress, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeJobId, column.id, tableId, setActiveJob, updateCell]);

  const handleRunEnrichment = async (mode: RunMode, customCount?: number) => {
    setIsDropdownOpen(false);
    setShowCustomInput(false);

    if (!column.enrichmentConfigId) return;

    // Determine which rows to process based on mode
    let rowsToProcess = rows;

    if (mode === 'custom' && customCount) {
      // Take first N rows
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

    // Update UI to show processing
    for (const row of rowsToProcess) {
      updateCell(row.id, column.id, { value: null, status: 'processing' });
    }

    try {
      const response = await fetch('/api/enrichment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: column.enrichmentConfigId,
          tableId,
          targetColumnId: column.id,
          // For custom mode, pass specific row IDs
          rowIds: mode === 'custom' ? rowsToProcess.map(r => r.id) : undefined,
          onlyEmpty: mode === 'incomplete',
          includeErrors: mode === 'incomplete',
          forceRerun: mode === 'force',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start enrichment');
      }

      const data = await response.json();

      if (data.jobId) {
        setActiveJob(column.id, data.jobId);
      }
    } catch (error) {
      console.error('Error starting enrichment:', error);
      // Mark cells as error
      for (const row of rowsToProcess) {
        updateCell(row.id, column.id, {
          value: null,
          status: 'error',
          error: (error as Error).message
        });
      }
    }
  };

  const handleCancel = async () => {
    if (!activeJobId) return;

    try {
      await fetch(`/api/enrichment/run?jobId=${activeJobId}`, {
        method: 'DELETE',
      });
      // Job status will be updated via polling
    } catch (error) {
      console.error('Error cancelling enrichment:', error);
    }
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) {
      handleCancel();
    } else {
      setIsDropdownOpen(!isDropdownOpen);
    }
  };

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
        title={isRunning ? 'Stop enrichment' : 'Run enrichment'}
      >
        {isRunning ? (
          isPolling ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Square className="w-3 h-3" />
          )
        ) : (
          <Play className="w-3 h-3" />
        )}
      </button>

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
