'use client';

import { useState, useEffect } from 'react';
import {
  Mail,
  X,
  AlertCircle,
  Check,
  Loader2,
  RefreshCw,
  Zap,
  User,
  Globe,
  Play,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton, GlassCard } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';

interface NinjaEmailFinderPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NinjaEmailJob {
  id: string;
  status: string;
  totalRows: number;
  processedCount: number;
  foundCount: number;
  notFoundCount: number;
  errorCount: number;
  createdAt: string;
  completedAt?: string;
}

type InputMode = 'fullName' | 'firstLast';

export function NinjaEmailFinderPanel({ isOpen, onClose }: NinjaEmailFinderPanelProps) {
  const { currentTable, columns, rows, selectedRows, fetchTable } = useTableStore();

  // Input configuration
  const [inputMode, setInputMode] = useState<InputMode>('fullName');
  const [fullNameColumnId, setFullNameColumnId] = useState('');
  const [firstNameColumnId, setFirstNameColumnId] = useState('');
  const [lastNameColumnId, setLastNameColumnId] = useState('');
  const [domainColumnId, setDomainColumnId] = useState('');
  const [outputColumnName, setOutputColumnName] = useState('Found Email');

  // Processing state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    email?: string;
    status?: string;
    error?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);

  // Active jobs
  const [activeJobs, setActiveJobs] = useState<NinjaEmailJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);

  // Reset form when panel opens
  useEffect(() => {
    if (isOpen) {
      setSubmittedJobId(null);
      setError(null);
      setTestResult(null);
      loadActiveJobs();
    }
  }, [isOpen]);

  // Poll for job updates
  useEffect(() => {
    if (!isOpen || activeJobs.length === 0) return;

    const hasActiveJob = activeJobs.some(j =>
      ['pending', 'running'].includes(j.status)
    );

    if (!hasActiveJob) return;

    const interval = setInterval(() => {
      loadActiveJobs();
      // Also refresh table data to show updated cells
      if (currentTable) {
        fetchTable(currentTable.id, true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isOpen, activeJobs, currentTable, fetchTable]);

  const loadActiveJobs = async () => {
    if (!currentTable) return;

    setIsLoadingJobs(true);
    try {
      const response = await fetch(`/api/ninja-email/jobs?tableId=${currentTable.id}`);
      if (response.ok) {
        const data = await response.json();
        setActiveJobs(data.jobs || []);
      }
    } catch (err) {
      console.error('Failed to load ninja email jobs:', err);
    } finally {
      setIsLoadingJobs(false);
    }
  };

  // Check if form is valid
  const isFormValid = () => {
    if (inputMode === 'fullName') {
      return fullNameColumnId && domainColumnId && outputColumnName.trim();
    } else {
      return firstNameColumnId && lastNameColumnId && domainColumnId && outputColumnName.trim();
    }
  };

  // Get row count text
  const getRowCountText = () => {
    if (selectedRows.size > 0) {
      return `${selectedRows.size} selected rows`;
    }
    return `${rows.length} rows`;
  };

  // Get sample row data for preview
  const getSampleData = () => {
    const sampleRow = rows[0];
    if (!sampleRow) return null;

    const getName = () => {
      if (inputMode === 'fullName' && fullNameColumnId) {
        return sampleRow.data[fullNameColumnId]?.value || '[empty]';
      } else if (firstNameColumnId && lastNameColumnId) {
        const first = sampleRow.data[firstNameColumnId]?.value || '';
        const last = sampleRow.data[lastNameColumnId]?.value || '';
        return `${first} ${last}`.trim() || '[empty]';
      }
      return '[select columns]';
    };

    const getDomain = () => {
      if (domainColumnId) {
        return sampleRow.data[domainColumnId]?.value || '[empty]';
      }
      return '[select column]';
    };

    return { name: getName(), domain: getDomain() };
  };

  // Test 1 row
  const handleTest = async () => {
    if (!currentTable || !isFormValid()) return;

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const testRowId = selectedRows.size > 0
        ? Array.from(selectedRows)[0]
        : rows[0]?.id;

      if (!testRowId) {
        throw new Error('No rows available to test');
      }

      const response = await fetch('/api/ninja-email/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: currentTable.id,
          rowId: testRowId,
          inputMode,
          fullNameColumnId: inputMode === 'fullName' ? fullNameColumnId : undefined,
          firstNameColumnId: inputMode === 'firstLast' ? firstNameColumnId : undefined,
          lastNameColumnId: inputMode === 'firstLast' ? lastNameColumnId : undefined,
          domainColumnId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Test failed');
      }

      setTestResult(result);

    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsTesting(false);
    }
  };

  // Submit job for all rows
  const handleSubmit = async () => {
    if (!currentTable || !isFormValid()) return;

    setIsSubmitting(true);
    setError(null);
    setSubmittedJobId(null);

    try {
      // Determine which rows to process
      const rowIdsToProcess = selectedRows.size > 0
        ? Array.from(selectedRows)
        : rows.map(r => r.id);

      const response = await fetch('/api/ninja-email/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: currentTable.id,
          rowIds: rowIdsToProcess,
          inputMode,
          fullNameColumnId: inputMode === 'fullName' ? fullNameColumnId : undefined,
          firstNameColumnId: inputMode === 'firstLast' ? firstNameColumnId : undefined,
          lastNameColumnId: inputMode === 'firstLast' ? lastNameColumnId : undefined,
          domainColumnId,
          outputColumnName: outputColumnName.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create job');
      }

      setSubmittedJobId(result.jobId);

      // Refresh table to show new column
      await fetchTable(currentTable.id, true);

      // Reload active jobs
      await loadActiveJobs();

    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-500/20 text-emerald-400';
      case 'error':
      case 'cancelled':
        return 'bg-red-500/20 text-red-400';
      case 'running':
        return 'bg-cyan-500/20 text-cyan-400';
      default:
        return 'bg-white/10 text-white/60';
    }
  };

  if (!isOpen) return null;

  const sampleData = getSampleData();

  return (
    <div className="fixed inset-y-0 right-0 w-96 glass-sidebar flex flex-col z-40 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-cyan-400" />
          <h2 className="font-semibold text-white">Ninja Email Finder</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded transition-colors"
        >
          <X className="w-5 h-5 text-white/60" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Info Banner */}
        <GlassCard padding="sm" className="bg-cyan-500/5 border-cyan-500/20">
          <div className="flex items-start gap-2">
            <Zap className="w-4 h-4 text-cyan-400 mt-0.5" />
            <div className="text-xs text-white/70">
              <p className="font-medium text-cyan-400 mb-1">MailTester Ninja API</p>
              <p>Finds verified email addresses by testing multiple format variations against the domain.</p>
            </div>
          </div>
        </GlassCard>

        {/* Input Mode Selection */}
        <div className="space-y-2 pb-4 border-b border-white/10">
          <label className="text-sm font-medium text-white/70">Name Input Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => setInputMode('fullName')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-all',
                inputMode === 'fullName'
                  ? 'bg-cyan-500/10 border-cyan-500/30'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              )}
            >
              <User className="w-4 h-4" />
              <span className="text-sm">Full Name</span>
            </button>
            <button
              onClick={() => setInputMode('firstLast')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-all',
                inputMode === 'firstLast'
                  ? 'bg-cyan-500/10 border-cyan-500/30'
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              )}
            >
              <Users className="w-4 h-4" />
              <span className="text-sm">First + Last</span>
            </button>
          </div>
        </div>

        {/* Column Selection */}
        <div className="space-y-3 pb-4 border-b border-white/10">
          <label className="text-sm font-medium text-white/70">Input Columns</label>

          {inputMode === 'fullName' ? (
            <div className="space-y-2">
              <label className="text-xs text-white/50">Full Name Column</label>
              <select
                value={fullNameColumnId}
                onChange={(e) => setFullNameColumnId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
              >
                <option value="">Select column...</option>
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-xs text-white/50">First Name Column</label>
                <select
                  value={firstNameColumnId}
                  onChange={(e) => setFirstNameColumnId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="">Select column...</option>
                  {columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-white/50">Last Name Column</label>
                <select
                  value={lastNameColumnId}
                  onChange={(e) => setLastNameColumnId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="">Select column...</option>
                  {columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="text-xs text-white/50 flex items-center gap-1">
              <Globe className="w-3 h-3" />
              Domain Column
            </label>
            <select
              value={domainColumnId}
              onChange={(e) => setDomainColumnId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="">Select column...</option>
              {columns.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Output Column Name */}
        <div className="space-y-2 pb-4 border-b border-white/10">
          <label className="text-sm font-medium text-white/70">Output Column Name</label>
          <input
            type="text"
            value={outputColumnName}
            onChange={(e) => setOutputColumnName(e.target.value)}
            placeholder="e.g., Found Email"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
          />
        </div>

        {/* Preview */}
        {sampleData && isFormValid() && (
          <GlassCard padding="sm" className="space-y-2">
            <p className="text-xs font-medium text-white/50">Preview (first row)</p>
            <div className="text-sm text-white/70 space-y-1">
              <p>
                <span className="text-white/50">Name:</span>{' '}
                <span className="text-cyan-300">{sampleData.name}</span>
              </p>
              <p>
                <span className="text-white/50">Domain:</span>{' '}
                <span className="text-cyan-300">{sampleData.domain}</span>
              </p>
            </div>
          </GlassCard>
        )}

        {/* Test Result */}
        {testResult && (
          <GlassCard
            padding="sm"
            className={cn(
              testResult.success
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            )}
          >
            <div className="flex items-start gap-2">
              {testResult.success ? (
                <Check className="w-4 h-4 text-emerald-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
              )}
              <div className="text-sm flex-1">
                {testResult.success ? (
                  <>
                    <p className="font-medium text-emerald-400">Email Found!</p>
                    <p className="text-white/80 font-mono text-xs mt-1">{testResult.email}</p>
                    <p className="text-white/50 text-xs mt-1">Status: {testResult.status}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-red-400">Not Found</p>
                    <p className="text-white/60 text-xs mt-1">{testResult.error || 'No valid email found'}</p>
                  </>
                )}
              </div>
            </div>
          </GlassCard>
        )}

        {/* Active Jobs */}
        {activeJobs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white/70">Active Jobs</label>
              <button
                onClick={loadActiveJobs}
                disabled={isLoadingJobs}
                className="p-1 hover:bg-white/10 rounded transition-colors"
              >
                <RefreshCw className={cn("w-4 h-4 text-white/40", isLoadingJobs && "animate-spin")} />
              </button>
            </div>

            <div className="space-y-2">
              {activeJobs.slice(0, 5).map((job) => (
                <GlassCard key={job.id} padding="sm" className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "px-2 py-0.5 text-xs font-medium rounded-full",
                      getStatusColor(job.status)
                    )}>
                      {job.status}
                    </span>
                    <span className="text-xs text-white/40">
                      {new Date(job.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">
                      {job.processedCount.toLocaleString()} / {job.totalRows.toLocaleString()} rows
                    </span>
                    <div className="flex items-center gap-2">
                      {job.foundCount > 0 && (
                        <span className="text-emerald-400">{job.foundCount} found</span>
                      )}
                      {job.notFoundCount > 0 && (
                        <span className="text-white/50">{job.notFoundCount} not found</span>
                      )}
                      {job.errorCount > 0 && (
                        <span className="text-red-400">{job.errorCount} errors</span>
                      )}
                    </div>
                  </div>

                  {job.status === 'running' && (
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-all"
                        style={{ width: `${job.totalRows > 0 ? (job.processedCount / job.totalRows) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          </div>
        )}

        {/* Success Message */}
        {submittedJobId && (
          <GlassCard padding="sm" className="bg-emerald-500/10 border-emerald-500/30">
            <div className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-400 mt-0.5" />
              <div className="text-sm flex-1">
                <p className="font-medium text-emerald-400">Job submitted!</p>
                <p className="text-white/60 text-xs mt-1">
                  Processing {getRowCountText()}. Results will appear in the &quot;{outputColumnName}&quot; column.
                </p>
                <button
                  onClick={() => {
                    setSubmittedJobId(null);
                    setOutputColumnName('Found Email');
                  }}
                  className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 underline"
                >
                  Create another job
                </button>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="flex gap-2">
          <GlassButton
            variant="default"
            size="sm"
            className="flex-1"
            onClick={handleTest}
            disabled={!isFormValid() || isTesting}
            loading={isTesting}
          >
            <Play className="w-4 h-4 mr-1" />
            Test 1 Row
          </GlassButton>

          <GlassButton
            variant="primary"
            className="flex-1 bg-cyan-500/20 border-cyan-500/30 hover:bg-cyan-500/30"
            onClick={handleSubmit}
            disabled={!isFormValid() || isSubmitting || !!submittedJobId}
            loading={isSubmitting}
          >
            <Mail className="w-4 h-4 mr-1" />
            {submittedJobId ? 'Submitted' : `Find Emails (${getRowCountText()})`}
          </GlassButton>
        </div>

        <p className="text-xs text-center text-white/40">
          Jobs process in background via cron. Close this panel anytime.
        </p>
      </div>
    </div>
  );
}
