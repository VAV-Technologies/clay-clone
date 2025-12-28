'use client';

import { useState, useEffect } from 'react';
import { X, Folder, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewItemModalProps {
  type: 'folder' | 'table' | null;
  isOpen: boolean;
  onClose: () => void;
  onCreate: (type: 'folder' | 'table', name: string) => void;
}

export function NewItemModal({ type, isOpen, onClose, onCreate }: NewItemModalProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
    }
  }, [isOpen]);

  if (!isOpen || !type) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate(type, name.trim());
      setName('');
      onClose();
    }
  };

  const isFolder = type === 'folder';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-midnight-100/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-lg',
              isFolder ? 'bg-amber-500/20' : 'bg-lavender/20'
            )}>
              {isFolder ? (
                <Folder className="w-5 h-5 text-amber-400" />
              ) : (
                <FileSpreadsheet className="w-5 h-5 text-lavender" />
              )}
            </div>
            <h2 className="text-lg font-semibold text-white">
              New {isFolder ? 'Folder' : 'Table'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label className="block text-sm text-white/70 mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isFolder ? 'My Folder' : 'My Table'}
              autoFocus
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10
                         text-white placeholder:text-white/30
                         focus:border-lavender focus:outline-none focus:ring-2 focus:ring-lavender/20"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-lg bg-white/10 text-white
                         hover:bg-white/15 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 px-4 py-3 rounded-lg bg-lavender text-midnight font-medium
                         hover:bg-lavender/90 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
