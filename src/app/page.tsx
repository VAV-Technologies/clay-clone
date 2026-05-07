'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  FolderPlus,
  FileSpreadsheet,
  Folder,
  MoreVertical,
  Trash2,
  HardDrive,
  Pencil,
  FolderInput,
} from 'lucide-react';
import { ToastProvider, useToast, Modal, GlassButton, GlassInput } from '@/components/ui';
import { NewItemModal } from '@/components/modals/NewItemModal';
import { MovePickerModal, type MovePickerTarget } from '@/components/sidebar/MovePickerModal';
import { useProjectStore } from '@/stores/projectStore';
import { cn } from '@/lib/utils';

// Dynamically import AnimatedBackground to avoid hydration issues
const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

interface Project {
  id: string;
  name: string;
  type: 'folder' | 'table' | 'workbook';
  updatedAt: string | Date;
  parentId?: string | null;
}

function formatModified(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString();
}

function ProjectRow({
  project,
  onClick,
  onRename,
  onMove,
  onDelete,
}: {
  project: Project;
  onClick: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const isFolder = project.type === 'folder';

  return (
    <div
      className="flex items-center px-4 py-3 hover:bg-white/[0.03] transition-colors group"
    >
      {/* Clickable content area */}
      <div
        className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
        onClick={onClick}
      >
        <div
          className={cn(
            'w-11 h-11 flex items-center justify-center flex-shrink-0 border',
            isFolder ? 'border-amber-400/40' : 'border-lavender/40'
          )}
        >
          {isFolder ? (
            <Folder className="w-5 h-5 text-amber-400" />
          ) : (
            <FileSpreadsheet className="w-5 h-5 text-lavender" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-white truncate">{project.name}</h3>
        </div>
      </div>

      {/* Modified */}
      <div className="w-32 hidden sm:flex items-center justify-center text-sm text-white/40 self-stretch border-l border-white/10">
        {formatModified(project.updatedAt)}
      </div>

      {/* Menu */}
      <div className="w-10 flex items-center justify-end self-stretch border-l border-white/10 pl-1">
        <button
          ref={menuBtnRef}
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-1.5 opacity-0 group-hover:opacity-100
                     hover:bg-white/10 transition-all"
        >
          <MoreVertical className="w-4 h-4 text-white/50" />
        </button>

        {showMenu && createPortal(
          <>
            <div
              className="fixed inset-0 z-[99]"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
              }}
            />
            <div
              className="fixed z-[100] bg-midnight-100 border border-white/10 shadow-xl min-w-[160px] py-1"
              style={{
                top: (menuBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                right: window.innerWidth - (menuBtnRef.current?.getBoundingClientRect().right ?? 0),
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onRename();
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/80 hover:bg-white/5 transition-colors"
              >
                <Pencil className="w-4 h-4" />
                Rename
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onMove();
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-white/80 hover:bg-white/5 transition-colors"
              >
                <FolderInput className="w-4 h-4" />
                Move to folder
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
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
  );
}

interface StorageStats {
  counts: {
    projects: number;
    tables: number;
    columns: number;
    rows: number;
  };
  storage: {
    estimatedBytes: number;
    estimatedMB: number;
    maxGB: number;
    usagePercent: number;
  };
}

function DashboardContent() {
  const router = useRouter();
  const toast = useToast();
  const {
    projects,
    fetchProjects,
    deleteProject,
    updateProject,
    moveProject,
    isLoading,
  } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState<'folder' | 'table' | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const [movePickerTarget, setMovePickerTarget] = useState<MovePickerTarget | null>(null);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Fetch storage stats once on mount
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/stats');
        if (response.ok) {
          const data = await response.json();
          setStorageStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch storage stats:', error);
      }
    };

    fetchStats();
  }, []);

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async (type: 'folder' | 'table', name: string) => {
    try {
      if (type === 'folder') {
        // Create a folder (project)
        const response = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type: 'folder' }),
        });

        if (response.ok) {
          await fetchProjects();
          toast.success('Folder created');
        }
      } else {
        // Create a workbook with one default sheet
        const projectResponse = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type: 'workbook' }),
        });

        if (projectResponse.ok) {
          const project = await projectResponse.json();

          // Create the first sheet inside the workbook
          await fetch('/api/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id, name: 'Sheet 1' }),
          });

          await fetchProjects();
          toast.success('Workbook created');
          router.push(`/workbook/${project.id}`);
        }
      }
    } catch (error) {
      toast.error('Failed to create item');
    }
  };

  const handleDelete = async (project: Project) => {
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        deleteProject(project.id);
        toast.success(`${project.name} deleted`);
      }
    } catch (error) {
      toast.error('Failed to delete item');
    }
  };

  const openRename = (project: Project) => {
    setRenameTarget(project);
    setRenameValue(project.name);
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
        updateProject(renameTarget.id, { name: trimmed });
        toast.success('Renamed');
        setRenameTarget(null);
      } else {
        toast.error('Failed to rename');
      }
    } catch (error) {
      toast.error('Failed to rename');
    } finally {
      setIsRenaming(false);
    }
  };

  const openMove = (project: Project) => {
    setMovePickerTarget({
      kind: 'project',
      id: project.id,
      name: project.name,
      type: project.type === 'folder' ? 'folder' : 'workbook',
      currentParentId: project.parentId ?? null,
    });
  };

  const handleMoveSubmit = async (destinationId: string | null) => {
    if (!movePickerTarget || movePickerTarget.kind !== 'project') return;
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
        moveProject(movePickerTarget.id, destinationId);
        toast.success(destinationId ? 'Moved to folder' : 'Moved to root');
      } else {
        toast.error('Failed to move');
      }
    } catch (error) {
      toast.error('Failed to move');
    } finally {
      setMovePickerTarget(null);
    }
  };

  const handleOpenProject = async (project: Project) => {
    if (project.type === 'folder') {
      router.push(`/projects/${project.id}`);
    } else {
      // Workbook or table type — open as workbook
      router.push(`/workbook/${project.id}`);
    }
  };

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/10 bg-midnight/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center">
            <h1 className="text-2xl font-display text-white tracking-tight">Dataflow</h1>
          </div>
          <a
            href="/api-docs"
            className="px-3 py-1.5 text-sm text-white/60 hover:text-white border border-white/10 hover:border-white/20 transition-colors"
          >
            API Docs
          </a>
        </div>
      </header>

      {/* Main Content - Centered */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-6">
        {/* Greeting */}
        <h2 className="font-display italic font-light text-5xl md:text-6xl text-white/40 mb-8 mt-4 leading-none tracking-tight">
          What are we building today?
        </h2>

        {/* Search Bar */}
        <div className="relative mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workbooks..."
            className="w-full px-4 py-3
                       bg-white/5 border border-white/10
                       text-white placeholder:text-white/40
                       focus:border-lavender focus:outline-none focus:ring-2 focus:ring-lavender/20
                       backdrop-blur-md"
          />
        </div>

        {/* Storage + Actions Row */}
        <div className="flex items-center justify-between mb-8">
          {/* Left: Storage */}
          {storageStats ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 text-sm">
              <HardDrive className="w-4 h-4 text-lavender" />
              <span className="text-white/70">
                {storageStats.storage.estimatedMB < 1
                  ? `${Math.round(storageStats.storage.estimatedBytes / 1024)} KB`
                  : `${storageStats.storage.estimatedMB} MB`}
              </span>
              <span className="text-white/40">/ {storageStats.storage.maxGB} GB</span>
              <div className="w-16 h-1.5 bg-white/10 overflow-hidden ml-1">
                <div
                  className={cn(
                    "h-full transition-all",
                    storageStats.storage.usagePercent > 80 ? "bg-red-500" :
                    storageStats.storage.usagePercent > 50 ? "bg-amber-500" : "bg-lavender"
                  )}
                  style={{ width: `${Math.min(storageStats.storage.usagePercent, 100)}%` }}
                />
              </div>
            </div>
          ) : <div />}

          {/* Right: New Folder + New Workbook */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowNewModal('folder')}
              className="flex items-center justify-center gap-2 w-40 py-3 text-sm
                         bg-white/5 border border-white/10
                         text-white hover:bg-white/10 hover:border-white/20
                         transition-all duration-200 backdrop-blur-md"
            >
              <FolderPlus className="w-4 h-4 text-amber-400" />
              <span>New Folder</span>
            </button>

            <button
              onClick={() => setShowNewModal('table')}
              className="flex items-center justify-center gap-2 w-40 py-3 text-sm
                         bg-lavender/20 border border-lavender/30
                         text-white hover:bg-lavender/30
                         transition-all duration-200 backdrop-blur-md"
            >
              <FileSpreadsheet className="w-4 h-4 text-lavender" />
              <span>New Workbook</span>
            </button>
          </div>
        </div>

        {/* Projects List */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl">
          {isLoading ? (
            <div className="p-12 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-lavender border-t-transparent rounded-full mx-auto" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-white/5 flex items-center justify-center">
                <Folder className="w-8 h-8 text-white/30" />
              </div>
              <p className="text-white/50">
                {searchQuery ? 'No matching projects' : 'No projects yet'}
              </p>
              <p className="text-sm text-white/30 mt-1">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Create a folder or workbook to get started'}
              </p>
            </div>
          ) : (
            <>
              {/* Table Header */}
              <div className="flex items-stretch px-4 py-3 border-b border-white/10 bg-white/[0.02]">
                <div className="flex-1 text-xs font-medium text-white/40 uppercase tracking-wider">Name</div>
                <div className="w-32 hidden sm:flex items-center justify-center text-xs font-medium text-white/40 uppercase tracking-wider border-l border-white/10">Modified</div>
                <div className="w-10 border-l border-white/10"></div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-white/[0.05]">
                {filteredProjects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    onClick={() => handleOpenProject(project)}
                    onRename={() => openRename(project)}
                    onMove={() => openMove(project)}
                    onDelete={() => handleDelete(project)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Modals */}
      <NewItemModal
        type={showNewModal}
        isOpen={!!showNewModal}
        onClose={() => setShowNewModal(null)}
        onCreate={handleCreate}
      />

      <Modal
        isOpen={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title={`Rename ${renameTarget?.type === 'folder' ? 'folder' : 'workbook'}`}
      >
        <div className="space-y-4">
          <GlassInput
            placeholder="New name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
            }}
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

      <MovePickerModal
        target={movePickerTarget}
        projects={projects}
        onClose={() => setMovePickerTarget(null)}
        onMove={handleMoveSubmit}
      />

    </div>
  );
}

export default function HomePage() {
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
}
