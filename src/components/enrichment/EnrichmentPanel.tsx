'use client';

import { useState, useEffect } from 'react';
import {
  Sparkles,
  Play,
  TestTube,
  Settings,
  X,
  ChevronDown,
  AlertCircle,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton, GlassInput, GlassCard } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';

interface EnrichmentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  targetColumnId?: string;
}

const MODELS = [
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and efficient' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'More capable' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Latest version' },
];

export function EnrichmentPanel({ isOpen, onClose, targetColumnId }: EnrichmentPanelProps) {
  const { currentTable, columns, rows, selectedRows, updateCell } = useTableStore();

  const [name, setName] = useState('');
  const [model, setModel] = useState('gemini-1.5-flash');
  const [prompt, setPrompt] = useState('');
  const [inputColumns, setInputColumns] = useState<string[]>([]);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [outputFormat, setOutputFormat] = useState<'text' | 'json'>('text');
  const [runOnEmpty, setRunOnEmpty] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Get available columns for input (exclude enrichment columns)
  const availableColumns = columns.filter(
    (col) => col.type !== 'enrichment' && col.id !== targetColumnId
  );

  // Build preview prompt with sample data
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

  const handleTest = async () => {
    if (!currentTable || rows.length === 0 || !targetColumnId) return;

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      // Create a temporary enrichment config
      const configResponse = await fetch('/api/enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Test Enrichment',
          model,
          prompt,
          inputColumns,
          outputFormat,
          temperature,
          maxTokens,
        }),
      });

      if (!configResponse.ok) throw new Error('Failed to create config');
      const config = await configResponse.json();

      // Run on first row
      const response = await fetch('/api/enrichment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: config.id,
          tableId: currentTable.id,
          targetColumnId,
          rowIds: [rows[0].id],
        }),
      });

      if (!response.ok) throw new Error('Test failed');

      const result = await response.json();

      // Poll for result
      const pollInterval = setInterval(async () => {
        const statusRes = await fetch(`/api/enrichment/run?jobId=${result.jobId}`);
        const status = await statusRes.json();

        if (status.status === 'complete') {
          clearInterval(pollInterval);

          // Get updated row
          const rowRes = await fetch(`/api/rows?tableId=${currentTable.id}`);
          const updatedRows = await rowRes.json();
          const updatedRow = updatedRows.find((r: { id: string }) => r.id === rows[0].id);

          if (updatedRow) {
            const cellValue = updatedRow.data[targetColumnId];
            setTestResult(cellValue?.value || 'No result');
            updateCell(rows[0].id, targetColumnId, cellValue);
          }

          setIsTesting(false);
        }
      }, 1000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isTesting) {
          setError('Test timed out');
          setIsTesting(false);
        }
      }, 30000);
    } catch (err) {
      setError((err as Error).message);
      setIsTesting(false);
    }
  };

  const handleRun = async () => {
    if (!currentTable || !targetColumnId) return;

    setIsRunning(true);
    setError(null);
    setProgress({ completed: 0, total: 0 });

    try {
      // Create enrichment config
      const configResponse = await fetch('/api/enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Enrichment',
          model,
          prompt,
          inputColumns,
          outputFormat,
          temperature,
          maxTokens,
        }),
      });

      if (!configResponse.ok) throw new Error('Failed to create config');
      const config = await configResponse.json();

      // Determine which rows to run on
      const rowIds = selectedRows.size > 0 ? Array.from(selectedRows) : undefined;

      // Start enrichment
      const response = await fetch('/api/enrichment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: config.id,
          tableId: currentTable.id,
          targetColumnId,
          rowIds,
          onlyEmpty: runOnEmpty,
        }),
      });

      if (!response.ok) throw new Error('Failed to start enrichment');

      const result = await response.json();
      setProgress({ completed: 0, total: result.totalRows });

      // Poll for progress
      const pollInterval = setInterval(async () => {
        const statusRes = await fetch(`/api/enrichment/run?jobId=${result.jobId}`);
        const status = await statusRes.json();

        setProgress({ completed: status.completed, total: status.total });

        if (status.status === 'complete') {
          clearInterval(pollInterval);
          setIsRunning(false);

          // Refresh table data
          // This would typically be handled by the store
        }
      }, 1000);
    } catch (err) {
      setError((err as Error).message);
      setIsRunning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 glass-sidebar flex flex-col z-40 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-lavender" />
          <h2 className="font-semibold text-white">AI Enrichment</h2>
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
        {/* Name */}
        <GlassInput
          label="Enrichment Name"
          placeholder="e.g., Company Research"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {/* Model Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-white/70">Model</label>
          <div className="space-y-2">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg',
                  'border transition-all',
                  model === m.id
                    ? 'bg-lavender/10 border-lavender/30'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                )}
              >
                <div className="text-left">
                  <p className="text-sm font-medium text-white">{m.name}</p>
                  <p className="text-xs text-white/50">{m.description}</p>
                </div>
                {model === m.id && <Check className="w-4 h-4 text-lavender" />}
              </button>
            ))}
          </div>
        </div>

        {/* Input Columns */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-white/70">
            Input Columns
          </label>
          <p className="text-xs text-white/40">
            Select columns to use as context in your prompt
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {availableColumns.map((col) => (
              <label
                key={col.id}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={inputColumns.includes(col.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setInputColumns([...inputColumns, col.id]);
                    } else {
                      setInputColumns(inputColumns.filter((id) => id !== col.id));
                    }
                  }}
                  className="w-4 h-4 rounded border-white/20 bg-white/5"
                />
                <span className="text-sm text-white/70">{col.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Prompt Editor */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-white/70">Prompt</label>
          <p className="text-xs text-white/40">
            Use {'{{column_name}}'} to insert column values
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Research the company {{Company}} and provide a brief summary..."
            className="w-full h-32 p-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-lavender"
          />
        </div>

        {/* Preview */}
        {prompt && (
          <GlassCard padding="sm" className="space-y-2">
            <p className="text-xs font-medium text-white/50">Preview (first row)</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">
              {previewPrompt()}
            </p>
          </GlassCard>
        )}

        {/* Settings */}
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-white/70 hover:text-white">
            <Settings className="w-4 h-4" />
            Advanced Settings
            <ChevronDown className="w-4 h-4 ml-auto transition-transform group-open:rotate-180" />
          </summary>

          <div className="mt-3 space-y-4 pl-6">
            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">Temperature</span>
                <span className="text-white/50">{temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-lavender"
              />
            </div>

            {/* Max Tokens */}
            <GlassInput
              label="Max Tokens"
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1000)}
            />

            {/* Output Format */}
            <div className="space-y-2">
              <label className="text-sm text-white/70">Output Format</label>
              <div className="flex gap-2">
                <GlassButton
                  size="sm"
                  variant={outputFormat === 'text' ? 'primary' : 'default'}
                  onClick={() => setOutputFormat('text')}
                >
                  Text
                </GlassButton>
                <GlassButton
                  size="sm"
                  variant={outputFormat === 'json' ? 'primary' : 'default'}
                  onClick={() => setOutputFormat('json')}
                >
                  JSON
                </GlassButton>
              </div>
            </div>

            {/* Run on empty only */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={runOnEmpty}
                onChange={(e) => setRunOnEmpty(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-white/5"
              />
              <span className="text-sm text-white/70">Only enrich empty cells</span>
            </label>
          </div>
        </details>

        {/* Test Result */}
        {testResult && (
          <GlassCard padding="sm" className="border-green-500/20">
            <p className="text-xs font-medium text-green-400 mb-1">Test Result</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">{testResult}</p>
          </GlassCard>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Progress */}
        {isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-white/70">Progress</span>
              <span className="text-white/50">
                {progress.completed} / {progress.total}
              </span>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-lavender transition-all"
                style={{
                  width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 space-y-2">
        <div className="flex gap-2">
          <GlassButton
            variant="ghost"
            className="flex-1"
            onClick={handleTest}
            disabled={!prompt || !targetColumnId || isTesting || isRunning}
            loading={isTesting}
          >
            <TestTube className="w-4 h-4 mr-1" />
            Test
          </GlassButton>
          <GlassButton
            variant="primary"
            className="flex-1"
            onClick={handleRun}
            disabled={!prompt || !targetColumnId || isTesting || isRunning}
            loading={isRunning}
          >
            <Play className="w-4 h-4 mr-1" />
            Run {selectedRows.size > 0 ? `(${selectedRows.size})` : 'All'}
          </GlassButton>
        </div>
      </div>
    </div>
  );
}
