'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTableStore } from '@/stores/tableStore';

export function SheetTabs() {
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
    const nextNum = sheets.length + 1;
    addSheet(`Sheet ${nextNum}`);
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

  const handleDelete = (sheetId: string) => {
    setContextMenu(null);
    if (sheets.length <= 1) return;
    deleteSheet(sheetId);
  };

  return (
    <div className="flex-shrink-0 flex items-center h-9 border-t border-white/10 bg-midnight-100/80 px-1 gap-0.5 overflow-x-auto">
      {sheets.map((sheet) => (
        <button
          key={sheet.id}
          onClick={() => switchSheet(sheet.id)}
          onContextMenu={(e) => handleContextMenu(e, sheet.id)}
          onDoubleClick={() => handleStartRename(sheet.id)}
          className={cn(
            'flex items-center h-7 px-3 text-xs rounded-t-md border-t-2 transition-colors whitespace-nowrap min-w-0',
            activeSheetId === sheet.id
              ? 'bg-lavender/10 border-t-lavender text-white'
              : 'bg-white/[0.03] border-t-transparent text-white/50 hover:text-white/70 hover:bg-white/[0.05]'
          )}
        >
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
              className="bg-transparent border-none outline-none text-xs text-white w-20"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            sheet.name
          )}
        </button>
      ))}

      {/* Add sheet button */}
      <button
        onClick={handleAddSheet}
        className="flex items-center justify-center w-7 h-7 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors flex-shrink-0"
        title="Add sheet"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      {/* Context menu */}
      {contextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[100] min-w-[140px] py-1 bg-midnight-100 border border-white/10 rounded-lg shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y - 80 }}
          >
            <button
              onClick={() => handleStartRename(contextMenu.sheetId)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Rename
            </button>
            {sheets.length > 1 && (
              <button
                onClick={() => handleDelete(contextMenu.sheetId)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
