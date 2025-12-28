'use client';

import { useState, useCallback, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, FileSpreadsheet, AlertCircle, Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, GlassButton } from '@/components/ui';

interface CSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  onImportComplete: (tableId: string) => void;
}

interface ParsedData {
  headers: string[];
  rows: Record<string, string>[];
  preview: Record<string, string>[];
}

interface ExistingColumn {
  id: string;
  name: string;
  type: string;
}

type MappingTarget = { type: 'existing'; columnId: string } | { type: 'new'; name: string } | { type: 'skip' };

export function CSVImportModal({
  isOpen,
  onClose,
  tableId,
  onImportComplete,
}: CSVImportModalProps) {
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [existingColumns, setExistingColumns] = useState<ExistingColumn[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, MappingTarget>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [totalRowsToImport, setTotalRowsToImport] = useState(0);

  // Fetch existing columns when modal opens
  useEffect(() => {
    if (isOpen && tableId) {
      fetchExistingColumns();
    }
  }, [isOpen, tableId]);

  const fetchExistingColumns = async () => {
    try {
      const response = await fetch(`/api/columns?tableId=${tableId}`);
      if (response.ok) {
        const columns = await response.json();
        setExistingColumns(columns);
      }
    } catch (error) {
      console.error('Failed to fetch existing columns:', error);
    }
  };

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

    Papa.parse<Record<string, string>>(selectedFile, {
      header: true,
      preview: 100,
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

        // Auto-match columns by name (case-insensitive)
        const mapping: Record<string, MappingTarget> = {};
        headers.forEach((header) => {
          const matchingColumn = existingColumns.find(
            (col) => col.name.toLowerCase() === header.toLowerCase()
          );
          if (matchingColumn) {
            mapping[header] = { type: 'existing', columnId: matchingColumn.id };
          } else {
            mapping[header] = { type: 'new', name: header };
          }
        });
        setColumnMapping(mapping);

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

          // Build the final column mapping for the API
          const apiColumnMapping: Record<string, { targetColumnId?: string; newColumnName?: string }> = {};

          Object.entries(columnMapping).forEach(([csvHeader, target]) => {
            if (target.type === 'existing') {
              apiColumnMapping[csvHeader] = { targetColumnId: target.columnId };
            } else if (target.type === 'new') {
              apiColumnMapping[csvHeader] = { newColumnName: target.name };
            }
            // Skip type means don't include this column
          });

          // Filter rows to only include mapped columns
          const filteredRows = rows.map((row) => {
            const filtered: Record<string, string> = {};
            Object.keys(apiColumnMapping).forEach((csvHeader) => {
              filtered[csvHeader] = row[csvHeader] || '';
            });
            return filtered;
          });

          // Chunk size for large imports
          const CHUNK_SIZE = 5000;
          const totalRows = filteredRows.length;
          setTotalRowsToImport(totalRows);

          // Send in chunks
          for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
            const chunk = filteredRows.slice(i, i + CHUNK_SIZE);
            const isLastChunk = i + CHUNK_SIZE >= totalRows;

            const response = await fetch('/api/import/csv', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tableId,
                data: chunk,
                columnMapping: apiColumnMapping,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || 'Import failed');
            }

            const progressPercent = Math.min(
              Math.round(((i + chunk.length) / totalRows) * 100),
              isLastChunk ? 100 : 99
            );
            setProgress(progressPercent);
          }

          setProgress(100);

          setTimeout(() => {
            onImportComplete(tableId);
            handleReset();
          }, 500);
        },
      });
    } catch (err) {
      setError((err as Error).message);
      setStep('mapping');
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setParsedData(null);
    setColumnMapping({});
    setError(null);
    setProgress(0);
    setTotalRowsToImport(0);
    setIsImporting(false);
    onClose();
  };

  const updateMapping = (csvHeader: string, target: MappingTarget) => {
    setColumnMapping({ ...columnMapping, [csvHeader]: target });
  };

  const getMappedCount = () => {
    return Object.values(columnMapping).filter(t => t.type !== 'skip').length;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title="Import CSV"
      description="Upload a CSV file to import data"
      size="2xl"
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

          {/* Column mapping */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white/70">
                Column Mapping ({getMappedCount()} of {parsedData.headers.length} mapped)
              </label>
            </div>

            <div className="text-xs text-white/40 mb-2">
              Map CSV columns to existing table columns or create new ones
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2 scroll-smooth">
              {parsedData.headers.map((header) => {
                const mapping = columnMapping[header];
                return (
                  <div
                    key={header}
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/5"
                  >
                    {/* CSV Column Name */}
                    <div className="w-32 flex-shrink-0">
                      <span className="text-sm text-white/70 truncate block">{header}</span>
                    </div>

                    <span className="text-white/30 text-sm">→</span>

                    {/* Target Selection */}
                    <div className="flex-1">
                      <select
                        value={
                          mapping?.type === 'existing' ? `existing:${mapping.columnId}` :
                          mapping?.type === 'new' ? 'new' :
                          'skip'
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === 'skip') {
                            updateMapping(header, { type: 'skip' });
                          } else if (value === 'new') {
                            updateMapping(header, { type: 'new', name: header });
                          } else if (value.startsWith('existing:')) {
                            const columnId = value.replace('existing:', '');
                            updateMapping(header, { type: 'existing', columnId });
                          }
                        }}
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-lavender"
                      >
                        <option value="skip" className="bg-midnight-100">Skip this column</option>
                        <option value="new" className="bg-midnight-100">+ Create new column</option>
                        {existingColumns.length > 0 && (
                          <optgroup label="Existing columns" className="bg-midnight-100">
                            {existingColumns.map((col) => (
                              <option key={col.id} value={`existing:${col.id}`} className="bg-midnight-100">
                                {col.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    {/* New column name input (if creating new) */}
                    {mapping?.type === 'new' && (
                      <input
                        type="text"
                        value={mapping.name}
                        onChange={(e) => updateMapping(header, { type: 'new', name: e.target.value })}
                        placeholder="Column name"
                        className="w-32 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-lavender"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70">Preview</label>
            <div className="overflow-x-auto max-h-40 rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-midnight-100 sticky top-0 z-10">
                  <tr>
                    {parsedData.headers
                      .filter((h) => columnMapping[h]?.type !== 'skip')
                      .map((header) => {
                        const mapping = columnMapping[header];
                        let displayName = header;
                        if (mapping?.type === 'existing') {
                          const col = existingColumns.find(c => c.id === mapping.columnId);
                          displayName = col?.name || header;
                        } else if (mapping?.type === 'new') {
                          displayName = mapping.name;
                        }
                        return (
                          <th
                            key={header}
                            className="px-2 py-1.5 text-left text-white/70 font-medium whitespace-nowrap border-b border-white/10"
                          >
                            {displayName}
                          </th>
                        );
                      })}
                  </tr>
                </thead>
                <tbody>
                  {parsedData.preview.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-white/5">
                      {parsedData.headers
                        .filter((h) => columnMapping[h]?.type !== 'skip')
                        .map((header) => (
                          <td key={header} className="px-2 py-1 text-white/50 truncate max-w-[100px]">
                            {row[header] || '-'}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <GlassButton variant="ghost" onClick={handleReset}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleImport}
              disabled={getMappedCount() === 0}
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
                <p className="text-sm text-white/50">
                  {Math.round((progress / 100) * totalRowsToImport).toLocaleString()} of {totalRowsToImport.toLocaleString()} rows
                </p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-white/70">Import complete!</p>
                <p className="text-sm text-white/50">
                  {totalRowsToImport.toLocaleString()} rows imported
                </p>
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
          <p className="text-center text-xs text-white/40">{progress}%</p>
        </div>
      )}
    </Modal>
  );
}
