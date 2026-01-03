'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Play,
  TestTube,
  Settings,
  X,
  ChevronDown,
  AlertCircle,
  Check,
  Wand2,
  Loader2,
  RotateCcw,
  Plus,
  Trash2,
  Database,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton, GlassCard } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import type { Row } from '@/lib/db/schema';

interface EnrichmentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  editColumnId?: string | null; // If set, we're editing an existing enrichment column
}

const MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Latest and fastest' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Lightweight and efficient' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable' },
  { id: 'gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', description: 'Fast and stable' },
  { id: 'gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite', description: 'Lightweight option' },
];

export function EnrichmentPanel({ isOpen, onClose, editColumnId }: EnrichmentPanelProps) {
  const { currentTable, columns, rows, selectedRows, updateCell, addColumn, fetchTable } = useTableStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [model, setModel] = useState('gemini-2.5-flash');
  const [prompt, setPrompt] = useState('');
  const [outputColumnName, setOutputColumnName] = useState('AI Output');
  const [temperature, setTemperature] = useState(0.7);
  const [costLimitEnabled, setCostLimitEnabled] = useState(false);
  const [maxCostPerRow, setMaxCostPerRow] = useState(0.01); // $0.01 default
  const [runOnEmpty, setRunOnEmpty] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingRows, setTestingRows] = useState(0); // 0 = not testing, 1 = single row, 10 = 10 rows
  const [testResults, setTestResults] = useState<string[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [existingConfigId, setExistingConfigId] = useState<string | null>(null);

  // Data Guide state - output columns that will be created from AI response
  const [outputColumns, setOutputColumns] = useState<string[]>([]);
  const [newOutputColumn, setNewOutputColumn] = useState('');

  // Prompt optimizer state
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState<string | null>(null);
  const [showOptimizerModal, setShowOptimizerModal] = useState(false);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [recommendedDataGuide, setRecommendedDataGuide] = useState<
    Array<{ name: string; description: string }>
  >([]);

  // Determine if we're in edit mode (re-running existing enrichment)
  const isEditMode = !!editColumnId;
  const editColumn = isEditMode ? columns.find(c => c.id === editColumnId) : null;

  // State for save operation
  const [isSaving, setIsSaving] = useState(false);

  // Loading state for config - prevents running before config is loaded
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);

  // Load existing enrichment config when editing
  useEffect(() => {
    if (isEditMode && editColumnId && isOpen) {
      // Set loading state to prevent running before config loads
      setIsConfigLoading(true);
      setIsConfigLoaded(false);

      // First find the column to get its enrichmentConfigId
      const column = columns.find(c => c.id === editColumnId);

      if (column?.enrichmentConfigId) {
        // Column has linked config - load it directly
        fetch(`/api/enrichment/${column.enrichmentConfigId}`)
          .then(res => res.json())
          .then(config => {
            console.log('Loaded enrichment config:', config);
            setModel(config.model || 'gemini-2.5-flash');
            setPrompt(config.prompt || '');
            setTemperature(config.temperature ?? 0.7);
            setCostLimitEnabled(config.costLimitEnabled ?? false);
            setMaxCostPerRow(config.maxCostPerRow ?? 0.01);
            setExistingConfigId(config.id);
            setOutputColumns(config.outputColumns || []);
            setIsConfigLoaded(true);
          })
          .catch(err => {
            console.error('Failed to load enrichment config:', err);
            setIsConfigLoaded(true); // Still mark as loaded to allow editing
          })
          .finally(() => {
            setIsConfigLoading(false);
          });

        // Set the column name for display
        setOutputColumnName(column.name);
      } else if (column && column.type === 'enrichment') {
        // Column is enrichment type but missing config link - try to find by name
        console.log('Column missing enrichmentConfigId, searching by name:', column.name);
        fetch('/api/enrichment')
          .then(res => res.json())
          .then(async (configs) => {
            // Find a config that matches this column's name
            const matchingConfig = configs.find(
              (c: { name: string }) => c.name.toLowerCase() === column.name.toLowerCase()
            );

            if (matchingConfig) {
              console.log('Found matching config by name:', matchingConfig);
              setModel(matchingConfig.model || 'gemini-2.5-flash');
              setPrompt(matchingConfig.prompt || '');
              setTemperature(matchingConfig.temperature ?? 0.7);
              setCostLimitEnabled(matchingConfig.costLimitEnabled ?? false);
              setMaxCostPerRow(matchingConfig.maxCostPerRow ?? 0.01);
              setExistingConfigId(matchingConfig.id);
              setOutputColumns(matchingConfig.outputColumns || []);

              // Link the column to this config for future use
              try {
                await fetch(`/api/columns/${column.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enrichmentConfigId: matchingConfig.id }),
                });
                console.log('Linked column to config');
              } catch (err) {
                console.error('Failed to link column to config:', err);
              }
            } else {
              console.log('No matching config found for column:', column.name);
            }
            setIsConfigLoaded(true);
          })
          .catch(err => {
            console.error('Failed to search for enrichment config:', err);
            setIsConfigLoaded(true);
          })
          .finally(() => {
            setIsConfigLoading(false);
          });

        // Set the column name for display
        setOutputColumnName(column.name);
      } else {
        // No config to load
        setIsConfigLoading(false);
        setIsConfigLoaded(true);
      }
    }
  }, [isEditMode, editColumnId, isOpen, columns]);

  // Reset state when panel closes or opens fresh
  useEffect(() => {
    if (!isOpen) {
      setTestResults([]);
      setError(null);
      setProgress({ completed: 0, total: 0 });
      setIsConfigLoading(false);
      setIsConfigLoaded(false);
    }
    if (isOpen && !editColumnId) {
      // Reset to defaults for new enrichment
      setModel('gemini-2.5-flash');
      setPrompt('');
      setOutputColumnName('AI Output');
      setTemperature(0.7);
      setCostLimitEnabled(false);
      setMaxCostPerRow(0.01);
      setRunOnEmpty(false);
      setExistingConfigId(null);
      setOutputColumns([]);
      setNewOutputColumn('');
      setIsConfigLoading(false);
      setIsConfigLoaded(true); // New enrichments don't need config loading
    }
  }, [isOpen, editColumnId]);

  // Computed: Can run enrichment (not loading config in edit mode)
  const canRunEnrichment = !isConfigLoading && (!isEditMode || isConfigLoaded);

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

  // Get all columns for insertion (including target - user may want to reference it)
  const availableColumns = columns;

  // Insert variable at cursor position
  const insertVariable = (columnName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const variable = `{{${columnName}}}`;
    const newPrompt = prompt.substring(0, start) + variable + prompt.substring(end);
    setPrompt(newPrompt);

    // Set cursor position after the inserted variable
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

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

  const usedVariables = extractVariables(prompt);

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

  // Helper to create or get enrichment config
  const getOrCreateConfig = async () => {
    // In edit mode, use existing config or update it
    if (isEditMode && existingConfigId) {
      // Update the existing config with new settings
      await fetch(`/api/enrichment/${existingConfigId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          temperature,
          costLimitEnabled,
          maxCostPerRow: costLimitEnabled ? maxCostPerRow : null,
          outputColumns,
        }),
      });
      return existingConfigId;
    }

    // Create new config
    const configResponse = await fetch('/api/enrichment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: outputColumnName.trim(),
        model,
        prompt,
        inputColumns: usedVariables.map(v => {
          const col = columns.find(c => c.name.toLowerCase() === v.toLowerCase());
          return col?.id || v;
        }),
        outputColumns,
        outputFormat: 'text',
        temperature,
        costLimitEnabled,
        maxCostPerRow: costLimitEnabled ? maxCostPerRow : null,
      }),
    });

    if (!configResponse.ok) throw new Error('Failed to create config');
    const config = await configResponse.json();
    return config.id;
  };

  // Save configuration without running
  const handleSave = async () => {
    if (!existingConfigId) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/enrichment/${existingConfigId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          temperature,
          costLimitEnabled,
          maxCostPerRow: costLimitEnabled ? maxCostPerRow : null,
          outputColumns,
        }),
      });

      if (!response.ok) throw new Error('Failed to save configuration');

      // Show success briefly then close or stay open
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (numRows: number = 1) => {
    if (!currentTable || rows.length === 0 || !outputColumnName.trim()) return;

    setIsTesting(true);
    setTestingRows(numRows);
    setTestResults([]);
    setError(null);

    try {
      let targetColumnId: string;
      let configId: string;

      if (isEditMode && editColumnId) {
        // Use existing column
        targetColumnId = editColumnId;
        configId = await getOrCreateConfig();
      } else {
        // Create a new output column for the test
        const configId_ = await getOrCreateConfig();
        configId = configId_;

        const columnResponse = await fetch('/api/columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId: currentTable.id,
            name: outputColumnName.trim(),
            type: 'enrichment',
            enrichmentConfigId: configId,
          }),
        });

        if (!columnResponse.ok) throw new Error('Failed to create output column');
        const newColumn = await columnResponse.json();
        targetColumnId = newColumn.id;
      }

      // Get row IDs to test
      const testRowIds = rows.slice(0, Math.min(numRows, rows.length)).map(r => r.id);

      // Run on selected rows
      const response = await fetch('/api/enrichment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId,
          tableId: currentTable.id,
          targetColumnId,
          rowIds: testRowIds,
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

          // Reload table to get new column and updated rows
          await fetchTable(currentTable.id);

          // Get updated rows for display
          const rowRes = await fetch(`/api/rows?tableId=${currentTable.id}`);
          const updatedRows = await rowRes.json();

          const results: string[] = [];
          testRowIds.forEach((rowId) => {
            const updatedRow = updatedRows.find((r: { id: string }) => r.id === rowId);
            if (updatedRow) {
              const cellValue = updatedRow.data[targetColumnId];
              results.push(cellValue?.value || 'No result');
            }
          });

          setTestResults(results);
          setIsTesting(false);
          setTestingRows(0);
        }
      }, 1000);

      // Timeout after 60 seconds for larger tests
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isTesting) {
          setError('Test timed out');
          setIsTesting(false);
          setTestingRows(0);
        }
      }, 60000);
    } catch (err) {
      setError((err as Error).message);
      setIsTesting(false);
      setTestingRows(0);
    }
  };

  const handleRun = async () => {
    if (!currentTable || !outputColumnName.trim()) return;

    setIsRunning(true);
    setError(null);
    setProgress({ completed: 0, total: 0 });

    try {
      let targetColumnId: string;
      let configId: string;

      if (isEditMode && editColumnId) {
        // Use existing column
        targetColumnId = editColumnId;
        configId = await getOrCreateConfig();
      } else {
        // Create new config first
        configId = await getOrCreateConfig();

        // Create a new output column
        const columnResponse = await fetch('/api/columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId: currentTable.id,
            name: outputColumnName.trim(),
            type: 'enrichment',
            enrichmentConfigId: configId,
          }),
        });

        if (!columnResponse.ok) throw new Error('Failed to create output column');
        const newColumn = await columnResponse.json();
        targetColumnId = newColumn.id;

        // Add the new column to the store
        addColumn(newColumn);
      }

      // Determine which rows to run on
      const rowIdsToEnrich = selectedRows.size > 0 ? Array.from(selectedRows) : rows.map(r => r.id);

      // Mark all target cells as 'processing' immediately in the UI
      rowIdsToEnrich.forEach(rowId => {
        updateCell(rowId, targetColumnId, { value: null, status: 'processing' });
      });

      // Start enrichment
      const response = await fetch('/api/enrichment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId,
          tableId: currentTable.id,
          targetColumnId,
          rowIds: selectedRows.size > 0 ? rowIdsToEnrich : undefined,
          onlyEmpty: runOnEmpty,
        }),
      });

      if (!response.ok) throw new Error('Failed to start enrichment');

      const result = await response.json();

      // Close panel immediately - enrichment runs in background
      setIsRunning(false);
      onClose();

      // Start background polling for updates
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/enrichment/run?jobId=${result.jobId}`);
          if (!statusRes.ok) {
            clearInterval(pollInterval);
            return;
          }
          const status = await statusRes.json();

          // Fetch only newly completed rows (server tracks what we've already fetched)
          if (status.newlyCompletedRowIds && status.newlyCompletedRowIds.length > 0) {
            const rowsRes = await fetch(`/api/rows?tableId=${currentTable.id}&rowIds=${status.newlyCompletedRowIds.join(',')}`);
            if (rowsRes.ok) {
              const updatedRows = await rowsRes.json();
              // Update each row in the store
              updatedRows.forEach((row: Row) => {
                const cellData = row.data[targetColumnId];
                if (cellData) {
                  updateCell(row.id, targetColumnId, cellData);
                }
              });
            }
          }

          if (status.status === 'complete') {
            clearInterval(pollInterval);
          }
        } catch (pollError) {
          console.error('Polling error:', pollError);
        }
      }, 2000); // Poll every 2 seconds

      // Timeout after 10 minutes
      setTimeout(() => clearInterval(pollInterval), 600000);

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
          <h2 className="font-semibold text-white">
            {isEditMode ? `Re-run: ${editColumn?.name}` : 'AI Enrichment'}
          </h2>
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
        {/* Model Selection */}
        <div className="space-y-2 pb-4 border-b border-white/10">
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

        {/* Output Column Name - only shown when creating new enrichment */}
        {!isEditMode && (
          <div className="space-y-2 pb-4 border-b border-white/10">
            <label className="text-sm font-medium text-white/70">Output Column Name</label>
            <input
              type="text"
              value={outputColumnName}
              onChange={(e) => setOutputColumnName(e.target.value)}
              placeholder="e.g., AI Summary"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-lavender"
            />
            <p className="text-xs text-white/40">
              A new column will be created with this name
            </p>
          </div>
        )}

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
            className="w-full h-32 p-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-lavender"
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

        {/* Available Columns - Click to Insert */}
        <div className="space-y-2 pb-4 border-b border-white/10">
          <label className="text-sm text-white/70">
            Available columns (click to insert)
          </label>
          <div className="flex flex-wrap gap-2">
            {availableColumns.map((col) => (
              <button
                key={col.id}
                onClick={() => insertVariable(col.name)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-full transition-colors',
                  usedVariables.some(v => v.toLowerCase() === col.name.toLowerCase())
                    ? 'bg-lavender/30 text-lavender border border-lavender/30'
                    : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                )}
              >
                {col.name}
              </button>
            ))}
          </div>
        </div>

        {/* Data Guide - Output Column Definitions */}
        <div className="space-y-3 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <label className="text-sm font-medium text-white/70">Data Guide</label>
          </div>
          <p className="text-xs text-white/40">
            Define output columns to extract structured data. The AI will return JSON with these exact keys.
          </p>

          {/* Add new output column */}
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

          {/* Output columns list */}
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

            {/* Cost Limit */}
            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-white/70">Cost Limit</span>
                <button
                  onClick={() => setCostLimitEnabled(!costLimitEnabled)}
                  className={cn(
                    'relative w-10 h-5 rounded-full transition-colors',
                    costLimitEnabled ? 'bg-lavender' : 'bg-white/20'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200',
                      costLimitEnabled ? 'left-5' : 'left-0.5'
                    )}
                  />
                </button>
              </label>
              {costLimitEnabled && (
                <div className="space-y-2 pl-2 border-l-2 border-lavender/30">
                  <label className="text-xs text-white/50">Max Cost Per Row ($)</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={maxCostPerRow}
                    onChange={(e) => setMaxCostPerRow(parseFloat(e.target.value) || 0.01)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-lavender"
                  />
                  <p className="text-xs text-white/40">
                    Enrichment stops when cumulative cost exceeds limit
                  </p>
                </div>
              )}
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

        {/* Test Results */}
        {testResults.length > 0 && (
          <GlassCard padding="sm" className="border-green-500/20">
            <p className="text-xs font-medium text-green-400 mb-2">
              Test Results ({testResults.length} row{testResults.length > 1 ? 's' : ''})
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {testResults.map((result, index) => (
                <div key={index} className="p-2 bg-white/5 rounded-lg">
                  <p className="text-xs text-white/40 mb-1">Row {index + 1}</p>
                  <p className="text-sm text-white/70 whitespace-pre-wrap">{result}</p>
                </div>
              ))}
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
      <div className="p-4 border-t border-white/10 space-y-3">
        {/* Loading indicator when config is loading */}
        {isConfigLoading && (
          <div className="flex items-center justify-center gap-2 py-2 text-white/60 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading configuration...
          </div>
        )}
        {/* Test/Retry buttons row */}
        <div className="flex gap-2">
          <GlassButton
            variant="ghost"
            className="flex-1"
            onClick={() => handleTest(1)}
            disabled={!prompt || (!isEditMode && !outputColumnName.trim()) || isTesting || isRunning || !canRunEnrichment}
            loading={isTesting && testingRows === 1}
          >
            <TestTube className="w-4 h-4 mr-1" />
            {isEditMode ? 'Retry 1 Row' : 'Test 1 Row'}
          </GlassButton>
          <GlassButton
            variant="ghost"
            className="flex-1"
            onClick={() => handleTest(10)}
            disabled={!prompt || (!isEditMode && !outputColumnName.trim()) || isTesting || isRunning || rows.length === 0 || !canRunEnrichment}
            loading={isTesting && testingRows === 10}
          >
            <TestTube className="w-4 h-4 mr-1" />
            {isEditMode ? 'Retry 10 Rows' : 'Test 10 Rows'}
          </GlassButton>
        </div>
        {/* Save button - only in edit mode */}
        {isEditMode && (
          <GlassButton
            variant="ghost"
            className="w-full"
            onClick={handleSave}
            disabled={!prompt || isTesting || isRunning || isSaving || !canRunEnrichment}
            loading={isSaving}
          >
            <Save className="w-4 h-4 mr-1" />
            Save Configuration
          </GlassButton>
        )}
        {/* Run button */}
        <GlassButton
          variant="primary"
          className="w-full"
          onClick={handleRun}
          disabled={!prompt || (!isEditMode && !outputColumnName.trim()) || isTesting || isRunning || !canRunEnrichment}
          loading={isRunning}
        >
          <Play className="w-4 h-4 mr-1" />
          {isEditMode
            ? selectedRows.size > 0
              ? `Re-run on ${selectedRows.size} Selected`
              : 'Re-run on All Rows'
            : selectedRows.size > 0
              ? `Run on ${selectedRows.size} Selected`
              : 'Run on All Rows'
          }
        </GlassButton>
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
                      <p className="text-xs text-white/40">
                        These output fields will be created to store the AI&apos;s structured response.
                      </p>
                      <div className="border border-white/10 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-white/5">
                            <tr>
                              <th className="text-left p-3 text-white/50 font-medium w-1/3">Field</th>
                              <th className="text-left p-3 text-white/50 font-medium">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recommendedDataGuide.map((field, idx) => (
                              <tr key={idx} className="border-t border-white/5">
                                <td className="p-3 text-emerald-300 font-mono text-xs">{field.name}</td>
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
