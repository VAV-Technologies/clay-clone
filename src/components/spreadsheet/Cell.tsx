'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';
import type { Row, Column, CellValue } from '@/lib/db/schema';

interface CellProps {
  row: Row;
  column: Column;
  isEditing: boolean;
}

export function Cell({ row, column, isEditing }: CellProps) {
  const { updateCell, setEditingCell } = useTableStore();
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const cellData = row.data[column.id] as CellValue | undefined;
  const displayValue = cellData?.value ?? '';
  const status = cellData?.status;

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
      // TODO: Move to next cell
    }
  };

  const renderContent = () => {
    if (status === 'processing') {
      return (
        <div className="flex items-center gap-2 text-lavender">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span className="text-xs">Processing...</span>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex items-center gap-1 text-red-400">
          <AlertCircle className="w-3 h-3" />
          <span className="text-xs truncate">{cellData?.error || 'Error'}</span>
        </div>
      );
    }

    if (!displayValue && displayValue !== 0) {
      return <span className="text-white/20">-</span>;
    }

    // Format based on type
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
            {displayValue instanceof Date
              ? displayValue.toLocaleDateString()
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
        'flex items-center px-3 border-r border-b border-white/[0.05]',
        'transition-colors duration-100',
        isEditing && 'bg-lavender/10 ring-1 ring-lavender/50'
      )}
      style={{ width: column.width || 150 }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isEditing) {
          setEditingCell({ rowId: row.id, columnId: column.id });
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingCell({ rowId: row.id, columnId: column.id });
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
        <div className="w-full text-sm text-white/80 truncate">
          {renderContent()}
        </div>
      )}
    </div>
  );
}
