'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Trash2,
  Edit2,
  Type,
  Hash,
  Mail,
  Link,
  Calendar,
  Sparkles,
  GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dropdown } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import type { Column } from '@/lib/db/schema';

interface ColumnHeaderProps {
  column: Column;
}

const TYPE_ICONS = {
  text: Type,
  number: Hash,
  email: Mail,
  url: Link,
  date: Calendar,
  enrichment: Sparkles,
};

export function ColumnHeader({ column }: ColumnHeaderProps) {
  const {
    sortColumn,
    sortDirection,
    filters,
    updateColumn,
    deleteColumn,
    setSort,
    addFilter,
  } = useTableStore();

  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(column.name);
  const [isResizing, setIsResizing] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSorted = sortColumn === column.id;
  const hasFilter = filters.some((f) => f.columnId === column.id);
  const TypeIcon = TYPE_ICONS[column.type as keyof typeof TYPE_ICONS] || Type;

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const handleRename = async () => {
    if (newName.trim() && newName !== column.name) {
      updateColumn(column.id, { name: newName.trim() });

      try {
        await fetch(`/api/columns/${column.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        });
      } catch (error) {
        console.error('Failed to rename column:', error);
      }
    }
    setIsRenaming(false);
  };

  const handleDelete = async () => {
    deleteColumn(column.id);

    try {
      await fetch(`/api/columns/${column.id}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Failed to delete column:', error);
    }
  };

  const handleChangeType = async (type: string) => {
    updateColumn(column.id, { type: type as Column['type'] });

    try {
      await fetch(`/api/columns/${column.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
    } catch (error) {
      console.error('Failed to change column type:', error);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    setStartX(e.clientX);
    setStartWidth(column.width || 150);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(80, startWidth + diff);
      updateColumn(column.id, { width: newWidth });
    };

    const handleMouseUp = async () => {
      setIsResizing(false);

      // Persist width
      try {
        await fetch(`/api/columns/${column.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ width: column.width }),
        });
      } catch (error) {
        console.error('Failed to save column width:', error);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, startX, startWidth, column.id, column.width, updateColumn]);

  const menuItems = [
    {
      label: 'Rename',
      icon: <Edit2 className="w-4 h-4" />,
      onClick: () => setIsRenaming(true),
    },
    {
      label: 'Sort Ascending',
      icon: <ArrowUp className="w-4 h-4" />,
      onClick: () => setSort(column.id, 'asc'),
    },
    {
      label: 'Sort Descending',
      icon: <ArrowDown className="w-4 h-4" />,
      onClick: () => setSort(column.id, 'desc'),
    },
    {
      label: 'Filter',
      icon: <Filter className="w-4 h-4" />,
      onClick: () =>
        addFilter({ columnId: column.id, operator: 'is_not_empty', value: '' }),
    },
    { divider: true, label: '', onClick: () => {} },
    {
      label: 'Text',
      icon: <Type className="w-4 h-4" />,
      onClick: () => handleChangeType('text'),
    },
    {
      label: 'Number',
      icon: <Hash className="w-4 h-4" />,
      onClick: () => handleChangeType('number'),
    },
    {
      label: 'Email',
      icon: <Mail className="w-4 h-4" />,
      onClick: () => handleChangeType('email'),
    },
    {
      label: 'URL',
      icon: <Link className="w-4 h-4" />,
      onClick: () => handleChangeType('url'),
    },
    {
      label: 'Date',
      icon: <Calendar className="w-4 h-4" />,
      onClick: () => handleChangeType('date'),
    },
    { divider: true, label: '', onClick: () => {} },
    {
      label: 'Delete Column',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: handleDelete,
      danger: true,
    },
  ];

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 px-3 border-r border-white/10',
        'text-sm font-medium text-white/70',
        'group select-none'
      )}
      style={{ width: column.width || 150 }}
    >
      {/* Drag handle */}
      <GripVertical className="w-3 h-3 text-white/20 opacity-0 group-hover:opacity-100 cursor-grab" />

      {/* Type icon */}
      <TypeIcon className="w-3.5 h-3.5 text-white/40" />

      {/* Name */}
      {isRenaming ? (
        <input
          ref={inputRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename();
            if (e.key === 'Escape') setIsRenaming(false);
          }}
          onBlur={handleRename}
          className="flex-1 bg-white/10 border border-lavender/50 rounded px-1 text-sm outline-none"
        />
      ) : (
        <Dropdown trigger={<span className="flex-1 truncate cursor-pointer">{column.name}</span>} items={menuItems} />
      )}

      {/* Sort indicator */}
      {isSorted && (
        <span className="text-lavender">
          {sortDirection === 'asc' ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )}
        </span>
      )}

      {/* Filter indicator */}
      {hasFilter && <Filter className="w-3 h-3 text-lavender" />}

      {/* Resize handle */}
      <div
        className={cn(
          'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize',
          'hover:bg-lavender/50 transition-colors',
          isResizing && 'bg-lavender'
        )}
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
