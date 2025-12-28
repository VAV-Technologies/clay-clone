'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Code,
  Play,
  TestTube,
  X,
  AlertCircle,
  Check,
  Wand2,
  Loader2,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import { evaluateFormula, extractColumnReferences, FORMULA_EXAMPLES } from '@/lib/formula/evaluator';

interface FormulaPanelProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  columnId?: string; // If provided, edit existing formula column
}

type Mode = 'manual' | 'ai';

export function FormulaPanel({ isOpen, onClose, tableId, columnId }: FormulaPanelProps) {
  const { columns, rows, selectedRows, fetchTable } = useTableStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const aiTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Mode state
  const [mode, setMode] = useState<Mode>('manual');

  // Formula state
  const [formula, setFormula] = useState('');
  const [outputColumnName, setOutputColumnName] = useState('Formula Result');
  const [configId, setConfigId] = useState<string | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // Editing mode detection
  const isEditMode = !!columnId;
  const editingColumn = columnId ? columns.find(c => c.id === columnId) : null;

  // Load existing formula config when editing
  useEffect(() => {
    if (!isOpen || !columnId || !editingColumn?.formulaConfigId) {
      if (!columnId) {
        // Reset form when opening in create mode
        setFormula('');
        setOutputColumnName('Formula Result');
        setConfigId(null);
      }
      return;
    }

    setIsLoadingConfig(true);
    fetch(`/api/formula/${editingColumn.formulaConfigId}`)
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setFormula(data.formula || '');
          setOutputColumnName(data.name || editingColumn.name);
          setConfigId(data.id);
        }
      })
      .catch(err => console.error('Failed to load formula config:', err))
      .finally(() => setIsLoadingConfig(false));
  }, [isOpen, columnId, editingColumn?.formulaConfigId, editingColumn?.name]);

  // AI generation state
  const [aiDescription, setAiDescription] = useState('');
  const [generatedFormula, setGeneratedFormula] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingRows, setTestingRows] = useState(0);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [previewResult, setPreviewResult] = useState<{ value: string | number | null; error?: string } | null>(null);

  // Get usable columns (exclude enrichment columns for formula input)
  const usableColumns = columns.filter((col) => col.type !== 'enrichment');

  // Get columns referenced in the formula
  const referencedColumns = extractColumnReferences(formula);

  // Update preview when formula changes (debounced)
  useEffect(() => {
    if (!formula.trim() || rows.length === 0) {
      setPreviewResult(null);
      return;
    }

    const timeout = setTimeout(() => {
      const firstRow = rows[0];
      const result = evaluateFormula(formula, {
        row: firstRow.data as Record<string, { value: string | number | null }>,
        columns: columns.map((c) => ({ id: c.id, name: c.name })),
      });
      setPreviewResult(result);
    }, 300);

    return () => clearTimeout(timeout);
  }, [formula, rows, columns]);

  // Insert column reference at cursor position
  const insertColumnReference = useCallback((columnName: string) => {
    const textarea = mode === 'ai' ? aiTextareaRef.current : textareaRef.current;
    const reference = `{{${columnName}}}`;

    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      if (mode === 'ai') {
        const newValue = aiDescription.slice(0, start) + reference + aiDescription.slice(end);
        setAiDescription(newValue);
      } else {
        const newValue = formula.slice(0, start) + reference + formula.slice(end);
        setFormula(newValue);
      }

      // Focus and move cursor after the inserted reference
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + reference.length, start + reference.length);
      }, 0);
    } else {
      // Fallback: append to the end
      if (mode === 'ai') {
        setAiDescription((prev) => prev + reference);
      } else {
        setFormula((prev) => prev + reference);
      }
    }
  }, [mode, formula, aiDescription]);

  // Generate formula with AI
  const handleGenerateFormula = async () => {
    if (!aiDescription.trim()) return;

    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedFormula('');

    try {
      // Get sample values for columns
      const firstRow = rows[0];
      const columnsWithSamples = usableColumns.map((col) => ({
        name: col.name,
        type: col.type,
        sampleValue: firstRow?.data?.[col.id]?.value ?? null,
      }));

      const response = await fetch('/api/formula/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: aiDescription,
          columns: columnsWithSamples,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate formula');
      }

      const data = await response.json();
      setGeneratedFormula(data.formula);
    } catch (err) {
      setGenerateError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Accept generated formula
  const handleAcceptFormula = () => {
    setFormula(generatedFormula);
    setMode('manual'); // Switch to manual mode to show the formula
  };

  // Run formula
  const handleRun = async (testRowCount?: number) => {
    if (!formula.trim()) {
      setError('Please enter a formula');
      return;
    }

    const isTest = typeof testRowCount === 'number';
    setError(null);

    if (isTest) {
      setIsTesting(true);
      setTestingRows(testRowCount);
    } else {
      setIsRunning(true);
    }

    try {
      // Determine which rows to process
      let targetRowIds: string[] | undefined;

      if (isTest) {
        targetRowIds = rows.slice(0, testRowCount).map((r) => r.id);
      } else if (selectedRows.size > 0) {
        targetRowIds = Array.from(selectedRows);
      }

      // Use different endpoints for create vs edit mode
      const endpoint = isEditMode ? '/api/formula/rerun' : '/api/formula/run';
      const requestBody = isEditMode
        ? {
            columnId,
            configId,
            formula,
            outputColumnName,
            rowIds: targetRowIds,
          }
        : {
            tableId,
            formula,
            outputColumnName,
            rowIds: targetRowIds,
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run formula');
      }

      const result = await response.json();
      const jobId = result.jobId;

      if (!jobId) {
        // No rows to process
        await fetchTable(tableId);
        return;
      }

      // Poll for progress - use the correct endpoint for progress
      const progressEndpoint = isEditMode ? '/api/formula/rerun' : '/api/formula/run';
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${progressEndpoint}?jobId=${jobId}`);
          const status = await statusRes.json();

          setProgress({
            completed: status.completed,
            total: status.total,
          });

          if (status.status === 'complete' || status.status === 'error') {
            clearInterval(pollInterval);
            await fetchTable(tableId);

            if (isTest) {
              setIsTesting(false);
              setTestingRows(0);
            } else {
              setIsRunning(false);
              if (!isTest) {
                onClose();
              }
            }
          }
        } catch (err) {
          console.error('Error polling progress:', err);
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setIsRunning(false);
        setIsTesting(false);
        setTestingRows(0);
      }, 5 * 60 * 1000);
    } catch (err) {
      setError((err as Error).message);
      setIsRunning(false);
      setIsTesting(false);
      setTestingRows(0);
    }
  };

  // Insert example formula
  const handleInsertExample = (exampleFormula: string) => {
    setFormula(exampleFormula);
  };

  if (!isOpen) return null;

  const isProcessing = isRunning || isTesting;
  const canRun = formula.trim() && !isProcessing;

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] z-50 flex flex-col bg-midnight-100/95 backdrop-blur-xl border-l border-white/10 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-lavender/20">
            <Code className="w-5 h-5 text-lavender" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              {isEditMode ? 'Edit Formula' : 'Formula Builder'}
            </h2>
            <p className="text-xs text-white/50">
              {isEditMode
                ? `Editing "${editingColumn?.name || 'Formula'}"`
                : 'Transform data with JavaScript formulas'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Output Column Name */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Output Column Name
          </label>
          <input
            type="text"
            value={outputColumnName}
            onChange={(e) => setOutputColumnName(e.target.value)}
            placeholder="Enter column name..."
            className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-lavender focus:outline-none"
          />
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 p-1 rounded-lg bg-white/5">
          <button
            onClick={() => setMode('manual')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              mode === 'manual'
                ? 'bg-lavender text-midnight'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            )}
          >
            <Code className="w-4 h-4" />
            Manual
          </button>
          <button
            onClick={() => setMode('ai')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              mode === 'ai'
                ? 'bg-lavender text-midnight'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            )}
          >
            <Sparkles className="w-4 h-4" />
            AI Generated
          </button>
        </div>

        {/* Available Columns */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Available Columns
            <span className="text-white/40 font-normal ml-2">(click to insert)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {usableColumns.map((col) => {
              const isReferenced = referencedColumns.includes(col.name);
              return (
                <button
                  key={col.id}
                  onClick={() => insertColumnReference(col.name)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm transition-colors',
                    isReferenced
                      ? 'bg-lavender/30 text-lavender border border-lavender/50'
                      : 'bg-white/10 text-white/70 border border-white/10 hover:bg-white/20 hover:text-white'
                  )}
                >
                  {col.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Manual Mode: Formula Input */}
        {mode === 'manual' && (
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">
              Formula (JavaScript)
            </label>
            <textarea
              ref={textareaRef}
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder={'{{Email}}?.split("@")[1] || ""'}
              rows={4}
              className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white font-mono text-sm placeholder:text-white/30 focus:border-lavender focus:outline-none resize-none"
            />
            <p className="mt-2 text-xs text-white/40">
              Available: Math, String, Array, Date, _ (Lodash), Excel functions (IF, VLOOKUP, etc.)
            </p>

            {/* Formula Examples */}
            <div className="mt-4">
              <label className="block text-xs font-medium text-white/50 mb-2">
                Examples (click to use)
              </label>
              <div className="flex flex-wrap gap-2">
                {FORMULA_EXAMPLES.slice(0, 4).map((example, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleInsertExample(example.formula)}
                    className="px-2 py-1 rounded text-xs bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70 transition-colors"
                    title={example.formula}
                  >
                    {example.description}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AI Mode: Description Input */}
        {mode === 'ai' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Describe what you want
              </label>
              <textarea
                ref={aiTextareaRef}
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder="Extract the domain from {{Email}}"
                rows={3}
                className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-lavender focus:outline-none resize-none"
              />
            </div>

            <GlassButton
              onClick={handleGenerateFormula}
              disabled={!aiDescription.trim() || isGenerating}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Generate Formula
                </>
              )}
            </GlassButton>

            {generateError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{generateError}</p>
              </div>
            )}

            {generatedFormula && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-white/70">
                  Generated Formula
                </label>
                <div className="p-4 rounded-lg bg-midnight-200 border border-white/10">
                  <code className="text-sm text-lavender font-mono break-all">
                    {generatedFormula}
                  </code>
                </div>
                <div className="flex gap-2">
                  <GlassButton onClick={handleAcceptFormula} variant="primary" className="flex-1">
                    <Check className="w-4 h-4 mr-2" />
                    Accept
                  </GlassButton>
                  <GlassButton onClick={handleGenerateFormula} disabled={isGenerating}>
                    <RefreshCw className={cn('w-4 h-4', isGenerating && 'animate-spin')} />
                  </GlassButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview */}
        {previewResult && (
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Preview (Row 1)</label>
            <div
              className={cn(
                'p-4 rounded-lg border',
                previewResult.error
                  ? 'bg-red-500/10 border-red-500/20'
                  : 'bg-green-500/10 border-green-500/20'
              )}
            >
              {previewResult.error ? (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400">{previewResult.error}</p>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-green-400 font-mono break-all">
                    {previewResult.value === null ? 'null' : String(previewResult.value)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Progress */}
        {isProcessing && progress.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-white/70">
              <span>Processing...</span>
              <span>
                {progress.completed} / {progress.total}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-lavender transition-all duration-300"
                style={{
                  width: `${(progress.completed / progress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-white/10 p-6 space-y-4">
        {/* Test Buttons */}
        <div className="flex gap-2">
          <GlassButton
            onClick={() => handleRun(1)}
            disabled={!canRun}
            className="flex-1"
          >
            {isTesting && testingRows === 1 ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4 mr-2" />
            )}
            Test 1 Row
          </GlassButton>
          <GlassButton
            onClick={() => handleRun(10)}
            disabled={!canRun}
            className="flex-1"
          >
            {isTesting && testingRows === 10 ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4 mr-2" />
            )}
            Test 10 Rows
          </GlassButton>
        </div>

        {/* Run Button */}
        <GlassButton
          onClick={() => handleRun()}
          disabled={!canRun}
          variant="primary"
          className="w-full"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {isEditMode ? 'Re-running...' : 'Running...'}
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              {isEditMode
                ? selectedRows.size > 0
                  ? `Re-run on ${selectedRows.size} Selected Rows`
                  : `Re-run on All ${rows.length} Rows`
                : selectedRows.size > 0
                  ? `Run on ${selectedRows.size} Selected Rows`
                  : `Run on All ${rows.length} Rows`}
            </>
          )}
        </GlassButton>
      </div>

      {/* Loading overlay for edit mode */}
      {isLoadingConfig && (
        <div className="absolute inset-0 flex items-center justify-center bg-midnight-100/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-white">
            <Loader2 className="w-5 h-5 animate-spin text-lavender" />
            <span>Loading formula...</span>
          </div>
        </div>
      )}
    </div>
  );
}
