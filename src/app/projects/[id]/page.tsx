'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Plus, FileSpreadsheet, MoreHorizontal, Trash2, Edit2 } from 'lucide-react';
import {
  AnimatedBackground,
  GlassButton,
  GlassCard,
  GlassInput,
  Modal,
  Dropdown,
  ToastProvider,
  useToast,
} from '@/components/ui';
import { Sidebar } from '@/components/sidebar/Sidebar';

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

function ProjectContent() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchProject();
  }, [projectId]);

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
      }
    } catch (error) {
      toast.error('Error', 'Failed to delete table');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-lavender border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/50">Project not found</p>
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">{project.name}</h1>
            <p className="text-white/50">
              {project.tables?.length || 0} tables
            </p>
          </div>
          <GlassButton variant="primary" onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            New Table
          </GlassButton>
        </div>

        {/* Tables Grid */}
        {project.tables && project.tables.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {project.tables.map((table) => (
              <GlassCard
                key={table.id}
                variant="interactive"
                className="p-4"
                onClick={() => router.push(`/table/${table.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-lavender/20 flex items-center justify-center">
                      <FileSpreadsheet className="w-5 h-5 text-lavender" />
                    </div>
                    <div>
                      <h3 className="font-medium text-white">{table.name}</h3>
                      <p className="text-sm text-white/50">
                        {new Date(table.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <Dropdown
                    trigger={
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 hover:bg-white/10 rounded transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4 text-white/50" />
                      </button>
                    }
                    items={[
                      {
                        label: 'Rename',
                        icon: <Edit2 className="w-4 h-4" />,
                        onClick: () => {},
                      },
                      {
                        label: 'Delete',
                        icon: <Trash2 className="w-4 h-4" />,
                        onClick: () => handleDeleteTable(table.id, table.name),
                        danger: true,
                      },
                    ]}
                  />
                </div>
              </GlassCard>
            ))}
          </div>
        ) : (
          <GlassCard className="p-8 text-center">
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
          </GlassCard>
        )}
      </div>

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
    </main>
  );
}

export default function ProjectPage() {
  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <AnimatedBackground />
        <Sidebar />
        <ProjectContent />
      </div>
    </ToastProvider>
  );
}
