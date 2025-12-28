'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Check } from 'lucide-react';
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

interface FilterRowState {
  id: string;
  columnId: string;
  operator: FilterOperator;
  value: string;
  isApplied: boolean;
}

export function FilterBar() {
  const {
    filters,
    filterLogic,
    columns,
    showFilters,
    addFilter,
    removeFilter,
    clearFilters,
    toggleFilterLogic,
    setShowFilters,
  } = useTableStore();

  const [filterRows, setFilterRows] = useState<FilterRowState[]>([]);

  const filterableColumns = columns.filter((col) => col.type !== 'enrichment');

  // Sync with store filters when component mounts or filters change
  useEffect(() => {
    if (filters.length > 0) {
      const storeRows = filters.map((f) => ({
        id: f.columnId,
        columnId: f.columnId,
        operator: f.operator as FilterOperator,
        value: Array.isArray(f.value) ? f.value.join(' - ') : String(f.value || ''),
        isApplied: true,
      }));
      setFilterRows(storeRows);
    }
  }, []);

  // When showFilters becomes true and no rows exist, add an empty row
  useEffect(() => {
    if (showFilters && filterRows.length === 0) {
      addNewFilterRow();
    }
  }, [showFilters]);

  const addNewFilterRow = () => {
    const newId = `filter-${Date.now()}`;
    setFilterRows((rows) => [
      ...rows,
      {
        id: newId,
        columnId: filterableColumns[0]?.id || '',
        operator: 'equals' as FilterOperator,
        value: '',
        isApplied: false,
      },
    ]);
  };

  const updateFilterRow = (
    id: string,
    field: 'columnId' | 'operator' | 'value',
    newValue: string
  ) => {
    setFilterRows((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, [field]: newValue, isApplied: false } : row
      )
    );
  };

  const removeFilterRow = (id: string) => {
    const row = filterRows.find((r) => r.id === id);
    if (row && row.isApplied) {
      removeFilter(row.columnId);
    }
    const newRows = filterRows.filter((r) => r.id !== id);
    setFilterRows(newRows);

    // If no rows left, hide filter bar
    if (newRows.length === 0) {
      setShowFilters(false);
    }
  };

  const applyFilter = (row: FilterRowState) => {
    if (!row.columnId) return;

    const needsValue = !['is_empty', 'is_not_empty'].includes(row.operator);
    if (needsValue && !row.value.trim()) return;

    addFilter({
      columnId: row.columnId,
      operator: row.operator,
      value: needsValue ? row.value.trim() : '',
    });

    // Mark as applied
    setFilterRows((rows) =>
      rows.map((r) => (r.id === row.id ? { ...r, isApplied: true } : r))
    );
  };

  const handleClearAll = () => {
    clearFilters();
    setFilterRows([]);
    setShowFilters(false);
  };

  // Don't render if not showing filters and no filter rows
  if (!showFilters && filterRows.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-white/10 bg-white/[0.02]">
      <div className="p-3 space-y-2">
        {filterRows.map((row, index) => {
          const needsValue = !['is_empty', 'is_not_empty'].includes(row.operator);

          return (
            <div key={row.id} className="flex items-center gap-2">
              {/* First row: "Where" label, Other rows: AND/OR toggle */}
              {index === 0 ? (
                <span className="w-16 text-sm text-white/50 flex-shrink-0">Where</span>
              ) : (
                <button
                  onClick={toggleFilterLogic}
                  className={cn(
                    'w-16 px-2 py-1 rounded text-xs font-medium transition-colors flex-shrink-0 text-center',
                    'bg-lavender/20 text-lavender border border-lavender/30',
                    'hover:bg-lavender/30'
                  )}
                >
                  {filterLogic}
                </button>
              )}

              {/* Column Selector */}
              <select
                value={row.columnId}
                onChange={(e) => {
                  updateFilterRow(row.id, 'columnId', e.target.value);
                }}
                className="w-44 pl-3 pr-10 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-lavender focus:outline-none cursor-pointer flex-shrink-0"
              >
                <option value="" className="bg-midnight-100 text-white/50">
                  Select column
                </option>
                {filterableColumns.map((col) => (
                  <option key={col.id} value={col.id} className="bg-midnight-100 text-white">
                    {col.name}
                  </option>
                ))}
              </select>

              {/* Operator Selector */}
              <select
                value={row.operator}
                onChange={(e) => {
                  updateFilterRow(row.id, 'operator', e.target.value);
                }}
                className="w-48 pl-3 pr-10 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-lavender focus:outline-none cursor-pointer flex-shrink-0"
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op} className="bg-midnight-100 text-white">
                    {OPERATOR_LABELS[op]}
                  </option>
                ))}
              </select>

              {/* Value Input (if needed) */}
              {needsValue ? (
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateFilterRow(row.id, 'value', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      applyFilter(row);
                    }
                  }}
                  placeholder="Enter value..."
                  className={cn(
                    'flex-1 min-w-[120px] px-3 py-1.5 rounded-lg bg-white/5 border text-white text-sm placeholder:text-white/30 focus:border-lavender focus:outline-none',
                    row.isApplied ? 'border-lavender/30' : 'border-white/10'
                  )}
                />
              ) : (
                <div className="flex-1 min-w-[120px]" />
              )}

              {/* Apply Filter Button */}
              {!row.isApplied && (
                <button
                  onClick={() => applyFilter(row)}
                  disabled={needsValue && !row.value.trim()}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0',
                    'bg-lavender text-midnight hover:bg-lavender/90',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply</span>
                </button>
              )}

              {/* Applied indicator */}
              {row.isApplied && (
                <span className="px-2 py-1 rounded text-xs text-lavender bg-lavender/10 flex-shrink-0">
                  Applied
                </span>
              )}

              {/* Remove Button */}
              <button
                onClick={() => removeFilterRow(row.id)}
                className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}

        {/* Add Filter & Clear All Row */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={addNewFilterRow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-lavender hover:bg-lavender/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add filter</span>
          </button>

          {filters.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear all</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
