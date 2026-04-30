'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Plus, FileSpreadsheet, MoreHorizontal, Trash2, ArrowLeft, Pencil, FolderInput, ChevronRight } from 'lucide-react';
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

interface WorkbookRow {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: string | Date;
}

function ProjectContent() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const folderId = params.id as string;

  const [folder, setFolder] = useState<FolderHeader | null>(null);
  const [workbooks, setWorkbooks] = useState<WorkbookRow[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectWithChildren[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWorkbookName, setNewWorkbookName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<WorkbookRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Move picker state (uses shared MovePickerModal)
  const [movePickerTarget, setMovePickerTarget] = useState<MovePickerTarget | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<WorkbookRow | null>(null);

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
        setWorkbooks([]);
      } else {
        setFolder({ id: node.id, name: node.name, type: node.type as FolderHeader['type'] });
        const children = (node.children ?? [])
          .filter((c) => c.type === 'workbook')
          .map<WorkbookRow>((c) => ({
            id: c.id,
            name: c.name,
            parentId: c.parentId ?? null,
            updatedAt: c.updatedAt,
          }));
        setWorkbooks(children);
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

  const handleCreateWorkbook = async () => {
    if (!newWorkbookName.trim()) return;

    setIsCreating(true);
    try {
      const projectRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newWorkbookName.trim(),
          type: 'workbook',
          parentId: folderId,
        }),
      });

      if (!projectRes.ok) {
        toast.error('Error', 'Failed to create workbook');
        return;
      }

      const workbook = await projectRes.json();

      // Create the first sheet inside the workbook
      await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: workbook.id, name: 'Sheet 1' }),
      });

      toast.success('Workbook created', `"${workbook.name}" has been created`);
      setNewWorkbookName('');
      setIsCreateModalOpen(false);
      router.push(`/workbook/${workbook.id}`);
    } catch (error) {
      toast.error('Error', 'Failed to create workbook');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteWorkbook = async () => {
    if (!deleteTarget) return;

    try {
      const response = await fetch(`/api/projects/${deleteTarget.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success('Workbook deleted', `"${deleteTarget.name}" has been deleted`);
        setDeleteTarget(null);
        fetchAll();
      } else {
        const data = await response.json().catch(() => ({}));
        toast.error('Error', data.error || 'Failed to delete workbook');
      }
    } catch (error) {
      toast.error('Error', 'Failed to delete workbook');
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
        toast.success('Workbook renamed', `Renamed to "${trimmed}"`);
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
        // Refetch — workbook may now live elsewhere
        fetchAll();
      } else {
        toast.error('Error', 'Failed to move');
      }
    } catch (error) {
      toast.error('Error', 'Failed to move');
    } finally {
      setMovePickerTarget(null);
    }
  };

  const openRename = (workbook: WorkbookRow) => {
    setRenameTarget(workbook);
    setRenameValue(workbook.name);
    setOpenMenuId(null);
  };

  const openMove = (workbook: WorkbookRow) => {
    setMovePickerTarget({
      kind: 'project',
      id: workbook.id,
      name: workbook.name,
      type: 'workbook',
      currentParentId: workbook.parentId,
    });
    setOpenMenuId(null);
  };

  const openDelete = (workbook: WorkbookRow) => {
    setDeleteTarget(workbook);
    setOpenMenuId(null);
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
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </button>
            <div className="w-px h-5 bg-white/20" />
            <h1 className="text-lg font-semibold text-white">{folder.name}</h1>
          </div>
        </div>
      </header>

      {/* Main Content - Centered */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-8">
        {/* Action Bar */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-white/50">
            {workbooks.length} {workbooks.length === 1 ? 'workbook' : 'workbooks'}
          </p>
          <GlassButton variant="primary" onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            New Workbook
          </GlassButton>
        </div>

        {/* Workbooks List - Row Layout */}
        {workbooks.length > 0 ? (
          <div className="bg-midnight-100/60 backdrop-blur-xl border border-white/10 rounded-xl">
            {/* Table Header */}
            <div className="flex items-center px-4 py-3 border-b border-white/10 bg-white/[0.02] rounded-t-xl">
              <div className="flex-1 text-xs font-medium text-white/40 uppercase tracking-wider">Name</div>
              <div className="w-32 text-xs font-medium text-white/40 uppercase tracking-wider hidden sm:block">Modified</div>
              <div className="w-10"></div>
            </div>

            {/* Workbook Rows */}
            <div className="divide-y divide-white/[0.05]">
              {workbooks.map((workbook) => (
                <div
                  key={workbook.id}
                  className="flex items-center px-4 py-3 hover:bg-white/[0.03] transition-colors group"
                >
                  {/* Clickable content area */}
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                    onClick={() => router.push(`/workbook/${workbook.id}`)}
                  >
                    <div className="w-9 h-9 rounded-lg bg-lavender/20 flex items-center justify-center flex-shrink-0">
                      <FileSpreadsheet className="w-4 h-4 text-lavender" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-white truncate">{workbook.name}</h3>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0 hidden sm:block" />
                  </div>

                  {/* Modified date */}
                  <div className="w-32 text-sm text-white/40 hidden sm:block">
                    {new Date(workbook.updatedAt).toLocaleDateString()}
                  </div>

                  {/* Menu button */}
                  <div className="w-10 flex justify-end">
                    <button
                      type="button"
                      ref={(el) => { menuBtnRefs.current[workbook.id] = el; }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === workbook.id ? null : workbook.id);
                      }}
                      className="p-1.5 hover:bg-white/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="w-4 h-4 text-white/50" />
                    </button>

                    {openMenuId === workbook.id && createPortal(
                      <>
                        <div
                          className="fixed inset-0 z-[99]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                          }}
                        />
                        <div
                          className="fixed z-[100] min-w-[160px] py-1 bg-midnight-100 border border-white/10 rounded-xl shadow-xl"
                          style={{
                            top: (menuBtnRefs.current[workbook.id]?.getBoundingClientRect().bottom ?? 0) + 4,
                            right: window.innerWidth - (menuBtnRefs.current[workbook.id]?.getBoundingClientRect().right ?? 0),
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openRename(workbook);
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
                              openMove(workbook);
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
                              openDelete(workbook);
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
          <div className="bg-midnight-100/60 backdrop-blur-xl border border-white/10 rounded-2xl p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
              <FileSpreadsheet className="w-8 h-8 text-white/20" />
            </div>
            <h3 className="text-lg font-medium text-white mb-1">
              No workbooks yet
            </h3>
            <p className="text-white/50 mb-4">
              Create your first workbook to start organizing your data
            </p>
            <GlassButton variant="primary" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Create Workbook
            </GlassButton>
          </div>
        )}
      </main>

      {/* Create Workbook Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Workbook"
      >
        <div className="space-y-4">
          <GlassInput
            label="Workbook Name"
            placeholder="e.g., Leads, Contacts, Companies"
            value={newWorkbookName}
            onChange={(e) => setNewWorkbookName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateWorkbook();
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <GlassButton
              variant="ghost"
              onClick={() => setIsCreateModalOpen(false)}
            >
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleCreateWorkbook}
              loading={isCreating}
              disabled={!newWorkbookName.trim()}
            >
              Create Workbook
            </GlassButton>
          </div>
        </div>
      </Modal>

      {/* Rename Workbook Modal */}
      <Modal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename Workbook"
      >
        <div className="space-y-4">
          <GlassInput
            label="Workbook Name"
            placeholder="Enter new name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <GlassButton
              variant="ghost"
              onClick={() => setRenameTarget(null)}
            >
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
        onClose={() => setDeleteTarget(null)}
        title="Delete Workbook"
      >
        <div className="space-y-4">
          <p className="text-white/70">
            Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? All sheets in this workbook will be permanently deleted. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <GlassButton
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleDeleteWorkbook}
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

export default function ProjectPage() {
  return (
    <ToastProvider>
      <ProjectContent />
    </ToastProvider>
  );
}
