'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Clock,
  X,
  AlertCircle,
  Check,
  Loader2,
  Plus,
  Database,
  RefreshCw,
  Zap,
  Wand2,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton, GlassCard } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';

interface BatchEnrichmentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface BatchJob {
  id: string;
  status: string;
  azureStatus: string;
  totalRows: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  totalCost: number;
  createdAt: string;
  completedAt?: string;
}

export function BatchEnrichmentPanel({ isOpen, onClose }: BatchEnrichmentPanelProps) {
  const { currentTable, columns, rows, selectedRows, fetchTable } = useTableStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState('');
  const [outputColumnName, setOutputColumnName] = useState('Batch Output');
  const [outputColumns, setOutputColumns] = useState<string[]>([]);
  const [newOutputColumn, setNewOutputColumn] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  const [createdColumns, setCreatedColumns] = useState<Array<{name: string, id: string}>>([]);

  // Active batch jobs for this table
  const [activeJobs, setActiveJobs] = useState<BatchJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);

  // Prompt optimizer state
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState<string | null>(null);
  const [showOptimizerModal, setShowOptimizerModal] = useState(false);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [recommendedDataGuide, setRecommendedDataGuide] = useState<
    Array<{ name: string; description: string }>
  >([]);

  // Reset form when panel opens
  useEffect(() => {
    if (isOpen) {
      setSubmittedJobId(null);
      setCreatedColumns([]);
      setError(null);
    }
  }, [isOpen]);

  // Load active batch jobs
  useEffect(() => {
    if (isOpen && currentTable) {
      loadActiveJobs();
    }
  }, [isOpen, currentTable]);

  // Poll for job updates
  useEffect(() => {
    if (!isOpen || activeJobs.length === 0) return;

    const hasActiveJob = activeJobs.some(j =>
      ['submitted', 'processing', 'uploading', 'downloading'].includes(j.status)
    );

    if (!hasActiveJob) return;

    const interval = setInterval(() => {
      loadActiveJobs();
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [isOpen, activeJobs]);

  const loadActiveJobs = async () => {
    if (!currentTable) return;

    setIsLoadingJobs(true);
    try {
      const response = await fetch(`/api/enrichment/batch/status?tableId=${currentTable.id}`);
      if (response.ok) {
        const data = await response.json();
        setActiveJobs(data.jobs || []);
      }
    } catch (err) {
      console.error('Failed to load batch jobs:', err);
    } finally {
      setIsLoadingJobs(false);
    }
  };

  // Extract variables from prompt
  const extractVariables = (text: string): string[] => {
    const regex = /\{\{(\w+)\}\}/g;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (!matches.includes(match[1])) {
        matches.push(match[1]);
      }
    }
    return matches;
  };

  const usedVariables = extractVariables(prompt);

  // Insert variable at cursor position
  const insertVariable = (columnName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const variable = `{{${columnName}}}`;
    const newPrompt = prompt.substring(0, start) + variable + prompt.substring(end);
    setPrompt(newPrompt);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  // Add new output column
  const addOutputColumn = () => {
    const trimmed = newOutputColumn.trim();
    if (trimmed && !outputColumns.some(col => col.toLowerCase() === trimmed.toLowerCase())) {
      setOutputColumns([...outputColumns, trimmed]);
      setNewOutputColumn('');
    }
  };

  // Remove output column
  const removeOutputColumn = (index: number) => {
    setOutputColumns(outputColumns.filter((_, i) => i !== index));
  };

  // Handle prompt optimization
  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) return;

    setIsOptimizing(true);
    setOptimizerError(null);
    setRecommendedDataGuide([]);

    try {
      // Send columns with the request so AI can understand available data
      const columnContext = columns.map(col => ({
        name: col.name,
        type: col.type,
      }));

      const response = await fetch('/api/enrichment/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, columns: columnContext }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to optimize prompt');
      }

      const data = await response.json();
      setOptimizedPrompt(data.optimizedPrompt);
      setRecommendedDataGuide(data.recommendedDataGuide || []);
      setShowOptimizerModal(true);
    } catch (err) {
      setOptimizerError((err as Error).message);
      setShowOptimizerModal(true);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleAcceptOptimizedPrompt = () => {
    // Accept both prompt and Data Guide together
    if (optimizedPrompt) {
      setPrompt(optimizedPrompt);
    }
    if (recommendedDataGuide.length > 0) {
      // Merge with existing output columns, avoiding duplicates
      const existingLower = outputColumns.map(c => c.toLowerCase());
      const newColumns = recommendedDataGuide
        .map(f => f.name)
        .filter(name => !existingLower.includes(name.toLowerCase()));
      setOutputColumns([...outputColumns, ...newColumns]);
    }
    setShowOptimizerModal(false);
    setOptimizedPrompt(null);
    setRecommendedDataGuide([]);
    setOptimizerError(null);
  };

  const handleDeclineOptimizedPrompt = () => {
    setShowOptimizerModal(false);
    setOptimizedPrompt(null);
    setRecommendedDataGuide([]);
    setOptimizerError(null);
  };

  const handleRetryOptimize = () => {
    setOptimizedPrompt(null);
    setRecommendedDataGuide([]);
    setOptimizerError(null);
    handleOptimizePrompt();
  };

  // Build preview prompt
  const previewPrompt = () => {
    if (rows.length === 0) return prompt;

    let preview = prompt;
    const sampleRow = rows[0];

    columns.forEach((col) => {
      const value = sampleRow.data[col.id]?.value || '[empty]';
      preview = preview.replace(
        new RegExp(`\\{\\{${col.name}\\}\\}`, 'gi'),
        String(value)
      );
    });

    return preview;
  };

  // Submit batch job
  const handleSubmit = async () => {
    if (!currentTable || !prompt.trim() || !outputColumnName.trim()) return;

    setIsSubmitting(true);
    setError(null);
    setSubmittedJobId(null);

    try {
      // First, create or get enrichment config
      const configResponse = await fetch('/api/enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: outputColumnName.trim(),
          model: 'gpt-4.1-mini', // Fixed model for batch
          prompt,
          inputColumns: usedVariables.map(v => {
            const col = columns.find(c => c.name.toLowerCase() === v.toLowerCase());
            return col?.id || v;
          }),
          outputColumns,
          outputFormat: 'text',
          temperature: 0.7,
        }),
      });

      if (!configResponse.ok) {
        throw new Error('Failed to create enrichment config');
      }

      const config = await configResponse.json();

      // Create the enrichment column
      const columnResponse = await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: currentTable.id,
          name: outputColumnName.trim(),
          type: 'enrichment',
          enrichmentConfigId: config.id,
        }),
      });

      if (!columnResponse.ok) {
        throw new Error('Failed to create output column');
      }

      const newColumn = await columnResponse.json();

      // Determine which rows to process
      const rowIdsToProcess = selectedRows.size > 0
        ? Array.from(selectedRows)
        : rows.map(r => r.id);

      // Submit batch job
      const batchResponse = await fetch('/api/enrichment/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: config.id,
          tableId: currentTable.id,
          targetColumnId: newColumn.id,
          rowIds: rowIdsToProcess,
        }),
      });

      if (!batchResponse.ok) {
        const errorData = await batchResponse.json();
        throw new Error(errorData.error || 'Failed to submit batch job');
      }

      const batchResult = await batchResponse.json();
      setSubmittedJobId(batchResult.jobId);
      setCreatedColumns(batchResult.createdColumns || []);

      // Refresh table to show new column and pending statuses
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
      case 'submitted':
      case 'processing':
      case 'downloading':
        return 'bg-amber-500/20 text-amber-400';
      default:
        return 'bg-white/10 text-white/60';
    }
  };

  // Get row count text
  const getRowCountText = () => {
    if (selectedRows.size > 0) {
      return `${selectedRows.size} selected rows`;
    }
    return `${rows.length} rows`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 glass-sidebar flex flex-col z-40 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-400" />
          <h2 className="font-semibold text-white">Batch Enrichment</h2>
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/20 text-amber-400">
            50% Cheaper
          </span>
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
        <GlassCard padding="sm" className="bg-amber-500/5 border-amber-500/20">
          <div className="flex items-start gap-2">
            <Zap className="w-4 h-4 text-amber-400 mt-0.5" />
            <div className="text-xs text-white/70">
              <p className="font-medium text-amber-400 mb-1">Azure Batch API</p>
              <p>Processes all rows in background. Takes 1-24 hours but costs 50% less than real-time enrichment.</p>
            </div>
          </div>
        </GlassCard>

        {/* Model Display (Fixed) */}
        <div className="space-y-2 pb-4 border-b border-white/10">
          <label className="text-sm font-medium text-white/70">Model</label>
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <div className="text-left">
              <p className="text-sm font-medium text-white">GPT-4.1 Mini</p>
              <p className="text-xs text-white/50">Fast and affordable batch model</p>
            </div>
            <Check className="w-4 h-4 text-blue-400" />
          </div>
        </div>

        {/* Output Column Name */}
        <div className="space-y-2 pb-4 border-b border-white/10">
          <label className="text-sm font-medium text-white/70">Output Column Name</label>
          <input
            type="text"
            value={outputColumnName}
            onChange={(e) => setOutputColumnName(e.target.value)}
            placeholder="e.g., AI Summary"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Prompt Editor */}
        <div className="space-y-2 pb-4 border-b border-white/10">
          <label className="text-sm font-medium text-white/70">Prompt</label>
          <p className="text-xs text-white/40">
            Use {'{{column_name}}'} to insert column values
          </p>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Research the company {{Company}} and provide a brief summary..."
            className="w-full h-32 p-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-amber-500/50"
          />
          {/* Optimize Prompt Button */}
          <button
            onClick={handleOptimizePrompt}
            disabled={!prompt.trim() || isOptimizing}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-all',
              'bg-gradient-to-r from-purple-500/20 to-pink-500/20',
              'border border-purple-500/30 hover:border-purple-500/50',
              'text-purple-300 hover:text-purple-200',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isOptimizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Optimizing...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Optimize Prompt
              </>
            )}
          </button>
        </div>

        {/* Available Columns */}
        <div className="space-y-2 pb-4 border-b border-white/10">
          <label className="text-sm text-white/70">
            Available columns (click to insert)
          </label>
          <div className="flex flex-wrap gap-2">
            {columns.map((col) => (
              <button
                key={col.id}
                onClick={() => insertVariable(col.name)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-full transition-colors',
                  usedVariables.some(v => v.toLowerCase() === col.name.toLowerCase())
                    ? 'bg-amber-500/30 text-amber-300 border border-amber-500/30'
                    : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                )}
              >
                {col.name}
              </button>
            ))}
          </div>
        </div>

        {/* Data Guide */}
        <div className="space-y-3 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <label className="text-sm font-medium text-white/70">Data Guide</label>
          </div>
          <p className="text-xs text-white/40">
            Define output columns to extract structured data.
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              value={newOutputColumn}
              onChange={(e) => setNewOutputColumn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOutputColumn();
                }
              }}
              placeholder="e.g., city, country, email..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={addOutputColumn}
              disabled={!newOutputColumn.trim()}
              className={cn(
                'px-3 py-2 rounded-lg transition-colors',
                'bg-emerald-500/20 border border-emerald-500/30',
                'hover:bg-emerald-500/30 hover:border-emerald-500/50',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'text-emerald-400'
              )}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {outputColumns.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {outputColumns.map((col, index) => (
                <div
                  key={index}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30"
                >
                  <span className="text-sm text-emerald-300">{col}</span>
                  <button
                    onClick={() => removeOutputColumn(index)}
                    className="p-0.5 text-emerald-400/60 hover:text-red-400 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview */}
        {prompt && rows.length > 0 && (
          <GlassCard padding="sm" className="space-y-2">
            <p className="text-xs font-medium text-white/50">Preview (first row)</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">
              {previewPrompt()}
            </p>
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
                      {job.processedCount} / {job.totalRows} rows
                    </span>
                    {job.totalCost > 0 && (
                      <span className="text-emerald-400">
                        ${job.totalCost.toFixed(4)}
                      </span>
                    )}
                  </div>

                  {job.status === 'processing' && (
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 transition-all"
                        style={{ width: `${(job.processedCount / job.totalRows) * 100}%` }}
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
                <p className="font-medium text-emerald-400">Batch job submitted!</p>
                <p className="text-white/60 text-xs mt-1">
                  Job ID: <code className="text-white/80 bg-white/5 px-1 rounded">{submittedJobId}</code>
                </p>
                <p className="text-white/60 text-xs mt-1">
                  Processing {getRowCountText()}. Results will appear in 1-24 hours.
                </p>

                {/* Show created columns */}
                {(outputColumnName || createdColumns.length > 0) && (
                  <div className="mt-2 p-2 bg-white/5 rounded">
                    <p className="text-xs text-white/50 mb-1">Data will populate these columns:</p>
                    <div className="flex flex-wrap gap-1">
                      <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-300 rounded">
                        {outputColumnName}
                      </span>
                      {createdColumns.map(col => (
                        <span key={col.id} className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-300 rounded">
                          {col.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    setSubmittedJobId(null);
                    setCreatedColumns([]);
                    setPrompt('');
                    setOutputColumnName('Batch Output');
                    setOutputColumns([]);
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
        <GlassButton
          variant="primary"
          className="w-full bg-amber-500/20 border-amber-500/30 hover:bg-amber-500/30"
          onClick={handleSubmit}
          disabled={!prompt.trim() || !outputColumnName.trim() || isSubmitting || !!submittedJobId}
          loading={isSubmitting}
        >
          <Clock className="w-4 h-4 mr-1" />
          {submittedJobId ? 'Job Submitted' : `Submit Batch Job (${getRowCountText()})`}
        </GlassButton>

        <p className="text-xs text-center text-white/40">
          Jobs process in background. Close this panel anytime.
        </p>
      </div>

      {/* Prompt Optimizer Modal */}
      {showOptimizerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-midnight-100/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-400" />
                <h3 className="font-semibold text-white">AI Recommendations</h3>
              </div>
              <button
                onClick={handleDeclineOptimizedPrompt}
                className="p-1 hover:bg-white/10 rounded transition-colors"
              >
                <X className="w-5 h-5 text-white/60" />
              </button>
            </div>

            {/* Modal Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {isOptimizing ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                  <p className="text-white/70">Analyzing prompt and columns with Gemini 2.5 Pro...</p>
                </div>
              ) : optimizerError ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                  <p className="text-red-400 text-center">{optimizerError}</p>
                </div>
              ) : (
                <>
                  {/* Optimized Prompt Section */}
                  {optimizedPrompt && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        Optimized Prompt
                      </h4>
                      <div className="p-4 bg-white/5 border border-white/10 rounded-lg max-h-64 overflow-y-auto">
                        <pre className="text-sm text-white/80 whitespace-pre-wrap font-mono">
                          {optimizedPrompt}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Recommended Data Guide Section */}
                  {recommendedDataGuide.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                        <Database className="w-4 h-4 text-emerald-400" />
                        Recommended Data Guide ({recommendedDataGuide.length} field{recommendedDataGuide.length !== 1 ? 's' : ''})
                      </h4>
                      <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-white/5 border-b border-white/10">
                            <tr>
                              <th className="text-left p-3 text-white/70 font-medium">Field Name</th>
                              <th className="text-left p-3 text-white/70 font-medium">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recommendedDataGuide.map((field, index) => (
                              <tr key={index} className="border-b border-white/5 last:border-0">
                                <td className="p-3 font-medium text-emerald-300">{field.name}</td>
                                <td className="p-3 text-white/70">{field.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* No recommendations case */}
                  {!optimizedPrompt && recommendedDataGuide.length === 0 && (
                    <div className="flex flex-col items-center gap-4 py-8">
                      <AlertCircle className="w-8 h-8 text-yellow-400" />
                      <p className="text-yellow-400 text-center">No recommendations generated. Try a different prompt.</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10">
              <button
                onClick={handleRetryOptimize}
                disabled={isOptimizing}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                  'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </button>
              <button
                onClick={handleDeclineOptimizedPrompt}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
              >
                Decline
              </button>
              <button
                onClick={handleAcceptOptimizedPrompt}
                disabled={(!optimizedPrompt && recommendedDataGuide.length === 0) || isOptimizing}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                  'bg-gradient-to-r from-purple-500 to-emerald-500 text-white',
                  'hover:from-purple-600 hover:to-emerald-600',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <Check className="w-4 h-4" />
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
