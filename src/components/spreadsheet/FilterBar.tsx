'use client';

import { X, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';

const OPERATOR_LABELS: Record<string, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  not_contains: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: 'greater than',
  less_than: 'less than',
  between: 'between',
};

export function FilterBar() {
  const { filters, columns, removeFilter, clearFilters } = useTableStore();

  if (filters.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-midnight-100/50 border-b border-white/10">
      <Filter className="w-4 h-4 text-white/40" />
      <span className="text-sm text-white/50">Filters:</span>

      <div className="flex items-center gap-2 flex-wrap">
        {filters.map((filter) => {
          const column = columns.find((c) => c.id === filter.columnId);
          if (!column) return null;

          return (
            <div
              key={filter.columnId}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-lg',
                'bg-lavender/10 border border-lavender/20',
                'text-sm text-white/80'
              )}
            >
              <span className="font-medium">{column.name}</span>
              <span className="text-white/50">{OPERATOR_LABELS[filter.operator]}</span>
              {filter.value && !['is_empty', 'is_not_empty'].includes(filter.operator) && (
                <span className="text-lavender">
                  {Array.isArray(filter.value)
                    ? filter.value.join(' - ')
                    : filter.value}
                </span>
              )}
              <button
                onClick={() => removeFilter(filter.columnId)}
                className="ml-1 p-0.5 hover:bg-white/10 rounded transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      <GlassButton
        variant="ghost"
        size="xs"
        onClick={clearFilters}
        className="ml-auto"
      >
        Clear all
      </GlassButton>
    </div>
  );
}
