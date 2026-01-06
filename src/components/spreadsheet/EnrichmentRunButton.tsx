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

interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'complete' | 'cancelled' | 'error';
  currentIndex: number;
  rowIds: string[];
  processedCount: number;
  errorCount: number;
  totalCost: number;
}

export function EnrichmentRunButton({ column, tableId }: EnrichmentRunButtonProps) {
  const { rows, fetchTable } = useTableStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customRowCount, setCustomRowCount] = useState('10');
  const [activeJob, setActiveJob] = useState<JobStatus | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isRunning = activeJob && (activeJob.status === 'pending' || activeJob.status === 'running');

  // Check for existing job on mount
  useEffect(() => {
    checkExistingJob();
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [column.id]);

  // Process job batches and poll for status when running
  useEffect(() => {
    if (isRunning && activeJob) {
      // Call process endpoint and then poll for status
      const processAndPoll = async () => {
        try {
          // Trigger processing
          await fetch('/api/cron/process-enrichment');
          // Then check status
          await pollJobStatus(activeJob.id);
        } catch (error) {
          console.error('Error processing:', error);
        }
      };

      // Process immediately
      processAndPoll();

      // Then continue processing every 2 seconds
      pollIntervalRef.current = setInterval(processAndPoll, 2000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [isRunning, activeJob?.id]);

  const checkExistingJob = async () => {
    try {
      const response = await fetch(`/api/enrichment/jobs?columnId=${column.id}`);
      if (response.ok) {
        const data = await response.json();
        const runningJob = data.jobs?.find(
          (j: JobStatus) => j.status === 'pending' || j.status === 'running'
        );
        if (runningJob) {
          setActiveJob(runningJob);
        }
      }
    } catch (error) {
      console.error('Error checking existing job:', error);
    }
  };

  const pollJobStatus = async (jobId: string) => {
    try {
      const response = await fetch(`/api/enrichment/jobs?jobId=${jobId}`);
      if (response.ok) {
        const data = await response.json();
        const job = data.jobs?.[0];
        if (job) {
          setActiveJob(job);

          // If job completed, refresh table data
          if (job.status === 'complete' || job.status === 'cancelled' || job.status === 'error') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            fetchTable(tableId);
          }
        }
      }
    } catch (error) {
      console.error('Error polling job status:', error);
    }
  };

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

    if (rowsToProcess.length === 0) {
      return;
    }

    try {
      // Create background job
      const response = await fetch('/api/enrichment/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: column.enrichmentConfigId,
          tableId,
          targetColumnId: column.id,
          rowIds: rowsToProcess.map(r => r.id),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to create job:', error);
        return;
      }

      const data = await response.json();

      // Set active job and start polling
      setActiveJob({
        id: data.jobId,
        status: 'pending',
        currentIndex: 0,
        rowIds: rowsToProcess.map(r => r.id),
        processedCount: 0,
        errorCount: 0,
        totalCost: 0,
      });

      // Refresh table to show processing status
      fetchTable(tableId);

    } catch (error) {
      console.error('Error creating job:', error);
    }
  };

  const handleCancel = async () => {
    if (!activeJob) return;

    try {
      await fetch(`/api/enrichment/jobs?jobId=${activeJob.id}`, {
        method: 'DELETE',
      });

      setActiveJob(null);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      fetchTable(tableId);
    } catch (error) {
      console.error('Error cancelling job:', error);
    }
  };

  const handleCancelAll = async () => {
    setIsDropdownOpen(false);

    try {
      // Cancel all jobs for this column
      await fetch(`/api/enrichment/jobs?columnId=${column.id}`, {
        method: 'DELETE',
      });

      setActiveJob(null);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      fetchTable(tableId);
    } catch (error) {
      console.error('Error cancelling all jobs:', error);
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

  const progressPercent = activeJob && activeJob.rowIds.length > 0
    ? Math.round((activeJob.processedCount / activeJob.rowIds.length) * 100)
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
        title={isRunning ? `Stop (${progressPercent}% complete)` : 'Run enrichment'}
      >
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Play className="w-3 h-3" />
        )}
      </button>

      {/* Progress indicator */}
      {isRunning && activeJob && (
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
          <div className="px-3 py-1.5 text-xs text-emerald-400 border-b border-white/10">
            Auto-resumes if you leave and return
          </div>
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
          <div className="border-t border-white/10" />
          <button
            onClick={handleCancelAll}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400
                       hover:bg-red-500/10 transition-colors text-left"
          >
            <Square className="w-4 h-4" />
            Cancel All Runs
          </button>
        </div>
      )}
    </div>
  );
}
