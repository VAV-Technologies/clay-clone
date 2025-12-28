'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Eye, EyeOff, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';

export function ColumnVisibilityDropdown() {
  const {
    columns,
    hiddenColumns,
    toggleColumnVisibility,
    showAllColumns,
    getVisibleColumns,
  } = useTableStore();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleColumns = getVisibleColumns();
  const hiddenCount = hiddenColumns.size;
  const hasHiddenColumns = hiddenCount > 0;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors',
          'hover:bg-white/10',
          hasHiddenColumns ? 'text-lavender' : 'text-white/50'
        )}
      >
        <span>
          {columns.length} {columns.length === 1 ? 'column' : 'columns'}
          {hasHiddenColumns && (
            <span className="text-white/40"> ({hiddenCount} hidden)</span>
          )}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-lg bg-midnight-100/95 backdrop-blur-xl border border-white/10 shadow-xl overflow-hidden">
          {/* Header with Show All */}
          {hasHiddenColumns && (
            <div className="px-3 py-2 border-b border-white/10">
              <button
                onClick={() => {
                  showAllColumns();
                }}
                className="flex items-center gap-2 text-sm text-lavender hover:text-lavender/80 transition-colors"
              >
                <Eye className="w-4 h-4" />
                Show all columns
              </button>
            </div>
          )}

          {/* Column List */}
          <div className="max-h-64 overflow-y-auto py-1">
            {columns.map((column) => {
              const isHidden = hiddenColumns.has(column.id);
              return (
                <button
                  key={column.id}
                  onClick={() => toggleColumnVisibility(column.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                    'hover:bg-white/5',
                    isHidden ? 'text-white/40' : 'text-white/80'
                  )}
                >
                  {/* Checkbox indicator */}
                  <div
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center',
                      isHidden
                        ? 'border-white/20 bg-transparent'
                        : 'border-lavender bg-lavender/20'
                    )}
                  >
                    {!isHidden && <Check className="w-3 h-3 text-lavender" />}
                  </div>

                  {/* Column name */}
                  <span className="flex-1 truncate">{column.name}</span>

                  {/* Visibility icon */}
                  {isHidden ? (
                    <EyeOff className="w-3.5 h-3.5 text-white/30" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 text-white/30" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer with count */}
          <div className="px-3 py-2 border-t border-white/10 text-xs text-white/40">
            {visibleColumns.length} of {columns.length} columns visible
          </div>
        </div>
      )}
    </div>
  );
}
