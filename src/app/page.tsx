'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Search,
  FolderPlus,
  FileSpreadsheet,
  Folder,
  MoreVertical,
  Settings,
  Sparkles,
  Table,
  Trash2,
  Database,
  HardDrive,
} from 'lucide-react';
import { ToastProvider, useToast } from '@/components/ui';
import { NewItemModal } from '@/components/modals/NewItemModal';
import { APISettingsModal } from '@/components/settings/APISettingsModal';
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

function formatRelativeTime(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return date.toLocaleDateString();
}

function ProjectRow({
  project,
  onClick,
  onDelete,
}: {
  project: Project;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const isFolder = project.type === 'folder';

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between px-6 py-4
                 hover:bg-white/5 cursor-pointer transition-colors group"
    >
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'p-2 rounded-lg',
            isFolder ? 'bg-amber-500/20' : 'bg-lavender/20'
          )}
        >
          {isFolder ? (
            <Folder className="w-5 h-5 text-amber-400" />
          ) : (
            <Table className="w-5 h-5 text-lavender" />
          )}
        </div>
        <div>
          <p className="text-white font-medium">{project.name}</p>
          <p className="text-sm text-white/40">
            Updated {formatRelativeTime(project.updatedAt)}
          </p>
        </div>
      </div>

      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-2 rounded-lg opacity-0 group-hover:opacity-100
                     hover:bg-white/10 transition-all"
        >
          <MoreVertical className="w-4 h-4 text-white/50" />
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
              }}
            />
            <div className="absolute right-0 top-full mt-1 z-20 bg-midnight-100 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[120px]">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </>
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
  const { projects, fetchProjects, deleteProject, isLoading } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState<'folder' | 'table' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Fetch storage stats with polling
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
    // Poll every 30 seconds for real-time updates
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
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
        // Create a table directly
        // First create a project to hold the table (or use a default one)
        const projectResponse = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type: 'table' }),
        });

        if (projectResponse.ok) {
          const project = await projectResponse.json();

          // Create the table inside this project
          const tableResponse = await fetch('/api/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id, name }),
          });

          if (tableResponse.ok) {
            const table = await tableResponse.json();
            await fetchProjects();
            toast.success('Table created');
            router.push(`/table/${table.id}`);
          }
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

  const handleOpenProject = async (project: Project) => {
    if (project.type === 'folder') {
      router.push(`/projects/${project.id}`);
    } else {
      // For table type, fetch the table and navigate to it
      try {
        const response = await fetch(`/api/projects/${project.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.tables && data.tables.length > 0) {
            router.push(`/table/${data.tables[0].id}`);
          } else {
            // If no table yet, go to project page to create one
            router.push(`/projects/${project.id}`);
          }
        }
      } catch {
        router.push(`/projects/${project.id}`);
      }
    }
  };

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/10 bg-midnight/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-lavender/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-lavender" />
            </div>
            <h1 className="text-xl font-bold text-white">DataFlow</h1>
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
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* Search Bar */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects..."
            className="w-full pl-12 pr-4 py-4 rounded-xl
                       bg-white/5 border border-white/10
                       text-white placeholder:text-white/40
                       focus:border-lavender focus:outline-none focus:ring-2 focus:ring-lavender/20
                       backdrop-blur-md"
          />
        </div>

        {/* Storage Counter */}
        {storageStats && (
          <div className="mb-8 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <HardDrive className="w-4 h-4 text-lavender" />
              <span className="text-white/70">
                {storageStats.storage.estimatedMB < 1
                  ? `${Math.round(storageStats.storage.estimatedBytes / 1024)} KB`
                  : `${storageStats.storage.estimatedMB} MB`}
              </span>
              <span className="text-white/40">/ {storageStats.storage.maxGB} GB</span>
              <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    storageStats.storage.usagePercent > 80 ? "bg-red-500" :
                    storageStats.storage.usagePercent > 50 ? "bg-amber-500" : "bg-lavender"
                  )}
                  style={{ width: `${Math.min(storageStats.storage.usagePercent, 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Database className="w-4 h-4 text-lavender" />
              <span className="text-white/70">{storageStats.counts.rows.toLocaleString()}</span>
              <span className="text-white/40">rows</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Table className="w-4 h-4 text-lavender" />
              <span className="text-white/70">{storageStats.counts.tables}</span>
              <span className="text-white/40">tables</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => setShowNewModal('folder')}
            className="flex items-center gap-3 px-5 py-3 rounded-xl
                       bg-white/5 border border-white/10
                       text-white hover:bg-white/10 hover:border-white/20
                       transition-all duration-200 backdrop-blur-md"
          >
            <FolderPlus className="w-5 h-5 text-amber-400" />
            <span>New Folder</span>
          </button>

          <button
            onClick={() => setShowNewModal('table')}
            className="flex items-center gap-3 px-5 py-3 rounded-xl
                       bg-lavender/20 border border-lavender/30
                       text-white hover:bg-lavender/30
                       transition-all duration-200 backdrop-blur-md"
          >
            <FileSpreadsheet className="w-5 h-5 text-lavender" />
            <span>New Table</span>
          </button>
        </div>

        {/* Projects List */}
        <div className="bg-midnight-100/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          {isLoading ? (
            <div className="p-12 text-center">
              <div className="animate-spin w-8 h-8 border-2 border-lavender border-t-transparent rounded-full mx-auto" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
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
            <div className="divide-y divide-white/5">
              {filteredProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onClick={() => handleOpenProject(project)}
                  onDelete={() => handleDelete(project)}
                />
              ))}
            </div>
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

      <APISettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
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
