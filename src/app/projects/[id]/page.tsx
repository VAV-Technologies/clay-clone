'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Plus, FileSpreadsheet, MoreHorizontal, Trash2, ArrowLeft, Pencil, FolderInput, ChevronRight, Folder } from 'lucide-react';
import {
  GlassButton,
  GlassInput,
  Modal,
  ToastProvider,
  useToast,
} from '@/components/ui';
import { MovePickerModal, type MovePickerTarget } from '@/components/sidebar/MovePickerModal';
import type { ProjectWithChildren } from '@/stores/projectStore';

// Dynamically import AnimatedBackground to avoid hydration issues
const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

interface FolderHeader {
  id: string;
  name: string;
  type: 'folder' | 'workbook' | 'table';
}

interface ChildRow {
  id: string;
  name: string;
  type: 'folder' | 'workbook' | 'table';
  parentId: string | null;
  updatedAt: string | Date;
}

type CreateKind = 'folder' | 'workbook';

function ProjectContent() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const folderId = params.id as string;

  const [folder, setFolder] = useState<FolderHeader | null>(null);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectWithChildren[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<ChildRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Move picker state (uses shared MovePickerModal)
  const [movePickerTarget, setMovePickerTarget] = useState<MovePickerTarget | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<ChildRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) {
        setIsLoading(false);
        return;
      }
      const tree: ProjectWithChildren[] = await response.json();
      setAllProjects(tree);

      const node = findInTree(tree, folderId);
      if (!node) {
        setFolder(null);
        setChildren([]);
      } else {
        setFolder({ id: node.id, name: node.name, type: node.type as FolderHeader['type'] });
        const rows = (node.children ?? [])
          .filter((c) => c.type === 'folder' || c.type === 'workbook')
          .map<ChildRow>((c) => ({
            id: c.id,
            name: c.name,
            type: c.type as 'folder' | 'workbook',
            parentId: c.parentId ?? null,
            updatedAt: c.updatedAt,
          }));
        // Folders first, then workbooks
        rows.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setChildren(rows);
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
    } finally {
      setIsLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const handleClickOutside = () => setOpenMenuId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openMenuId]);

  const ancestors = useMemo(() => {
    if (!folder) return [];
    return getAncestorChain(allProjects, folder.id);
  }, [allProjects, folder]);

  const folderCount = children.filter((c) => c.type === 'folder').length;
  const workbookCount = children.filter((c) => c.type === 'workbook').length;

  const handleCreate = async () => {
    if (!createKind) return;
    const name = newName.trim();
    if (!name) return;

    setIsCreating(true);
    try {
      if (createKind === 'folder') {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type: 'folder', parentId: folderId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.error === 'maxDepthExceeded') {
            toast.error('Too deep', `Folders can be nested up to ${data.maxDepth} levels`);
          } else {
            toast.error('Error', 'Failed to create folder');
          }
          return;
        }
        toast.success('Folder created', `"${name}" has been created`);
        setNewName('');
        setCreateKind(null);
        fetchAll();
      } else {
        const projectRes = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type: 'workbook', parentId: folderId }),
        });
        if (!projectRes.ok) {
          toast.error('Error', 'Failed to create workbook');
          return;
        }
        const workbook = await projectRes.json();
        await fetch('/api/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: workbook.id, name: 'Sheet 1' }),
        });
        toast.success('Workbook created', `"${workbook.name}" has been created`);
        setNewName('');
        setCreateKind(null);
        router.push(`/workbook/${workbook.id}`);
      }
    } catch (error) {
      toast.error('Error', createKind === 'folder' ? 'Failed to create folder' : 'Failed to create workbook');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;

    const target = deleteTarget;
    setIsDeleting(true);

    setChildren((prev) => prev.filter((c) => c.id !== target.id));

    try {
      const response = await fetch(`/api/projects/${target.id}`, { method: 'DELETE' });

      if (response.ok) {
        toast.success(
          target.type === 'folder' ? 'Folder deleted' : 'Workbook deleted',
          `"${target.name}" has been deleted`
        );
        setDeleteTarget(null);
        fetchAll();
      } else {
        setChildren((prev) => [...prev, target]);
        const data = await response.json().catch(() => ({}));
        toast.error('Error', data.error || 'Failed to delete');
      }
    } catch (error) {
      setChildren((prev) => [...prev, target]);
      toast.error('Error', 'Failed to delete');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    setIsRenaming(true);
    try {
      const response = await fetch(`/api/projects/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      if (response.ok) {
        toast.success('Renamed', `Renamed to "${trimmed}"`);
        setRenameTarget(null);
        fetchAll();
      } else {
        toast.error('Error', 'Failed to rename');
      }
    } catch (error) {
      toast.error('Error', 'Failed to rename');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleMoveSubmit = async (destinationId: string | null) => {
    if (!movePickerTarget || movePickerTarget.kind !== 'project') {
      setMovePickerTarget(null);
      return;
    }
    if (destinationId === movePickerTarget.currentParentId) {
      setMovePickerTarget(null);
      return;
    }
    try {
      const response = await fetch(`/api/projects/${movePickerTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: destinationId }),
      });
      if (response.ok) {
        toast.success(destinationId ? 'Moved to folder' : 'Moved to root');
        fetchAll();
      } else {
        const data = await response.json().catch(() => ({}));
        if (data.error === 'maxDepthExceeded') {
          toast.error('Too deep', `Folders can be nested up to ${data.maxDepth} levels`);
        } else if (data.error === 'wouldCreateCycle') {
          toast.error('Invalid move', 'A folder cannot be moved into one of its descendants');
        } else if (data.error === 'parentNotFolder') {
          toast.error('Invalid destination', 'Destination must be a folder');
        } else {
          toast.error('Error', 'Failed to move');
        }
      }
    } catch (error) {
      toast.error('Error', 'Failed to move');
    } finally {
      setMovePickerTarget(null);
    }
  };

  const openRename = (row: ChildRow) => {
    setRenameTarget(row);
    setRenameValue(row.name);
    setOpenMenuId(null);
  };

  const openMove = (row: ChildRow) => {
    setMovePickerTarget({
      kind: 'project',
      id: row.id,
      name: row.name,
      type: row.type === 'folder' ? 'folder' : 'workbook',
      currentParentId: row.parentId,
    });
    setOpenMenuId(null);
  };

  const openDelete = (row: ChildRow) => {
    setDeleteTarget(row);
    setOpenMenuId(null);
  };

  const handleOpen = (row: ChildRow) => {
    if (row.type === 'folder') {
      router.push(`/projects/${row.id}`);
    } else {
      router.push(`/workbook/${row.id}`);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen relative flex items-center justify-center">
        <AnimatedBackground />
        <div className="animate-spin w-8 h-8 border-2 border-lavender border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!folder) {
    return (
      <div className="min-h-screen relative flex items-center justify-center">
        <AnimatedBackground />
        <p className="text-white/50">Folder not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/10 bg-midnight/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-white/70 hover:text-white transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </button>
            <div className="w-px h-5 bg-white/20 shrink-0" />
            <nav className="flex items-center gap-1 text-sm text-white/50 min-w-0 overflow-hidden">
              <button
                onClick={() => router.push('/')}
                className="hover:text-white/80 transition-colors shrink-0"
              >
                Root
              </button>
              {ancestors.slice(0, -1).map((a) => (
                <span key={a.id} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />
                  <button
                    onClick={() => router.push(`/projects/${a.id}`)}
                    className="hover:text-white/80 transition-colors truncate max-w-[12rem]"
                  >
                    {a.name}
                  </button>
                </span>
              ))}
              <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />
              <h1 className="text-lg font-semibold text-white truncate">{folder.name}</h1>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content - Centered */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-8">
        {/* Action Bar */}
        <div className="flex items-center justify-between mb-6 gap-3">
          <p className="text-white/50 text-sm">
            {folderCount > 0 && `${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`}
            {folderCount > 0 && workbookCount > 0 && ' · '}
            {workbookCount > 0 && `${workbookCount} ${workbookCount === 1 ? 'workbook' : 'workbooks'}`}
            {folderCount === 0 && workbookCount === 0 && 'Empty'}
          </p>
          <div className="flex items-center gap-2">
            <GlassButton variant="ghost" onClick={() => { setNewName(''); setCreateKind('folder'); }}>
              <Folder className="w-4 h-4 mr-1" />
              New Folder
            </GlassButton>
            <GlassButton variant="primary" onClick={() => { setNewName(''); setCreateKind('workbook'); }}>
              <Plus className="w-4 h-4 mr-1" />
              New Workbook
            </GlassButton>
          </div>
        </div>

        {/* Children List - Row Layout */}
        {children.length > 0 ? (
          <div className="bg-midnight-100/60 backdrop-blur-xl border border-white/10">
            {/* Table Header */}
            <div className="flex items-center px-4 py-3 border-b border-white/10 bg-white/[0.02]">
              <div className="flex-1 text-xs font-medium text-white/40 uppercase tracking-wider">Name</div>
              <div className="w-32 text-xs font-medium text-white/40 uppercase tracking-wider hidden sm:block">Modified</div>
              <div className="w-10"></div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-white/[0.05]">
              {children.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center px-4 py-3 hover:bg-white/[0.03] transition-colors group"
                >
                  {/* Clickable content area */}
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                    onClick={() => handleOpen(row)}
                  >
                    <div className={`w-9 h-9 flex items-center justify-center flex-shrink-0 ${row.type === 'folder' ? 'bg-amber-400/15' : 'bg-lavender/20'}`}>
                      {row.type === 'folder' ? (
                        <Folder className="w-4 h-4 text-amber-300" />
                      ) : (
                        <FileSpreadsheet className="w-4 h-4 text-lavender" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-white truncate">{row.name}</h3>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0 hidden sm:block" />
                  </div>

                  {/* Modified date */}
                  <div className="w-32 text-sm text-white/40 hidden sm:block">
                    {new Date(row.updatedAt).toLocaleDateString()}
                  </div>

                  {/* Menu button */}
                  <div className="w-10 flex justify-end">
                    <button
                      type="button"
                      ref={(el) => { menuBtnRefs.current[row.id] = el; }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === row.id ? null : row.id);
                      }}
                      className="p-1.5 hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="w-4 h-4 text-white/50" />
                    </button>

                    {openMenuId === row.id && createPortal(
                      <>
                        <div
                          className="fixed inset-0 z-[99]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                          }}
                        />
                        <div
                          className="fixed z-[100] min-w-[160px] py-1 bg-midnight-100 border border-white/10 shadow-xl"
                          style={{
                            top: (menuBtnRefs.current[row.id]?.getBoundingClientRect().bottom ?? 0) + 4,
                            right: window.innerWidth - (menuBtnRefs.current[row.id]?.getBoundingClientRect().right ?? 0),
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openRename(row);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/5 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openMove(row);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/5 transition-colors"
                          >
                            <FolderInput className="w-4 h-4" />
                            Move to folder
                          </button>
                          <div className="my-1 border-t border-white/10" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openDelete(row);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      </>,
                      document.body
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-midnight-100/60 backdrop-blur-xl border border-white/10 p-12 text-center">
            <div className="w-16 h-16 bg-white/5 flex items-center justify-center mx-auto mb-4">
              <FileSpreadsheet className="w-8 h-8 text-white/20" />
            </div>
            <h3 className="text-lg font-medium text-white mb-1">
              Nothing in this folder yet
            </h3>
            <p className="text-white/50 mb-4">
              Create a sub-folder or a workbook to get started
            </p>
            <div className="flex items-center justify-center gap-2">
              <GlassButton variant="ghost" onClick={() => { setNewName(''); setCreateKind('folder'); }}>
                <Folder className="w-4 h-4 mr-1" />
                New Folder
              </GlassButton>
              <GlassButton variant="primary" onClick={() => { setNewName(''); setCreateKind('workbook'); }}>
                <Plus className="w-4 h-4 mr-1" />
                New Workbook
              </GlassButton>
            </div>
          </div>
        )}
      </main>

      {/* Create Modal — handles folder + workbook */}
      <Modal
        isOpen={!!createKind}
        onClose={() => { if (!isCreating) { setCreateKind(null); setNewName(''); } }}
        title={createKind === 'folder' ? 'Create New Folder' : 'Create New Workbook'}
      >
        <div className="space-y-4">
          <GlassInput
            label={createKind === 'folder' ? 'Folder Name' : 'Workbook Name'}
            placeholder={createKind === 'folder' ? 'e.g., Outreach, Research' : 'e.g., Leads, Contacts, Companies'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <GlassButton variant="ghost" onClick={() => { setCreateKind(null); setNewName(''); }}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleCreate}
              loading={isCreating}
              disabled={!newName.trim()}
            >
              {createKind === 'folder' ? 'Create Folder' : 'Create Workbook'}
            </GlassButton>
          </div>
        </div>
      </Modal>

      {/* Rename Modal */}
      <Modal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title={renameTarget?.type === 'folder' ? 'Rename Folder' : 'Rename Workbook'}
      >
        <div className="space-y-4">
          <GlassInput
            label="Name"
            placeholder="Enter new name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <GlassButton variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleRenameSubmit}
              loading={isRenaming}
              disabled={!renameValue.trim()}
            >
              Rename
            </GlassButton>
          </div>
        </div>
      </Modal>

      {/* Move Picker Modal (shared with dashboard) */}
      <MovePickerModal
        target={movePickerTarget}
        projects={allProjects}
        onClose={() => setMovePickerTarget(null)}
        onMove={handleMoveSubmit}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => { if (!isDeleting) setDeleteTarget(null); }}
        title={deleteTarget?.type === 'folder' ? 'Delete Folder' : 'Delete Workbook'}
      >
        <div className="space-y-4">
          <p className="text-white/70">
            {deleteTarget?.type === 'folder'
              ? <>Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? All sub-folders and workbooks inside will be permanently deleted. This action cannot be undone.</>
              : <>Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? All sheets in this workbook will be permanently deleted. This action cannot be undone.</>
            }
          </p>
          <div className="flex justify-end gap-2">
            <GlassButton variant="ghost" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleDelete}
              loading={isDeleting}
              className="!bg-red-500/20 !border-red-500/30 hover:!bg-red-500/30"
            >
              Delete
            </GlassButton>
          </div>
        </div>
      </Modal>

    </div>
  );
}

function findInTree(
  tree: ProjectWithChildren[],
  id: string
): ProjectWithChildren | null {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const found = findInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function getAncestorChain(
  tree: ProjectWithChildren[],
  id: string
): ProjectWithChildren[] {
  const path: ProjectWithChildren[] = [];
  const walk = (nodes: ProjectWithChildren[]): boolean => {
    for (const node of nodes) {
      path.push(node);
      if (node.id === id) return true;
      if (node.children?.length && walk(node.children)) return true;
      path.pop();
    }
    return false;
  };
  walk(tree);
  return path;
}

export default function ProjectPage() {
  return (
    <ToastProvider>
      <ProjectContent />
    </ToastProvider>
  );
}
