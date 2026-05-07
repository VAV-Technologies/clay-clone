'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Sparkles, Code, Clock, Mail, Link2, Zap, ChevronDown, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import { ColumnHeader } from './ColumnHeader';
import { Cell } from './Cell';
import { FilterBar } from './FilterBar';
import { EnrichmentDataViewer } from './EnrichmentDataViewer';
import { BatchEnrichmentPanel } from '@/components/enrichment/BatchEnrichmentPanel';
import { FindEmailPanel } from '@/components/email/FindEmailPanel';
import { LookUpPanel } from '@/components/lookup/LookUpPanel';
import { RowDisplayControl } from './RowDisplayControl';
import { ColumnVisibilityDropdown } from './ColumnVisibilityDropdown';
import { AddFilterButton } from './AddFilterButton';

interface SpreadsheetViewProps {
  tableId: string;
  onEnrich?: (columnId?: string) => void;
  onFormula?: (columnId?: string) => void;
  onAddClayData?: () => void;
  onAddAiArcData?: () => void;
  onAddWattdata?: () => void;
}

const ROW_HEIGHT = 43;
const HEADER_HEIGHT = 40;
const CHECKBOX_WIDTH = 40;
const ROW_NUMBER_WIDTH = 50;
const STATUS_ROW_HEIGHT = 24;

interface CellMetadata {
  inputTokens: number;
  outputTokens: number;
  timeTakenMs: number;
  totalCost: number;
  forcedToFinishEarly?: boolean;
  webSearchCalls?: number;
  webSearchCost?: number;
}

interface EnrichmentDataState {
  isOpen: boolean;
  rowId: string;
  columnId: string;
  data: Record<string, string | number | null>;
  metadata?: CellMetadata;
}

export function SpreadsheetView({ tableId, onEnrich, onFormula, onAddClayData, onAddAiArcData, onAddWattdata }: SpreadsheetViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // State for enrichment data viewer
  const [enrichmentDataState, setEnrichmentDataState] = useState<EnrichmentDataState>({
    isOpen: false,
    rowId: '',
    columnId: '',
    data: {},
  });

  // State for batch enrichment panel
  const [isBatchEnrichmentOpen, setIsBatchEnrichmentOpen] = useState(false);

  // State for find email panel
  const [isFindEmailOpen, setIsFindEmailOpen] = useState(false);

  // State for look up panel
  const [isLookUpOpen, setIsLookUpOpen] = useState(false);

  // Actions dropdown
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [isAddDataOpen, setIsAddDataOpen] = useState(false);
  const addDataButtonRef = useRef<HTMLButtonElement>(null);

  const {
    currentTable,
    columns,
    rows,
    isLoading,
    editingCell,
    selectedRows,
    fetchTable,
    addRow,
    addColumn,
    deleteRows,
    selectRow,
    clearSelection,
    setEditingCell,
    getDisplayedRows,
    getVisibleColumns,
  } = useTableStore();

  useEffect(() => {
    fetchTable(tableId);
  }, [tableId, fetchTable]);

  // Poll for updates only when enrichment jobs are active
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    let isMounted = true;

    const checkForActiveJobs = async (): Promise<boolean> => {
      try {
        const enrichmentColumns = columns.filter(c => c.type === 'enrichment');
        if (enrichmentColumns.length === 0) return false;

        for (const col of enrichmentColumns) {
          const response = await fetch(`/api/enrichment/jobs?columnId=${col.id}`);
          if (response.ok) {
            const data = await response.json();
            const activeJob = data.jobs?.find(
              (j: { status: string }) => j.status === 'pending' || j.status === 'running'
            );
            if (activeJob) return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    };

    const poll = async () => {
      if (!isMounted) return;

      const hasActiveJobs = await checkForActiveJobs();
      if (!isMounted) return;

      if (hasActiveJobs) {
        setIsPolling(true);
        fetchTable(tableId, true);
        pollInterval = setTimeout(poll, 5000);
      } else {
        // No active jobs — stop polling
        setIsPolling(false);
      }
    };

    // Check once after load, then only poll if jobs are active
    if (!isLoading && columns.length > 0) {
      poll();
    }

    return () => {
      isMounted = false;
      if (pollInterval) clearTimeout(pollInterval);
    };
  }, [tableId, columns, isLoading, fetchTable]);

  // Use displayed rows (filtered + sorted + range limited)
  const displayedRows = getDisplayedRows();
  // Use visible columns (hidden columns filtered out)
  const visibleColumns = getVisibleColumns();

  // Calculate enrichment status counts for each enrichment column
  const enrichmentStats = useMemo(() => {
    const stats: Record<string, { completed: number; errors: number; inQueue: number; processing: number; notRun: number; batchPending: number }> = {};

    for (const col of visibleColumns) {
      if (col.type === 'enrichment' && col.enrichmentConfigId) {
        let completed = 0, errors = 0, inQueue = 0, processing = 0, notRun = 0, batchPending = 0;

        for (const row of rows) {
          const cell = row.data[col.id];
          if (!cell || !cell.status) notRun++;        // No status = not run
          else if (cell.status === 'pending') inQueue++; // Pending = queued
          else if (cell.status === 'complete') completed++;
          else if (cell.status === 'error') errors++;
          else if (cell.status === 'processing') processing++;
          else if (cell.status === 'batch_submitted' || cell.status === 'batch_processing') batchPending++;
        }

        stats[col.id] = { completed, errors, inQueue, processing, notRun, batchPending };
      }
    }
    return stats;
  }, [visibleColumns, rows]);

  const rowVirtualizer = useVirtualizer({
    count: displayedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Calculate widths using visible columns
  const ADD_COLUMN_WIDTH = 40;
  const columnsWidth = visibleColumns.reduce((sum, col) => sum + (col.width || 150), 0);
  const rowWidth = CHECKBOX_WIDTH + ROW_NUMBER_WIDTH + columnsWidth;
  const totalWidth = rowWidth + ADD_COLUMN_WIDTH;

  const handleAddRow = async () => {
    try {
      const response = await fetch('/api/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, rows: [{}] }),
      });

      if (response.ok) {
        const [newRow] = await response.json();
        addRow(newRow);
      }
    } catch (error) {
      console.error('Failed to add row:', error);
    }
  };

  const handleAddColumn = async () => {
    try {
      const response = await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId,
          name: `Column ${columns.length + 1}`,
          type: 'text',
        }),
      });

      if (response.ok) {
        const newColumn = await response.json();
        addColumn(newColumn);
      }
    } catch (error) {
      console.error('Failed to add column:', error);
    }
  };

  const handleDeleteSelectedRows = async () => {
    if (selectedRows.size === 0) return;

    try {
      const ids = Array.from(selectedRows);
      const response = await fetch('/api/rows', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tableId }),
      });

      if (response.ok) {
        deleteRows(ids);
      }
    } catch (error) {
      console.error('Failed to delete rows:', error);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingCell(null);
        clearSelection();
      }
      if (e.key === 'Delete' && selectedRows.size > 0 && !editingCell) {
        handleDeleteSelectedRows();
      }
    },
    [selectedRows, editingCell, setEditingCell, clearSelection]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handler for showing enrichment data viewer
  const handleShowEnrichmentData = useCallback(
    (rowId: string, columnId: string, data: Record<string, string | number | null>, metadata?: CellMetadata) => {
      setEnrichmentDataState({
        isOpen: true,
        rowId,
        columnId,
        data,
        metadata,
      });
    },
    []
  );

  // Handler for closing enrichment data viewer
  const handleCloseEnrichmentData = useCallback(() => {
    setEnrichmentDataState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Handler for extracting datapoint to new column
  const handleExtractToColumn = useCallback(
    async (dataKey: string) => {
      const response = await fetch('/api/enrichment/extract-datapoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId,
          sourceColumnId: enrichmentDataState.columnId,
          dataKey,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to extract datapoint');
      }

      const result = await response.json();

      // Add the new column to the store
      if (result.column) {
        addColumn(result.column);
      }

      // Refresh the table to get updated row data
      await fetchTable(tableId);
    },
    [tableId, enrichmentDataState.columnId, addColumn, fetchTable]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-lavender border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!currentTable) {
    return (
      <div className="flex items-center justify-center h-full text-white/50">
        Table not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border border-white/10 bg-white/[0.02] backdrop-blur-md shadow-2xl overflow-hidden">
      {/* Toolbar - Row/column controls and actions */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-1">
          <RowDisplayControl />
          <ColumnVisibilityDropdown />
          <AddFilterButton />
        </div>

        <div className="flex items-center gap-2">
          {selectedRows.size > 0 && (
            <GlassButton
              variant="danger"
              size="sm"
              onClick={handleDeleteSelectedRows}
            >
              Delete ({selectedRows.size})
            </GlassButton>
          )}

          {/* Add Data dropdown */}
          <div className="relative">
            <button
              ref={addDataButtonRef}
              onClick={() => setIsAddDataOpen(!isAddDataOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                         bg-emerald-500/20 border border-emerald-500/30 text-white
                         hover:bg-emerald-500/30 transition-all"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              Add Data
              <ChevronDown className={cn('w-3.5 h-3.5 text-white/50 transition-transform', isAddDataOpen && 'rotate-180')} />
            </button>

            {isAddDataOpen && createPortal(
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setIsAddDataOpen(false)} />
                <div
                  className="fixed z-[100] w-52 bg-midnight-100/95 backdrop-blur-xl border border-white/10 shadow-2xl"
                  style={{
                    top: (addDataButtonRef.current?.getBoundingClientRect().bottom ?? 0) + 6,
                    right: window.innerWidth - (addDataButtonRef.current?.getBoundingClientRect().right ?? 0),
                  }}
                >
                  <button
                    onClick={() => { setIsAddDataOpen(false); onAddClayData?.(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-white/[0.06] flex items-center justify-center">
                      <UserPlus className="w-3.5 h-3.5 text-white/60" />
                    </div>
                    Add Clay Data
                  </button>
                  <button
                    onClick={() => { setIsAddDataOpen(false); onAddAiArcData?.(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-violet-500/10 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                    </div>
                    Add AI Ark Data
                  </button>
                  <button
                    onClick={() => { setIsAddDataOpen(false); onAddWattdata?.(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-emerald-500/10 flex items-center justify-center">
                      <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    Add Wattdata
                  </button>
                </div>
              </>,
              document.body
            )}
          </div>

          {/* Actions dropdown */}
          <div className="relative">
            <button
              ref={actionsButtonRef}
              onClick={() => setIsActionsOpen(!isActionsOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                         bg-lavender/20 border border-lavender/30 text-white
                         hover:bg-lavender/30 transition-all"
            >
              <Zap className="w-4 h-4 text-lavender" />
              Actions
              <ChevronDown className={cn('w-3.5 h-3.5 text-white/50 transition-transform', isActionsOpen && 'rotate-180')} />
            </button>

            {isActionsOpen && createPortal(
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setIsActionsOpen(false)} />
                <div
                  className="fixed z-[100] w-52 bg-midnight-100/95 backdrop-blur-xl border border-white/10 shadow-2xl"
                  style={{
                    top: (actionsButtonRef.current?.getBoundingClientRect().bottom ?? 0) + 6,
                    right: window.innerWidth - (actionsButtonRef.current?.getBoundingClientRect().right ?? 0),
                  }}
                >
                  <button
                    onClick={() => { setIsActionsOpen(false); onFormula?.(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-white/[0.06] flex items-center justify-center">
                      <Code className="w-3.5 h-3.5 text-white/60" />
                    </div>
                    Formula
                  </button>
                  <button
                    onClick={() => { setIsActionsOpen(false); setIsLookUpOpen(true); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-emerald-500/10 flex items-center justify-center">
                      <Link2 className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    Look Up
                  </button>
                  <button
                    onClick={() => { setIsActionsOpen(false); onEnrich?.(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-lavender/10 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5 text-lavender" />
                    </div>
                    Real-Time Enrich
                  </button>
                  <button
                    onClick={() => { setIsActionsOpen(false); setIsBatchEnrichmentOpen(true); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-amber-500/10 flex items-center justify-center">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    Batch Enrich
                  </button>
                  <button
                    onClick={() => { setIsActionsOpen(false); setIsFindEmailOpen(true); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="w-7 h-7 bg-cyan-500/10 flex items-center justify-center">
                      <Mail className="w-3.5 h-3.5 text-cyan-400" />
                    </div>
                    Find Email
                  </button>
                </div>
              </>,
              document.body
            )}
          </div>

        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar />

      {/* Spreadsheet - scrollable area */}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-auto"
        onClick={() => {
          if (!editingCell) clearSelection();
        }}
      >
        <div style={{ minWidth: totalWidth }}>
          {/* Header */}
          <div
            className="sticky top-0 z-10 flex glass-header"
            style={{ height: HEADER_HEIGHT }}
          >
            {/* Checkbox column header */}
            <div
              className="flex items-center justify-center border-r border-white/10 flex-shrink-0"
              style={{ width: CHECKBOX_WIDTH, minWidth: CHECKBOX_WIDTH }}
            >
              <input
                type="checkbox"
                checked={selectedRows.size === displayedRows.length && displayedRows.length > 0}
                onChange={(e) => {
                  if (e.target.checked) {
                    displayedRows.forEach((row) => selectRow(row.id, true));
                  } else {
                    clearSelection();
                  }
                }}
                className="checkbox-muted"
              />
            </div>

            {/* Row number column header */}
            <div
              className="flex items-center justify-center border-r border-white/10 flex-shrink-0 text-xs text-lavender/30"
              style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
            >
              #
            </div>

            {/* Column headers - only visible columns */}
            {visibleColumns.map((column) => (
              <ColumnHeader
                key={column.id}
                column={column}
                tableId={tableId}
                onEnrichmentClick={onEnrich}
                onFormulaClick={onFormula}
              />
            ))}

            {/* Add column button */}
            <div
              className="flex items-center justify-center border-l border-white/10 px-2"
              style={{ minWidth: 40 }}
            >
              <button
                onClick={handleAddColumn}
                className="p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Enrichment Status Summary Row */}
          <div
            className="flex border-b border-white/[0.08] bg-[#0d0d1a]/80"
            style={{ height: STATUS_ROW_HEIGHT }}
          >
            {/* Checkbox spacer */}
            <div
              className="border-r border-white/[0.05]"
              style={{ width: CHECKBOX_WIDTH, minWidth: CHECKBOX_WIDTH }}
            />

            {/* Row number spacer */}
            <div
              className="border-r border-white/[0.05]"
              style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
            />

            {/* Status cells */}
            {visibleColumns.map((column) => {
              const stats = enrichmentStats[column.id];

              if (!stats) {
                return (
                  <div
                    key={`status-${column.id}`}
                    className="border-r border-white/[0.05]"
                    style={{ width: column.width || 150, minWidth: column.width || 150 }}
                  />
                );
              }

              return (
                <div
                  key={`status-${column.id}`}
                  className="flex items-center gap-2 px-2 text-[10px] border-r border-white/[0.05] overflow-hidden"
                  style={{ width: column.width || 150, minWidth: column.width || 150 }}
                >
                  {stats.completed > 0 && (
                    <span className="text-emerald-400">{stats.completed} done</span>
                  )}
                  {stats.processing > 0 && (
                    <span className="text-lavender">{stats.processing} processing</span>
                  )}
                  {stats.inQueue > 0 && (
                    <span className="text-amber-400">{stats.inQueue} queued</span>
                  )}
                  {stats.batchPending > 0 && (
                    <span className="text-amber-400">{stats.batchPending} batch</span>
                  )}
                  {stats.errors > 0 && (
                    <span className="text-red-400">{stats.errors} errors</span>
                  )}
                  {stats.notRun > 0 && (
                    <span className="text-white/40">{stats.notRun} not run</span>
                  )}
                </div>
              );
            })}

            {/* Add column spacer */}
            <div style={{ width: ADD_COLUMN_WIDTH }} />
          </div>

          {/* Rows */}
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = displayedRows[virtualRow.index];
              const isSelected = selectedRows.has(row.id);

              return (
                <div
                  key={row.id}
                  className={cn(
                    'absolute left-0 flex',
                    // Column striping on data cells (3rd+ children); checkbox + row-number stay neutral
                    '[&>:nth-child(2n+4)]:bg-white/[0.03]',
                    isSelected ? 'bg-lavender/10' : 'hover:bg-white/[0.02]'
                  )}
                  style={{
                    top: virtualRow.start,
                    height: ROW_HEIGHT,
                    width: rowWidth,
                  }}
                >
                  {/* Checkbox */}
                  <div
                    className="flex items-center justify-center border-r border-b border-white/[0.05] flex-shrink-0"
                    style={{ width: CHECKBOX_WIDTH, minWidth: CHECKBOX_WIDTH }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => selectRow(row.id, true)}
                      onClick={(e) => e.stopPropagation()}
                      className="checkbox-muted"
                    />
                  </div>

                  {/* Row number */}
                  <div
                    className="flex items-center justify-center border-r border-b border-white/[0.05] flex-shrink-0 text-xs text-lavender/30"
                    style={{ width: ROW_NUMBER_WIDTH, minWidth: ROW_NUMBER_WIDTH }}
                  >
                    {virtualRow.index + 1}
                  </div>

                  {/* Cells - only visible columns */}
                  {visibleColumns.map((column) => (
                    <Cell
                      key={`${row.id}-${column.id}`}
                      row={row}
                      column={column}
                      tableId={tableId}
                      isEditing={
                        editingCell?.rowId === row.id &&
                        editingCell?.columnId === column.id
                      }
                      onShowEnrichmentData={handleShowEnrichmentData}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Add row button */}
          <div
            className="flex items-center h-9 border-t border-white/10"
            style={{ paddingLeft: CHECKBOX_WIDTH + ROW_NUMBER_WIDTH }}
          >
            <button
              onClick={handleAddRow}
              className="flex items-center gap-2 px-3 py-1 text-sm text-white/40 hover:text-white hover:bg-white/5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add row
            </button>
          </div>
        </div>
      </div>

      {/* Enrichment Data Viewer Modal */}
      <EnrichmentDataViewer
        isOpen={enrichmentDataState.isOpen}
        onClose={handleCloseEnrichmentData}
        data={enrichmentDataState.data}
        metadata={enrichmentDataState.metadata}
        rowId={enrichmentDataState.rowId}
        columnId={enrichmentDataState.columnId}
        tableId={tableId}
        onExtractToColumn={handleExtractToColumn}
      />

      {/* Batch Enrichment Panel */}
      <BatchEnrichmentPanel
        isOpen={isBatchEnrichmentOpen}
        onClose={() => setIsBatchEnrichmentOpen(false)}
      />

      {/* Find Email Panel */}
      <FindEmailPanel
        isOpen={isFindEmailOpen}
        onClose={() => setIsFindEmailOpen(false)}
      />

      {/* Look Up Panel */}
      <LookUpPanel
        isOpen={isLookUpOpen}
        onClose={() => setIsLookUpOpen(false)}
        tableId={tableId}
      />

    </div>
  );
}
