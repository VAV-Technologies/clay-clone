'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';
import { useToast } from '@/components/ui';

export function SheetTabs() {
  const toast = useToast();
  const { sheets, activeSheetId, switchSheet, addSheet, renameSheet, deleteSheet } = useTableStore();
  const [contextMenu, setContextMenu] = useState<{ sheetId: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const handleAddSheet = () => {
    addSheet(`Sheet ${sheets.length + 1}`);
  };

  const handleContextMenu = (e: React.MouseEvent, sheetId: string) => {
    e.preventDefault();
    setContextMenu({ sheetId, x: e.clientX, y: e.clientY });
  };

  const handleStartRename = (sheetId: string) => {
    const sheet = sheets.find(s => s.id === sheetId);
    if (!sheet) return;
    setRenaming(sheetId);
    setRenameValue(sheet.name);
    setContextMenu(null);
  };

  const handleFinishRename = () => {
    if (renaming && renameValue.trim()) {
      renameSheet(renaming, renameValue.trim());
    }
    setRenaming(null);
  };

  const handleDelete = async (sheetId: string) => {
    setContextMenu(null);
    try {
      await deleteSheet(sheetId);
    } catch (err) {
      if (err instanceof Error && err.message === 'LAST_SHEET') {
        toast.error(
          "Can't delete the last sheet",
          'Delete the workbook from the folder view instead.'
        );
      } else {
        toast.error('Error', 'Failed to delete sheet');
      }
    }
  };

  return (
    <div className="flex-shrink-0 flex items-stretch border border-white/10 bg-midnight-100/60 backdrop-blur-xl shadow-2xl overflow-hidden">
      {sheets.map((sheet) => {
        const isActive = activeSheetId === sheet.id;

        return (
          <button
            key={sheet.id}
            onClick={() => switchSheet(sheet.id)}
            onContextMenu={(e) => handleContextMenu(e, sheet.id)}
            onDoubleClick={() => handleStartRename(sheet.id)}
            className={cn(
              'relative flex items-center h-11 px-5 text-sm transition-colors whitespace-nowrap',
              // Right divider between tabs
              'border-r border-white/[0.08]',
              // Active/inactive states
              isActive
                ? 'bg-white/[0.06] text-white'
                : 'bg-transparent text-white/50 hover:text-white/70 hover:bg-white/[0.03]'
            )}
          >
            {/* Active indicator — lavender bar at top */}
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-lavender" />
            )}

            {renaming === sheet.id ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFinishRename();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                className="bg-transparent border-none outline-none text-sm text-white w-24"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              sheet.name
            )}
          </button>
        );
      })}

      {/* Add sheet button — square, flush */}
      <button
        onClick={handleAddSheet}
        className="flex items-center justify-center w-11 h-11 text-white/40 hover:text-white hover:bg-white/[0.03] transition-colors border-r border-white/[0.08]"
        title="Add sheet"
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Empty fill — takes remaining space, carries bottom-right radius */}
      <div className="flex-1" />

      {/* Context menu */}
      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[100] min-w-[140px] py-1 bg-midnight-100 border border-white/10 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y - 80 }}
          >
            <button
              onClick={() => handleStartRename(contextMenu.sheetId)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Rename
            </button>
            <button
              onClick={() => handleDelete(contextMenu.sheetId)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
