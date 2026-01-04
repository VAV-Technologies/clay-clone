'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Sparkles, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import { ColumnHeader } from './ColumnHeader';
import { Cell } from './Cell';
import { FilterBar } from './FilterBar';
import { EnrichmentDataViewer } from './EnrichmentDataViewer';
import { RowDisplayControl } from './RowDisplayControl';
import { ColumnVisibilityDropdown } from './ColumnVisibilityDropdown';
import { AddFilterButton } from './AddFilterButton';

interface SpreadsheetViewProps {
  tableId: string;
  onEnrich?: (columnId?: string) => void;
  onFormula?: (columnId?: string) => void;
}

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const CHECKBOX_WIDTH = 40;
const ROW_NUMBER_WIDTH = 50;

interface EnrichmentDataState {
  isOpen: boolean;
  rowId: string;
  columnId: string;
  data: Record<string, string | number | null>;
}

export function SpreadsheetView({ tableId, onEnrich, onFormula }: SpreadsheetViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // State for enrichment data viewer
  const [enrichmentDataState, setEnrichmentDataState] = useState<EnrichmentDataState>({
    isOpen: false,
    rowId: '',
    columnId: '',
    data: {},
  });

  const {
    currentTable,
    columns,
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

  // Use displayed rows (filtered + sorted + range limited)
  const displayedRows = getDisplayedRows();
  // Use visible columns (hidden columns filtered out)
  const visibleColumns = getVisibleColumns();

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
    (rowId: string, columnId: string, data: Record<string, string | number | null>) => {
      setEnrichmentDataState({
        isOpen: true,
        rowId,
        columnId,
        data,
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
    <div className="flex flex-col h-full overflow-hidden">
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

          <GlassButton variant="default" size="sm" onClick={() => onFormula?.()}>
            <Code className="w-4 h-4 mr-1" />
            Formula
          </GlassButton>

          <GlassButton variant="primary" size="sm" onClick={() => onEnrich?.()}>
            <Sparkles className="w-4 h-4 mr-1" />
            Enrich
          </GlassButton>
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
                className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-lavender"
              />
            </div>

            {/* Row number column header */}
            <div
              className="flex items-center justify-center border-r border-white/10 flex-shrink-0 text-xs text-white/40"
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
                className="p-1 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
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
                      className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-lavender"
                    />
                  </div>

                  {/* Row number */}
                  <div
                    className="flex items-center justify-center border-r border-b border-white/[0.05] flex-shrink-0 text-xs text-white/40"
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
              className="flex items-center gap-2 px-3 py-1 text-sm text-white/40 hover:text-white hover:bg-white/5 rounded transition-colors"
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
        rowId={enrichmentDataState.rowId}
        columnId={enrichmentDataState.columnId}
        tableId={tableId}
        onExtractToColumn={handleExtractToColumn}
      />
    </div>
  );
}
