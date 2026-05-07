'use client';

import { useState } from 'react';
import { Filter, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FilterOperator } from '@/lib/filter-utils';

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'is_empty', label: 'Is Empty' },
  { value: 'is_not_empty', label: 'Is Not Empty' },
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Not Contains' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
];

const NO_VALUE_OPERATORS: FilterOperator[] = ['is_empty', 'is_not_empty'];

interface Column {
  id: string;
  name: string;
  type: string;
}

interface ConditionSectionProps {
  columns: Column[];
  columnId: string;
  operator: FilterOperator;
  value: string;
  onColumnChange: (id: string) => void;
  onOperatorChange: (op: FilterOperator) => void;
  onValueChange: (val: string) => void;
  onClear: () => void;
  matchCount: number;
  totalCount: number;
}

export function ConditionSection({
  columns,
  columnId,
  operator,
  value,
  onColumnChange,
  onOperatorChange,
  onValueChange,
  onClear,
  matchCount,
  totalCount,
}: ConditionSectionProps) {
  const [open, setOpen] = useState(false);
  const hasCondition = !!columnId;
  const needsValue = !NO_VALUE_OPERATORS.includes(operator);

  const selectClasses = 'w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-lavender appearance-none bg-[length:16px_16px] bg-[position:right_0.5rem_center] bg-no-repeat bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2716%27%20height%3D%2716%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27rgba(255%2C255%2C255%2C0.4)%27%20stroke-width%3D%272%27%3E%3Cpath%20d%3D%27M6%209l6%206%206-6%27/%3E%3C/svg%3E")]';

  return (
    <div className="border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.03] hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-white/40" />
          <span className="text-sm font-medium text-white/70">Run Condition</span>
        </div>
        <div className="flex items-center gap-2">
          {hasCondition && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400">
              {matchCount.toLocaleString()} / {totalCount.toLocaleString()}
            </span>
          )}
          <ChevronDown className={cn('w-4 h-4 text-white/40 transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <div className="p-3 space-y-3 border-t border-white/10">
          <p className="text-xs text-white/40">Only process rows matching this condition. Leave empty to process all rows.</p>

          {/* Column */}
          <div>
            <label className="text-xs text-white/50 mb-1 block">Column</label>
            <select
              value={columnId}
              onChange={(e) => onColumnChange(e.target.value)}
              className={selectClasses}
            >
              <option value="">No condition (run all)</option>
              {columns.filter(c => c.type !== 'enrichment').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Operator */}
          {hasCondition && (
            <div>
              <label className="text-xs text-white/50 mb-1 block">Operator</label>
              <select
                value={operator}
                onChange={(e) => onOperatorChange(e.target.value as FilterOperator)}
                className={selectClasses}
              >
                {OPERATORS.map(op => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Value */}
          {hasCondition && needsValue && (
            <div>
              <label className="text-xs text-white/50 mb-1 block">Value</label>
              <input
                type="text"
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                placeholder="Enter value..."
                className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-lavender"
              />
            </div>
          )}

          {/* Match count + clear */}
          {hasCondition && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-amber-400">
                {matchCount.toLocaleString()} of {totalCount.toLocaleString()} rows match
              </span>
              <button
                type="button"
                onClick={onClear}
                className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
