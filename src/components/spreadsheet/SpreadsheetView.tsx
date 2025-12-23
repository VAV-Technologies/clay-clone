'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Download, Upload, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import { ColumnHeader } from './ColumnHeader';
import { Cell } from './Cell';
import { FilterBar } from './FilterBar';

interface SpreadsheetViewProps {
  tableId: string;
}

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const CHECKBOX_WIDTH = 40;

export function SpreadsheetView({ tableId }: SpreadsheetViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    currentTable,
    columns,
    filters,
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
    getSortedRows,
  } = useTableStore();

  useEffect(() => {
    fetchTable(tableId);
  }, [tableId, fetchTable]);

  const sortedRows = getSortedRows();

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const totalWidth = columns.reduce((sum, col) => sum + (col.width || 150), 0) + CHECKBOX_WIDTH;

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
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">{currentTable.name}</h2>
          <span className="text-sm text-white/50">
            {sortedRows.length} rows
          </span>
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

          <GlassButton variant="ghost" size="sm">
            <Upload className="w-4 h-4 mr-1" />
            Import
          </GlassButton>

          <GlassButton variant="ghost" size="sm">
            <Download className="w-4 h-4 mr-1" />
            Export
          </GlassButton>

          <GlassButton variant="primary" size="sm">
            <Sparkles className="w-4 h-4 mr-1" />
            Enrich
          </GlassButton>
        </div>
      </div>

      {/* Filter Bar */}
      {filters.length > 0 && <FilterBar />}

      {/* Spreadsheet */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
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
              className="flex items-center justify-center border-r border-white/10"
              style={{ width: CHECKBOX_WIDTH }}
            >
              <input
                type="checkbox"
                checked={selectedRows.size === sortedRows.length && sortedRows.length > 0}
                onChange={(e) => {
                  if (e.target.checked) {
                    sortedRows.forEach((row) => selectRow(row.id, true));
                  } else {
                    clearSelection();
                  }
                }}
                className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-lavender"
              />
            </div>

            {/* Column headers */}
            {columns.map((column) => (
              <ColumnHeader key={column.id} column={column} />
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
              const row = sortedRows[virtualRow.index];
              const isSelected = selectedRows.has(row.id);

              return (
                <div
                  key={row.id}
                  className={cn(
                    'absolute left-0 right-0 flex',
                    isSelected ? 'bg-lavender/10' : 'hover:bg-white/[0.02]'
                  )}
                  style={{
                    top: virtualRow.start,
                    height: ROW_HEIGHT,
                  }}
                >
                  {/* Checkbox */}
                  <div
                    className="flex items-center justify-center border-r border-b border-white/[0.05]"
                    style={{ width: CHECKBOX_WIDTH }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => selectRow(row.id, true)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-lavender"
                    />
                  </div>

                  {/* Cells */}
                  {columns.map((column) => (
                    <Cell
                      key={`${row.id}-${column.id}`}
                      row={row}
                      column={column}
                      isEditing={
                        editingCell?.rowId === row.id &&
                        editingCell?.columnId === column.id
                      }
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Add row button */}
          <div
            className="flex items-center h-9 border-t border-white/10"
            style={{ paddingLeft: CHECKBOX_WIDTH }}
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
    </div>
  );
}
