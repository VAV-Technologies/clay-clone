'use client';

import { useState, useRef, useEffect } from 'react';
import { Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';

type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than';

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: 'is equal to',
  not_equals: 'is not equal to',
  contains: 'contains',
  not_contains: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: 'is greater than',
  less_than: 'is less than',
};

const OPERATORS: FilterOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
];

interface ColumnFilterDropdownProps {
  columnId: string;
  columnName: string;
  hasActiveFilter: boolean;
}

export function ColumnFilterDropdown({
  columnId,
  columnName,
  hasActiveFilter,
}: ColumnFilterDropdownProps) {
  const { addFilter, removeFilter, filters } = useTableStore();

  const [isOpen, setIsOpen] = useState(false);
  const [operator, setOperator] = useState<FilterOperator>('equals');
  const [value, setValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get current filter for this column if exists
  const currentFilter = filters.find((f) => f.columnId === columnId);

  // Sync with existing filter when opening
  useEffect(() => {
    if (isOpen && currentFilter) {
      setOperator(currentFilter.operator as FilterOperator);
      setValue(
        Array.isArray(currentFilter.value)
          ? currentFilter.value.join(' - ')
          : String(currentFilter.value || '')
      );
    }
  }, [isOpen, currentFilter]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

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

  const needsValue = !['is_empty', 'is_not_empty'].includes(operator);

  const handleApply = () => {
    if (!needsValue || value.trim()) {
      addFilter({
        columnId,
        operator,
        value: needsValue ? value.trim() : '',
      });
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    removeFilter(columnId);
    setValue('');
    setOperator('equals');
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
      {/* Filter Icon Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={cn(
          'p-1 rounded transition-colors',
          hasActiveFilter
            ? 'text-lavender'
            : 'text-white/40 opacity-0 group-hover:opacity-100 hover:text-white/70'
        )}
        title="Filter column"
      >
        <Filter className="w-3.5 h-3.5" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-2 z-50 w-72 rounded-xl bg-midnight-100/95 backdrop-blur-xl border border-white/10 shadow-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">
                Filter &quot;{columnName}&quot;
              </span>
              {hasActiveFilter && (
                <button
                  onClick={handleClear}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Operator Selection */}
            <div>
              <label className="block text-xs text-white/50 mb-2">Condition</label>
              <select
                value={operator}
                onChange={(e) => setOperator(e.target.value as FilterOperator)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-lavender focus:outline-none appearance-none cursor-pointer"
                style={{ backgroundImage: 'none' }}
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op} className="bg-midnight-100 text-white">
                    {OPERATOR_LABELS[op]}
                  </option>
                ))}
              </select>
            </div>

            {/* Value Input (conditional) */}
            {needsValue && (
              <div>
                <label className="block text-xs text-white/50 mb-2">Value</label>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter value..."
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:border-lavender focus:outline-none"
                />
              </div>
            )}

            {/* Apply Button */}
            <button
              onClick={handleApply}
              disabled={needsValue && !value.trim()}
              className={cn(
                'w-full py-2 rounded-lg text-sm font-medium transition-colors',
                'bg-lavender text-midnight hover:bg-lavender/90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              Apply Filter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
