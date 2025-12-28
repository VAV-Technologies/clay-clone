'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';

export function RowDisplayControl() {
  const {
    rowDisplayStart,
    rowDisplayLimit,
    setRowDisplayRange,
    resetRowDisplayRange,
    getSortedRows,
    getDisplayedRows,
  } = useTableStore();

  const [isOpen, setIsOpen] = useState(false);
  const [startInput, setStartInput] = useState(String(rowDisplayStart + 1)); // 1-indexed for user
  const [limitInput, setLimitInput] = useState(rowDisplayLimit ? String(rowDisplayLimit) : '');
  const containerRef = useRef<HTMLDivElement>(null);

  const totalRows = getSortedRows().length;
  const displayedRows = getDisplayedRows().length;
  const hiddenRows = totalRows - displayedRows;
  const isFiltered = rowDisplayLimit !== null || rowDisplayStart > 0;

  // Sync inputs when store changes
  useEffect(() => {
    setStartInput(String(rowDisplayStart + 1));
    setLimitInput(rowDisplayLimit ? String(rowDisplayLimit) : '');
  }, [rowDisplayStart, rowDisplayLimit]);

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

  const handleApply = () => {
    const start = Math.max(0, parseInt(startInput, 10) - 1) || 0; // Convert to 0-indexed
    const limit = limitInput ? parseInt(limitInput, 10) : null;

    if (limit !== null && limit <= 0) {
      return; // Invalid limit
    }

    setRowDisplayRange(start, limit);
    setIsOpen(false);
  };

  const handleReset = () => {
    resetRowDisplayRange();
    setStartInput('1');
    setLimitInput('');
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleApply();
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors',
          'hover:bg-white/10',
          isFiltered ? 'text-lavender' : 'text-white/50'
        )}
      >
        {isFiltered ? (
          <span>
            Showing {displayedRows.toLocaleString()} of {totalRows.toLocaleString()}
            {hiddenRows > 0 && <span className="text-white/40"> ({hiddenRows.toLocaleString()} hidden)</span>}
          </span>
        ) : (
          <span>
            {totalRows.toLocaleString()} {totalRows === 1 ? 'row' : 'rows'}
          </span>
        )}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 p-3 rounded-lg bg-midnight-100/95 backdrop-blur-xl border border-white/10 shadow-xl">
          <div className="space-y-3">
            {/* Show rows input */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/50">Show rows</label>
              <input
                type="number"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="All"
                min="1"
                className="w-full px-3 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/30 focus:outline-none focus:border-lavender"
              />
            </div>

            {/* Starting at row input */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/50">Starting at row</label>
              <input
                type="number"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="1"
                min="1"
                max={totalRows}
                className="w-full px-3 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/30 focus:outline-none focus:border-lavender"
              />
            </div>

            {/* Stats */}
            {isFiltered && (
              <div className="text-xs text-white/40 py-1">
                Displaying rows {rowDisplayStart + 1} - {Math.min(rowDisplayStart + displayedRows, totalRows)} of {totalRows}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleReset}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Show All
              </button>
              <button
                onClick={handleApply}
                className="flex-1 px-3 py-1.5 text-sm rounded-md bg-lavender/20 text-lavender hover:bg-lavender/30 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
