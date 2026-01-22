'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Plus, FileSpreadsheet, MoreHorizontal, Trash2, ArrowLeft, Settings, Pencil, FolderInput, Folder, ChevronRight } from 'lucide-react';
import {
  GlassButton,
  GlassInput,
  Modal,
  ToastProvider,
  useToast,
} from '@/components/ui';
import { APISettingsModal } from '@/components/settings/APISettingsModal';

// Dynamically import AnimatedBackground to avoid hydration issues
const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

interface Table {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Project {
  id: string;
  name: string;
  type: string;
  tables: Table[];
}

interface FolderOption {
  id: string;
  name: string;
}

function ProjectContent() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [allFolders, setAllFolders] = useState<FolderOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Rename modal state
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameTableId, setRenameTableId] = useState<string | null>(null);
  const [renameTableName, setRenameTableName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Move modal state
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [moveTableId, setMoveTableId] = useState<string | null>(null);
  const [moveTableName, setMoveTableName] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    fetchProject();
    fetchAllFolders();
  }, [projectId]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const handleClickOutside = () => setOpenMenuId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openMenuId]);

  const fetchProject = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAllFolders = async () => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        // Filter to only folders and exclude current project
        const folders = data
          .filter((p: Project) => p.type === 'folder' && p.id !== projectId)
          .map((p: Project) => ({ id: p.id, name: p.name }));
        setAllFolders(folders);
      }
    } catch (error) {
      console.error('Failed to fetch folders:', error);
    }
  };

  const handleCreateTable = async () => {
    if (!newTableName.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: newTableName,
        }),
      });

      if (response.ok) {
        const table = await response.json();
        toast.success('Table created', `"${table.name}" has been created`);
        setNewTableName('');
        setIsCreateModalOpen(false);
        router.push(`/table/${table.id}`);
      }
    } catch (error) {
      toast.error('Error', 'Failed to create table');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteTable = async (tableId: string, tableName: string) => {
    try {
      const response = await fetch(`/api/tables/${tableId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success('Table deleted', `"${tableName}" has been deleted`);
        fetchProject();
      } else {
        const data = await response.json().catch(() => ({}));
        toast.error('Error', data.error || 'Failed to delete table');
      }
    } catch (error) {
      toast.error('Error', 'Failed to delete table');
    }
  };

  const handleRenameTable = async () => {
    if (!renameTableId || !renameTableName.trim()) return;

    setIsRenaming(true);
    try {
      const response = await fetch(`/api/tables/${renameTableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameTableName }),
      });

      if (response.ok) {
        toast.success('Table renamed', `Table has been renamed to "${renameTableName}"`);
        setIsRenameModalOpen(false);
        setRenameTableId(null);
        setRenameTableName('');
        fetchProject();
      }
    } catch (error) {
      toast.error('Error', 'Failed to rename table');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleMoveTable = async () => {
    if (!moveTableId || !selectedFolderId) return;

    setIsMoving(true);
    try {
      const response = await fetch(`/api/tables/${moveTableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedFolderId }),
      });

      if (response.ok) {
        const targetFolder = allFolders.find(f => f.id === selectedFolderId);
        toast.success('Table moved', `"${moveTableName}" has been moved to "${targetFolder?.name}"`);
        setIsMoveModalOpen(false);
        setMoveTableId(null);
        setMoveTableName('');
        setSelectedFolderId(null);
        fetchProject();
      }
    } catch (error) {
      toast.error('Error', 'Failed to move table');
    } finally {
      setIsMoving(false);
    }
  };

  const openRenameModal = (table: Table) => {
    setRenameTableId(table.id);
    setRenameTableName(table.name);
    setIsRenameModalOpen(true);
    setOpenMenuId(null);
  };

  const openMoveModal = (table: Table) => {
    setMoveTableId(table.id);
    setMoveTableName(table.name);
    setSelectedFolderId(null);
    setIsMoveModalOpen(true);
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

  if (!project) {
    return (
      <div className="min-h-screen relative flex items-center justify-center">
        <AnimatedBackground />
        <p className="text-white/50">Project not found</p>
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
            <h1 className="text-lg font-semibold text-white">{project.name}</h1>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5 text-white/70" />
          </button>
        </div>
      </header>

      {/* Main Content - Centered */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-8">
        {/* Action Bar */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-white/50">
            {project.tables?.length || 0} {project.tables?.length === 1 ? 'table' : 'tables'}
          </p>
          <GlassButton variant="primary" onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            New Table
          </GlassButton>
        </div>

        {/* Tables List - Row Layout */}
        {project.tables && project.tables.length > 0 ? (
          <div className="bg-midnight-100/60 backdrop-blur-xl border border-white/10 rounded-xl">
            {/* Table Header */}
            <div className="flex items-center px-4 py-3 border-b border-white/10 bg-white/[0.02] rounded-t-xl">
              <div className="flex-1 text-xs font-medium text-white/40 uppercase tracking-wider">Name</div>
              <div className="w-32 text-xs font-medium text-white/40 uppercase tracking-wider hidden sm:block">Modified</div>
              <div className="w-10"></div>
            </div>

            {/* Table Rows */}
            <div className="divide-y divide-white/[0.05]">
              {project.tables.map((table) => (
                <div
                  key={table.id}
                  className="flex items-center px-4 py-3 hover:bg-white/[0.03] transition-colors group"
                >
                  {/* Clickable content area */}
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                    onClick={() => router.push(`/table/${table.id}`)}
                  >
                    <div className="w-9 h-9 rounded-lg bg-lavender/20 flex items-center justify-center flex-shrink-0">
                      <FileSpreadsheet className="w-4 h-4 text-lavender" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-white truncate">{table.name}</h3>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0 hidden sm:block" />
                  </div>

                  {/* Modified date */}
                  <div className="w-32 text-sm text-white/40 hidden sm:block">
                    {new Date(table.updatedAt).toLocaleDateString()}
                  </div>

                  {/* Menu button */}
                  <div className="relative w-10 flex justify-end">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === table.id ? null : table.id);
                      }}
                      className="p-1.5 hover:bg-white/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="w-4 h-4 text-white/50" />
                    </button>

                    {openMenuId === table.id && (
                        <div
                          className="absolute right-0 top-full mt-1 z-50 min-w-[160px] py-1 bg-midnight-100 border border-white/10 rounded-xl shadow-xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openRenameModal(table);
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
                              openMoveModal(table);
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
                              setOpenMenuId(null);
                              handleDeleteTable(table.id, table.name);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
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
              No tables yet
            </h3>
            <p className="text-white/50 mb-4">
              Create your first table to start organizing your data
            </p>
            <GlassButton variant="primary" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Create Table
            </GlassButton>
          </div>
        )}
      </main>

      {/* Create Table Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Table"
      >
        <div className="space-y-4">
          <GlassInput
            label="Table Name"
            placeholder="e.g., Leads, Contacts, Companies"
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateTable();
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
              onClick={handleCreateTable}
              loading={isCreating}
              disabled={!newTableName.trim()}
            >
              Create Table
            </GlassButton>
          </div>
        </div>
      </Modal>

      {/* Rename Table Modal */}
      <Modal
        isOpen={isRenameModalOpen}
        onClose={() => {
          setIsRenameModalOpen(false);
          setRenameTableId(null);
          setRenameTableName('');
        }}
        title="Rename Table"
      >
        <div className="space-y-4">
          <GlassInput
            label="Table Name"
            placeholder="Enter new name"
            value={renameTableName}
            onChange={(e) => setRenameTableName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameTable();
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <GlassButton
              variant="ghost"
              onClick={() => {
                setIsRenameModalOpen(false);
                setRenameTableId(null);
                setRenameTableName('');
              }}
            >
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleRenameTable}
              loading={isRenaming}
              disabled={!renameTableName.trim()}
            >
              Rename
            </GlassButton>
          </div>
        </div>
      </Modal>

      {/* Move Table Modal */}
      <Modal
        isOpen={isMoveModalOpen}
        onClose={() => {
          setIsMoveModalOpen(false);
          setMoveTableId(null);
          setMoveTableName('');
          setSelectedFolderId(null);
        }}
        title={`Move "${moveTableName}"`}
      >
        <div className="space-y-4">
          <p className="text-sm text-white/60">Select a folder to move this table to:</p>

          {allFolders.length > 0 ? (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {allFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    selectedFolderId === folder.id
                      ? 'bg-lavender/20 border border-lavender/30'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Folder className={`w-5 h-5 ${selectedFolderId === folder.id ? 'text-lavender' : 'text-white/40'}`} />
                  <span className={`text-sm ${selectedFolderId === folder.id ? 'text-white' : 'text-white/70'}`}>
                    {folder.name}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Folder className="w-10 h-10 text-white/20 mx-auto mb-2" />
              <p className="text-sm text-white/50">No other folders available</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <GlassButton
              variant="ghost"
              onClick={() => {
                setIsMoveModalOpen(false);
                setMoveTableId(null);
                setMoveTableName('');
                setSelectedFolderId(null);
              }}
            >
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleMoveTable}
              loading={isMoving}
              disabled={!selectedFolderId}
            >
              Move
            </GlassButton>
          </div>
        </div>
      </Modal>

      {/* Settings Modal */}
      <APISettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}

export default function ProjectPage() {
  return (
    <ToastProvider>
      <ProjectContent />
    </ToastProvider>
  );
}
