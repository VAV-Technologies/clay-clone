'use client';

import { Filter, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';

export function AddFilterButton() {
  const { showFilters, filters, setShowFilters } = useTableStore();

  const isActive = showFilters || filters.length > 0;

  const handleClick = () => {
    setShowFilters(true);
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors',
        'hover:bg-white/10',
        isActive ? 'text-lavender' : 'text-white/50'
      )}
    >
      <Filter className="w-3.5 h-3.5" />
      <span>Filter</span>
      {filters.length > 0 && (
        <span className="px-1.5 py-0.5 rounded-full bg-lavender/20 text-xs text-lavender">
          {filters.length}
        </span>
      )}
    </button>
  );
}
