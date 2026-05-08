'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, AlertCircle, RotateCcw, CheckCircle2, ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';
import type { Row, Column, CellValue } from '@/lib/db/schema';

interface CellMetadata {
  inputTokens: number;
  outputTokens: number;
  timeTakenMs: number;
  totalCost: number;
  forcedToFinishEarly?: boolean;
  webSearchCalls?: number;
  webSearchCost?: number;
}

interface CellProps {
  row: Row;
  column: Column;
  isEditing: boolean;
  tableId: string;
  onShowEnrichmentData?: (rowId: string, columnId: string, data: Record<string, string | number | null>, metadata?: CellMetadata) => void;
}

export const Cell = memo(function Cell({ row, column, isEditing, tableId, onShowEnrichmentData }: CellProps) {
  const { updateCell, setEditingCell, fetchTable } = useTableStore();
  const [editValue, setEditValue] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const errorBadgeRef = useRef<HTMLDivElement>(null);
  const hasInitializedEdit = useRef(false);

  const cellData = row.data[column.id] as CellValue | undefined;
  const displayValue = cellData?.value ?? '';
  const status = cellData?.status;
  const enrichmentData = cellData?.enrichmentData;
  const metadata = cellData?.metadata;

  // Any 'enrichment'-typed column is a result column (AI enrichment, find-email,
  // lookup, ...). The discriminator for retry is enrichmentConfigId vs actionKind.
  const isResultColumn = column.type === 'enrichment';

  const handleRetryCell = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isResultColumn || isRetrying) return;

    // Pick the right retry endpoint by column source.
    let endpoint: string | null = null;
    if (column.enrichmentConfigId) {
      endpoint = '/api/enrichment/retry-cell';
    } else if (column.actionKind?.startsWith('find_email_')) {
      endpoint = '/api/find-email/retry-cell';
    } else if (column.actionKind === 'lookup') {
      endpoint = '/api/lookup/retry-cell';
    }
    if (!endpoint) return;

    setIsRetrying(true);

    try {
      // Mark as processing locally
      updateCell(row.id, column.id, { value: null, status: 'processing' });

      const response = await fetch(endpoint, {
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
        // Refresh the entire table to get updated output columns (silent to avoid full-page blur)
        await fetchTable(tableId, true);
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

    // If it's a completed result column, show the data viewer
    if (isResultColumn && status === 'complete') {
      // Use enrichmentData if available, otherwise create a simple object with the display value
      const dataToShow = enrichmentData && Object.keys(enrichmentData).length > 0
        ? enrichmentData
        : displayValue !== null && displayValue !== undefined
          ? { result: displayValue }
          : {};
      onShowEnrichmentData?.(row.id, column.id, dataToShow, metadata);
      return;
    }

    // Otherwise, enter edit mode for non-result columns
    if (!isEditing && !isResultColumn) {
      setEditingCell({ rowId: row.id, columnId: column.id });
    }
  };

  useEffect(() => {
    if (isEditing && !hasInitializedEdit.current) {
      setEditValue(displayValue?.toString() ?? '');
      inputRef.current?.focus();
      inputRef.current?.select();
      hasInitializedEdit.current = true;
    }
    if (!isEditing) {
      hasInitializedEdit.current = false;
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

  const handleErrorHover = useCallback((show: boolean) => {
    if (show && errorBadgeRef.current) {
      const rect = errorBadgeRef.current.getBoundingClientRect();
      setTooltipPosition({ x: rect.left, y: rect.bottom + 4 });
    }
    setShowTooltip(show);
  }, []);

  const renderEnrichmentContent = () => {
    if (status === 'processing') {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-lavender/20 text-lavender">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-xs font-medium">Processing</span>
          </div>
        </div>
      );
    }

    if (status === 'batch_submitted' || status === 'batch_processing') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/20 text-amber-400">
          <Clock className="w-3 h-3" />
          <span className="text-xs font-medium">
            {status === 'batch_submitted' ? 'Request Sent' : 'Processing'}
          </span>
        </div>
      );
    }

    if (status === 'error') {
      const errorMessage = cellData?.error || 'Unknown error';
      return (
        <>
          <div
            ref={errorBadgeRef}
            onMouseEnter={() => handleErrorHover(true)}
            onMouseLeave={() => handleErrorHover(false)}
            className="flex items-center gap-2 relative"
          >
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-500/20 text-red-400">
              <AlertCircle className="w-3 h-3" />
              <span className="text-xs font-medium">Error</span>
            </div>
          </div>
          {/* Portal the tooltip to document.body to escape overflow containers */}
          {showTooltip && typeof document !== 'undefined' && createPortal(
            <div
              className="fixed z-[9999] pointer-events-none"
              style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
            >
              <div className="bg-red-950/95 border border-red-500/30 px-3 py-2 text-xs text-red-200 shadow-xl max-w-[300px]">
                <div className="font-medium text-red-400 mb-1">Error Details</div>
                <div className="break-words">{errorMessage}</div>
              </div>
            </div>,
            document.body
          )}
        </>
      );
    }

    if (status === 'complete') {
      return (
        <div className="flex items-center gap-2 cursor-pointer group/badge">
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/20 text-emerald-400
                        group-hover/badge:bg-emerald-500/30 transition-colors">
            <CheckCircle2 className="w-3 h-3" />
            <span className="text-xs font-medium">Completed</span>
            <ChevronRight className="w-3 h-3 opacity-60" />
          </div>
        </div>
      );
    }

    // Pending status - actually queued to run
    if (status === 'pending') {
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/20 text-amber-400">
          <span className="text-xs font-medium">In Queue</span>
        </div>
      );
    }

    // No status - never been run
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 text-white/40">
        <span className="text-xs font-medium">Not Run</span>
      </div>
    );
  };

  const renderContent = () => {
    // For result columns, show status badges
    if (isResultColumn) {
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

  // Whether this cell can be retried — only AI enrichment + recognized actionKinds.
  const canRetry =
    isResultColumn &&
    (column.enrichmentConfigId ||
      column.actionKind?.startsWith('find_email_') ||
      column.actionKind === 'lookup');

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 px-3 border-r border-b border-white/[0.05]',
        'transition-colors duration-100 group flex-shrink-0',
        isEditing && 'bg-lavender/10 ring-1 ring-lavender/50',
        isResultColumn && status === 'complete' && 'cursor-pointer hover:bg-white/[0.03]',
        isResultColumn && status === 'error' && 'bg-red-500/5 border-red-500/20'
      )}
      style={{ width: column.width || 150, minWidth: column.width || 150 }}
      onClick={handleCellClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isResultColumn) {
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
          <div className="flex-1 min-w-0 text-sm text-white/80 truncate">
            {renderContent()}
          </div>
          {/* Retry button — flex sibling so it sits beside the status badge with a gap, never overlaps. */}
          {canRetry && status !== 'processing' && status !== 'batch_submitted' && status !== 'batch_processing' && !isRetrying && (
            <button
              onClick={handleRetryCell}
              className="flex-shrink-0 p-1 bg-white/10 hover:bg-lavender/20
                         opacity-0 group-hover:opacity-100 transition-opacity"
              title="Retry"
            >
              <RotateCcw className="w-3 h-3 text-white/60 hover:text-lavender" />
            </button>
          )}
          {isRetrying && (
            <div className="flex-shrink-0 p-1">
              <Loader2 className="w-3 h-3 text-lavender animate-spin" />
            </div>
          )}
        </>
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.row.data[prev.column.id] === next.row.data[next.column.id] &&
    prev.isEditing === next.isEditing &&
    prev.column.id === next.column.id &&
    prev.column.width === next.column.width &&
    prev.column.type === next.column.type &&
    prev.column.enrichmentConfigId === next.column.enrichmentConfigId &&
    prev.column.actionKind === next.column.actionKind &&
    prev.row.id === next.row.id
  );
});
