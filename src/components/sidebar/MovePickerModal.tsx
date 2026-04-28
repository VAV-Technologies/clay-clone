'use client';

import { useMemo } from 'react';
import { Folder, FileSpreadsheet, Home, Check } from 'lucide-react';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ProjectWithChildren } from '@/stores/projectStore';

export type MovePickerTarget =
  | { kind: 'project'; id: string; name: string; type: 'folder' | 'workbook'; currentParentId: string | null }
  | { kind: 'sheet'; id: string; name: string; currentProjectId: string };

interface MovePickerModalProps {
  target: MovePickerTarget | null;
  projects: ProjectWithChildren[];
  onClose: () => void;
  onMove: (destinationId: string | null) => void;
}

interface Destination {
  id: string | null;
  label: string;
  path: string;
  icon: 'root' | 'folder' | 'workbook';
  isCurrent: boolean;
}

export function MovePickerModal({ target, projects, onClose, onMove }: MovePickerModalProps) {
  const destinations = useMemo<Destination[]>(() => {
    if (!target) return [];

    if (target.kind === 'project') {
      const blocked = collectSubtreeIds(projects, target.id);
      const folders = flattenFolders(projects, blocked);
      const root: Destination = {
        id: null,
        label: 'Root (no folder)',
        path: '',
        icon: 'root',
        isCurrent: target.currentParentId === null,
      };
      return [
        root,
        ...folders.map((f) => ({
          id: f.id,
          label: f.name,
          path: f.path,
          icon: 'folder' as const,
          isCurrent: f.id === target.currentParentId,
        })),
      ];
    }

    return flattenWorkbooks(projects).map((w) => ({
      id: w.id,
      label: w.name,
      path: w.path,
      icon: 'workbook' as const,
      isCurrent: w.id === target.currentProjectId,
    }));
  }, [projects, target]);

  if (!target) return null;

  const title =
    target.kind === 'project'
      ? `Move "${target.name}" to…`
      : `Move sheet "${target.name}" to…`;

  const emptyMessage =
    target.kind === 'project'
      ? target.type === 'folder'
        ? 'No other folders available. Create a folder first, or move to root.'
        : 'No folders available. Create a folder first, or keep at root.'
      : 'No other workbooks available. Create a workbook first.';

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      {destinations.length === 0 ? (
        <p className="text-sm text-white/60 py-6 text-center">{emptyMessage}</p>
      ) : (
        <div className="max-h-80 overflow-y-auto -mx-1">
          {destinations.map((dest) => (
            <button
              key={dest.id ?? '__root__'}
              disabled={dest.isCurrent}
              onClick={() => onMove(dest.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                'transition-colors duration-150',
                dest.isCurrent
                  ? 'text-white/40 cursor-not-allowed bg-white/5'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
              )}
            >
              {dest.icon === 'root' ? (
                <Home className="w-4 h-4 text-white/50 shrink-0" />
              ) : dest.icon === 'folder' ? (
                <Folder className="w-4 h-4 text-lavender/70 shrink-0" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 text-lavender shrink-0" />
              )}
              <span className="flex-1 truncate text-sm">
                {dest.path && (
                  <span className="text-white/40">{dest.path} / </span>
                )}
                {dest.label}
              </span>
              {dest.isCurrent && (
                <span className="flex items-center gap-1 text-xs text-white/40">
                  <Check className="w-3 h-3" /> current
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function collectSubtreeIds(
  projects: ProjectWithChildren[],
  rootId: string
): Set<string> {
  const ids = new Set<string>();
  const walk = (list: ProjectWithChildren[], includeAll: boolean) => {
    for (const p of list) {
      if (includeAll || p.id === rootId) {
        ids.add(p.id);
        if (p.children) walk(p.children, true);
      } else if (p.children) {
        walk(p.children, false);
      }
    }
  };
  walk(projects, false);
  return ids;
}

function flattenFolders(
  projects: ProjectWithChildren[],
  blocked: Set<string>,
  pathParts: string[] = []
): { id: string; name: string; path: string }[] {
  const out: { id: string; name: string; path: string }[] = [];
  for (const p of projects) {
    if (p.type === 'folder' && !blocked.has(p.id)) {
      out.push({ id: p.id, name: p.name, path: pathParts.join(' / ') });
    }
    if (p.children?.length) {
      const nextParts = p.type === 'folder' ? [...pathParts, p.name] : pathParts;
      out.push(...flattenFolders(p.children, blocked, nextParts));
    }
  }
  return out;
}

function flattenWorkbooks(
  projects: ProjectWithChildren[],
  pathParts: string[] = []
): { id: string; name: string; path: string }[] {
  const out: { id: string; name: string; path: string }[] = [];
  for (const p of projects) {
    if (p.type === 'workbook') {
      out.push({ id: p.id, name: p.name, path: pathParts.join(' / ') });
    }
    if (p.children?.length) {
      const nextParts = p.type === 'folder' ? [...pathParts, p.name] : pathParts;
      out.push(...flattenWorkbooks(p.children, nextParts));
    }
  }
  return out;
}
