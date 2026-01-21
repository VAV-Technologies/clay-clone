'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, RotateCcw, CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';
import type { Row, Column, CellValue } from '@/lib/db/schema';

interface CellProps {
  row: Row;
  column: Column;
  isEditing: boolean;
  tableId: string;
  onShowEnrichmentData?: (rowId: string, columnId: string, data: Record<string, string | number | null>) => void;
}

export function Cell({ row, column, isEditing, tableId, onShowEnrichmentData }: CellProps) {
  const { updateCell, setEditingCell, fetchTable } = useTableStore();
  const [editValue, setEditValue] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cellData = row.data[column.id] as CellValue | undefined;
  const displayValue = cellData?.value ?? '';
  const status = cellData?.status;
  const enrichmentData = cellData?.enrichmentData;

  // Check if this is an enrichment column with a config
  const isEnrichmentColumn = column.type === 'enrichment' && column.enrichmentConfigId;

  const handleRetryCell = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isEnrichmentColumn || isRetrying) return;

    setIsRetrying(true);

    try {
      // Mark as processing locally
      updateCell(row.id, column.id, { value: null, status: 'processing' });

      const response = await fetch('/api/enrichment/retry-cell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: row.id,
          columnId: column.id,
          tableId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to retry enrichment');
      }

      const result = await response.json();

      if (result.success) {
        // Refresh the entire table to get updated output columns
        await fetchTable(tableId);
      } else {
        updateCell(row.id, column.id, { value: null, status: 'error', error: result.error });
      }
    } catch (error) {
      updateCell(row.id, column.id, { value: null, status: 'error', error: (error as Error).message });
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCellClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // If it's a completed enrichment column, show the data viewer
    if (isEnrichmentColumn && status === 'complete') {
      // Use enrichmentData if available, otherwise create a simple object with the display value
      const dataToShow = enrichmentData && Object.keys(enrichmentData).length > 0
        ? enrichmentData
        : displayValue !== null && displayValue !== undefined
          ? { result: displayValue }
          : {};
      onShowEnrichmentData?.(row.id, column.id, dataToShow);
      return;
    }

    // Otherwise, enter edit mode for non-enrichment columns
    if (!isEditing && !isEnrichmentColumn) {
      setEditingCell({ rowId: row.id, columnId: column.id });
    }
  };

  useEffect(() => {
    if (isEditing) {
      setEditValue(displayValue?.toString() ?? '');
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, displayValue]);

  const handleSave = async () => {
    const newValue: CellValue = {
      value: editValue || null,
    };

    // Validate based on column type
    if (column.type === 'number' && editValue) {
      const num = parseFloat(editValue);
      if (isNaN(num)) {
        newValue.value = null;
      } else {
        newValue.value = num;
      }
    }

    // Update locally
    updateCell(row.id, column.id, newValue);
    setEditingCell(null);

    // Persist to server
    try {
      await fetch(`/api/rows/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { [column.id]: newValue },
        }),
      });
    } catch (error) {
      console.error('Failed to save cell:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleSave();
    }
  };

  const renderEnrichmentContent = () => {
    if (status === 'processing') {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-lavender/20 text-lavender">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-xs font-medium">Processing</span>
          </div>
        </div>
      );
    }

    if (status === 'error') {
      const errorMessage = cellData?.error || 'Unknown error';
      return (
        <div className="flex items-center gap-2 group/error relative">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
            <AlertCircle className="w-3 h-3" />
            <span className="text-xs font-medium">Error</span>
          </div>
          {/* Error tooltip on hover */}
          <div className="absolute top-full left-0 mt-1 hidden group-hover/error:block z-50 pointer-events-none">
            <div className="bg-red-950/95 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-200 shadow-xl max-w-[300px]">
              <div className="font-medium text-red-400 mb-1">Error Details</div>
              <div className="break-words">{errorMessage}</div>
            </div>
          </div>
        </div>
      );
    }

    if (status === 'complete') {
      return (
        <div className="flex items-center gap-2 cursor-pointer group/badge">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400
                        group-hover/badge:bg-emerald-500/30 transition-colors">
            <CheckCircle2 className="w-3 h-3" />
            <span className="text-xs font-medium">Completed</span>
            <ChevronRight className="w-3 h-3 opacity-60" />
          </div>
        </div>
      );
    }

    // Pending or no status - show "In Queue"
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 text-white/40">
        <span className="text-xs font-medium">In Queue</span>
      </div>
    );
  };

  const renderContent = () => {
    // For enrichment columns, show status badges
    if (isEnrichmentColumn) {
      return renderEnrichmentContent();
    }

    // Regular content rendering for non-enrichment columns
    if (!displayValue && displayValue !== 0) {
      return <span className="text-white/20">-</span>;
    }

    switch (column.type) {
      case 'email':
        return (
          <a
            href={`mailto:${displayValue}`}
            className="text-lavender hover:underline truncate"
            onClick={(e) => e.stopPropagation()}
          >
            {displayValue}
          </a>
        );

      case 'url':
        return (
          <a
            href={displayValue.toString()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lavender hover:underline truncate"
            onClick={(e) => e.stopPropagation()}
          >
            {displayValue}
          </a>
        );

      case 'number':
        return (
          <span className="font-mono">
            {typeof displayValue === 'number'
              ? displayValue.toLocaleString()
              : displayValue}
          </span>
        );

      case 'date':
        return (
          <span>
            {typeof displayValue === 'string' && !isNaN(Date.parse(displayValue))
              ? new Date(displayValue).toLocaleDateString()
              : displayValue}
          </span>
        );

      default:
        return <span className="truncate">{displayValue}</span>;
    }
  };

  return (
    <div
      className={cn(
        'relative flex items-center px-3 border-r border-b border-white/[0.05]',
        'transition-colors duration-100 group flex-shrink-0',
        isEditing && 'bg-lavender/10 ring-1 ring-lavender/50',
        isEnrichmentColumn && status === 'complete' && 'cursor-pointer hover:bg-white/[0.03]',
        isEnrichmentColumn && status === 'error' && 'bg-red-500/5 border-red-500/20'
      )}
      style={{ width: column.width || 150, minWidth: column.width || 150 }}
      onClick={handleCellClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isEnrichmentColumn) {
          setEditingCell({ rowId: row.id, columnId: column.id });
        }
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type={column.type === 'number' ? 'number' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="w-full bg-transparent border-none outline-none text-sm text-white"
        />
      ) : (
        <>
          <div className={cn(
            "flex-1 text-sm text-white/80 truncate",
            isEnrichmentColumn && "pr-6"
          )}>
            {renderContent()}
          </div>
          {/* Retry button for enrichment columns */}
          {isEnrichmentColumn && status !== 'processing' && !isRetrying && (
            <button
              onClick={handleRetryCell}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded bg-white/10 hover:bg-lavender/20
                         opacity-0 group-hover:opacity-100 transition-opacity z-10"
              title="Retry enrichment"
            >
              <RotateCcw className="w-3 h-3 text-white/60 hover:text-lavender" />
            </button>
          )}
          {/* Show spinning icon while retrying */}
          {isRetrying && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 p-1">
              <Loader2 className="w-3 h-3 text-lavender animate-spin" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
