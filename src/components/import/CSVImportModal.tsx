'use client';

import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { Upload, FileSpreadsheet, AlertCircle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, GlassButton, GlassInput } from '@/components/ui';

interface CSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  tableId?: string;
  onImportComplete: (tableId: string) => void;
}

interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
  preview: Record<string, string>[];
}

type ImportMode = 'create' | 'append' | 'replace';

export function CSVImportModal({
  isOpen,
  onClose,
  projectId,
  tableId,
  onImportComplete,
}: CSVImportModalProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [tableName, setTableName] = useState('');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [importMode, setImportMode] = useState<ImportMode>('create');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === 'text/csv' || droppedFile?.name.endsWith('.csv')) {
      handleFile(droppedFile);
    } else {
      setError('Please upload a CSV file');
    }
  }, []);

  const handleFile = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setTableName(selectedFile.name.replace('.csv', ''));

    Papa.parse<Record<string, string>>(selectedFile, {
      header: true,
      preview: 100, // Parse first 100 rows for preview
      complete: (results) => {
        if (results.errors.length > 0) {
          setError(`Parse error: ${results.errors[0].message}`);
          return;
        }

        const headers = results.meta.fields || [];
        const rows = results.data.filter((row) =>
          Object.values(row).some((v) => v && v.trim())
        );

        setParsedData({
          headers,
          rows,
          preview: rows.slice(0, 10),
        });

        // Initialize column mapping and selection
        const mapping: Record<string, string> = {};
        const selected = new Set<string>();
        headers.forEach((h) => {
          mapping[h] = h;
          selected.add(h);
        });
        setColumnMapping(mapping);
        setSelectedColumns(selected);

        setStep('mapping');
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
      },
    });
  };

  const handleImport = async () => {
    if (!parsedData || !file) return;

    setIsImporting(true);
    setStep('importing');
    setProgress(0);

    try {
      // Parse full file
      Papa.parse<Record<string, string>>(file, {
        header: true,
        worker: true,
        complete: async (results) => {
          const rows = results.data.filter((row) =>
            Object.values(row).some((v) => v && v.trim())
          );

          // Filter to selected columns only
          const filteredRows = rows.map((row) => {
            const filtered: Record<string, string> = {};
            selectedColumns.forEach((col) => {
              filtered[columnMapping[col] || col] = row[col] || '';
            });
            return filtered;
          });

          // Send to API
          const response = await fetch('/api/import/csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              tableId,
              tableName,
              data: filteredRows,
              columnMapping,
              mode: importMode,
            }),
          });

          if (!response.ok) {
            throw new Error('Import failed');
          }

          const result = await response.json();
          setProgress(100);

          setTimeout(() => {
            onImportComplete(result.tableId);
            handleReset();
          }, 500);
        },
      });
    } catch (err) {
      setError((err as Error).message);
      setStep('mapping');
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setParsedData(null);
    setTableName('');
    setColumnMapping({});
    setSelectedColumns(new Set());
    setError(null);
    setProgress(0);
    onClose();
  };

  const toggleColumn = (header: string) => {
    const newSelected = new Set(selectedColumns);
    if (newSelected.has(header)) {
      newSelected.delete(header);
    } else {
      newSelected.add(header);
    }
    setSelectedColumns(newSelected);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title="Import CSV"
      description="Upload a CSV file to import data"
      size="lg"
    >
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className={cn(
              'border-2 border-dashed border-white/20 rounded-xl p-8',
              'flex flex-col items-center justify-center gap-4',
              'transition-colors hover:border-lavender/50 cursor-pointer'
            )}
            onClick={() => document.getElementById('csv-input')?.click()}
          >
            <Upload className="w-12 h-12 text-white/30" />
            <div className="text-center">
              <p className="text-white/70">Drag and drop your CSV file here</p>
              <p className="text-sm text-white/40 mt-1">or click to browse</p>
            </div>
            <input
              id="csv-input"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}
        </div>
      )}

      {step === 'mapping' && parsedData && (
        <div className="space-y-4">
          {/* File info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
            <FileSpreadsheet className="w-5 h-5 text-lavender" />
            <div>
              <p className="text-sm font-medium text-white">{file?.name}</p>
              <p className="text-xs text-white/50">
                {parsedData.rows.length} rows, {parsedData.headers.length} columns
              </p>
            </div>
          </div>

          {/* Table name */}
          {importMode === 'create' && (
            <GlassInput
              label="Table Name"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
            />
          )}

          {/* Import mode */}
          {tableId && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/70">Import Mode</label>
              <div className="flex gap-2">
                {(['create', 'append', 'replace'] as ImportMode[]).map((mode) => (
                  <GlassButton
                    key={mode}
                    variant={importMode === mode ? 'primary' : 'default'}
                    size="sm"
                    onClick={() => setImportMode(mode)}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </GlassButton>
                ))}
              </div>
            </div>
          )}

          {/* Column mapping */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70">
              Columns ({selectedColumns.size} selected)
            </label>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {parsedData.headers.map((header) => (
                <div
                  key={header}
                  className={cn(
                    'flex items-center gap-3 p-2 rounded-lg',
                    'transition-colors',
                    selectedColumns.has(header) ? 'bg-white/5' : 'opacity-50'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedColumns.has(header)}
                    onChange={() => toggleColumn(header)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5"
                  />
                  <span className="text-sm text-white/70 w-32 truncate">{header}</span>
                  <span className="text-white/30">→</span>
                  <input
                    type="text"
                    value={columnMapping[header] || header}
                    onChange={(e) =>
                      setColumnMapping({ ...columnMapping, [header]: e.target.value })
                    }
                    disabled={!selectedColumns.has(header)}
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70">Preview</label>
            <div className="overflow-x-auto max-h-40 rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 sticky top-0">
                  <tr>
                    {Array.from(selectedColumns).map((header) => (
                      <th
                        key={header}
                        className="px-3 py-2 text-left text-white/70 font-medium"
                      >
                        {columnMapping[header] || header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedData.preview.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-white/5">
                      {Array.from(selectedColumns).map((header) => (
                        <td key={header} className="px-3 py-2 text-white/60 truncate max-w-[150px]">
                          {row[header] || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <GlassButton variant="ghost" onClick={handleReset}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleImport}
              disabled={selectedColumns.size === 0 || (!tableId && !tableName)}
            >
              Import {parsedData.rows.length} rows
            </GlassButton>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="py-8 space-y-4">
          <div className="flex flex-col items-center gap-4">
            {progress < 100 ? (
              <>
                <div className="animate-spin w-8 h-8 border-2 border-lavender border-t-transparent rounded-full" />
                <p className="text-white/70">Importing data...</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-white/70">Import complete!</p>
              </>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-lavender transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
