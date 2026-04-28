'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileSpreadsheet,
  Plus,
  MoreHorizontal,
  Search,
  Table,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassButton, GlassInput, Dropdown, ContextMenu } from '@/components/ui';
import { useProjectStore, type ProjectWithChildren } from '@/stores/projectStore';
import { MovePickerModal, type MovePickerTarget } from './MovePickerModal';

export function Sidebar() {
  const router = useRouter();
  const {
    projects,
    selectedProjectId,
    expandedFolders,
    isLoading,
    selectProject,
    toggleFolder,
    expandFolder,
    fetchProjects,
    addProject,
    updateProject,
    moveProject,
    deleteProject,
    updateTable,
    removeTable,
    moveTable,
  } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState<'folder' | 'workbook' | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editingTableName, setEditingTableName] = useState('');
  const [movePickerTarget, setMovePickerTarget] = useState<MovePickerTarget | null>(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async (type: 'folder' | 'workbook') => {
    if (!newName.trim()) return;

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, type }),
      });

      if (response.ok) {
        const project = await response.json();
        addProject(project);
        setNewName('');
        setIsCreating(null);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) return;

    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName }),
      });

      if (response.ok) {
        updateProject(id, { name: editingName });
        setEditingId(null);
        setEditingName('');
      }
    } catch (error) {
      console.error('Failed to rename project:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (response.ok) {
        deleteProject(id);
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handleMoveProject = async (id: string, newParentId: string | null) => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: newParentId }),
      });
      if (response.ok) {
        moveProject(id, newParentId);
        if (newParentId) expandFolder(newParentId);
      }
    } catch (error) {
      console.error('Failed to move project:', error);
    }
  };

  const handleRenameTable = async (tableId: string) => {
    if (!editingTableName.trim()) {
      setEditingTableId(null);
      setEditingTableName('');
      return;
    }
    try {
      const response = await fetch(`/api/tables/${tableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingTableName }),
      });
      if (response.ok) {
        updateTable(tableId, { name: editingTableName });
        setEditingTableId(null);
        setEditingTableName('');
      }
    } catch (error) {
      console.error('Failed to rename sheet:', error);
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    try {
      const response = await fetch(`/api/tables/${tableId}`, { method: 'DELETE' });
      if (response.ok) {
        removeTable(tableId);
      }
    } catch (error) {
      console.error('Failed to delete sheet:', error);
    }
  };

  const handleMoveTable = async (tableId: string, fromProjectId: string, toProjectId: string) => {
    try {
      const response = await fetch(`/api/tables/${tableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: toProjectId }),
      });
      if (response.ok) {
        moveTable(tableId, fromProjectId, toProjectId);
        expandFolder(toProjectId);
      }
    } catch (error) {
      console.error('Failed to move sheet:', error);
    }
  };

  const handleMovePickerSelect = (destinationId: string | null) => {
    if (!movePickerTarget) return;
    if (movePickerTarget.kind === 'project') {
      if (destinationId !== movePickerTarget.currentParentId) {
        handleMoveProject(movePickerTarget.id, destinationId);
      }
    } else {
      if (destinationId && destinationId !== movePickerTarget.currentProjectId) {
        handleMoveTable(movePickerTarget.id, movePickerTarget.currentProjectId, destinationId);
      }
    }
    setMovePickerTarget(null);
  };

  const filteredProjects = searchQuery
    ? filterProjects(projects, searchQuery)
    : projects;

  return (
    <aside className="w-64 h-full glass-sidebar flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-lavender/20 flex items-center justify-center">
            <Table className="w-4 h-4 text-lavender" />
          </div>
          <span className="font-semibold text-white">DataFlow</span>
        </div>

        {/* Search */}
        <GlassInput
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          icon={<Search className="w-4 h-4" />}
          className="text-sm"
        />
      </div>

      {/* Project Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin w-6 h-6 border-2 border-lavender border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {filteredProjects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                selectedId={selectedProjectId}
                expandedFolders={expandedFolders}
                editingId={editingId}
                editingName={editingName}
                editingTableId={editingTableId}
                editingTableName={editingTableName}
                onSelect={selectProject}
                onToggle={toggleFolder}
                onStartEdit={(id, name) => {
                  setEditingId(id);
                  setEditingName(name);
                }}
                onSaveEdit={handleRename}
                onCancelEdit={() => setEditingId(null)}
                setEditingName={setEditingName}
                onDelete={handleDelete}
                onStartEditTable={(tableId, name) => {
                  setEditingTableId(tableId);
                  setEditingTableName(name);
                }}
                onSaveEditTable={handleRenameTable}
                onCancelEditTable={() => {
                  setEditingTableId(null);
                  setEditingTableName('');
                }}
                setEditingTableName={setEditingTableName}
                onDeleteTable={handleDeleteTable}
                onOpenMovePicker={setMovePickerTarget}
                onNavigate={(path) => router.push(path)}
              />
            ))}

            {/* Create new */}
            {isCreating && (
              <div className="p-2">
                <GlassInput
                  autoFocus
                  placeholder={`New ${isCreating} name...`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate(isCreating);
                    if (e.key === 'Escape') setIsCreating(null);
                  }}
                  className="text-sm"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer - Create buttons */}
      <div className="p-3 border-t border-white/10 space-y-2">
        <GlassButton
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setIsCreating('folder')}
        >
          <Plus className="w-4 h-4 mr-2" />
          New Folder
        </GlassButton>
        <GlassButton
          variant="primary"
          size="sm"
          className="w-full justify-start"
          onClick={() => setIsCreating('workbook')}
        >
          <Plus className="w-4 h-4 mr-2" />
          New Workbook
        </GlassButton>
      </div>

      <MovePickerModal
        target={movePickerTarget}
        projects={projects}
        onClose={() => setMovePickerTarget(null)}
        onMove={handleMovePickerSelect}
      />
    </aside>
  );
}

interface ProjectItemProps {
  project: ProjectWithChildren;
  selectedId: string | null;
  expandedFolders: Set<string>;
  editingId: string | null;
  editingName: string;
  editingTableId: string | null;
  editingTableName: string;
  depth?: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onStartEdit: (id: string, name: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  setEditingName: (name: string) => void;
  onDelete: (id: string) => void;
  onStartEditTable: (tableId: string, name: string) => void;
  onSaveEditTable: (tableId: string) => void;
  onCancelEditTable: () => void;
  setEditingTableName: (name: string) => void;
  onDeleteTable: (tableId: string) => void;
  onOpenMovePicker: (target: MovePickerTarget) => void;
  onNavigate: (path: string) => void;
}

function ProjectItem({
  project,
  selectedId,
  expandedFolders,
  editingId,
  editingName,
  editingTableId,
  editingTableName,
  depth = 0,
  onSelect,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  setEditingName,
  onDelete,
  onStartEditTable,
  onSaveEditTable,
  onCancelEditTable,
  setEditingTableName,
  onDeleteTable,
  onOpenMovePicker,
  onNavigate,
}: ProjectItemProps) {
  const isExpanded = expandedFolders.has(project.id);
  const isSelected = selectedId === project.id;
  const isEditing = editingId === project.id;
  const hasChildren = project.children && project.children.length > 0;
  const hasTables = project.tables && project.tables.length > 0;
  const isFolder = project.type === 'folder';

  const contextMenuItems = [
    {
      label: 'Rename',
      onClick: () => onStartEdit(project.id, project.name),
      shortcut: 'F2',
    },
    {
      label: 'Move to…',
      onClick: () =>
        onOpenMovePicker({
          kind: 'project',
          id: project.id,
          name: project.name,
          type: project.type === 'folder' ? 'folder' : 'workbook',
          currentParentId: project.parentId,
        }),
    },
    { divider: true, label: '', onClick: () => {} },
    {
      label: 'Delete',
      onClick: () => onDelete(project.id),
      danger: true,
    },
  ];

  return (
    <ContextMenu items={contextMenuItems}>
      <div>
        <div
          className={cn(
            'group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer',
            'transition-colors duration-150',
            isSelected
              ? 'bg-lavender/20 text-white'
              : 'text-white/70 hover:bg-white/5 hover:text-white'
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            if (isFolder) {
              onToggle(project.id);
            } else {
              onSelect(project.id);
              onNavigate(`/projects/${project.id}`);
            }
          }}
        >
          {/* Expand/Collapse icon */}
          {isFolder && (hasChildren || hasTables) ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle(project.id);
              }}
              className="p-0.5 hover:bg-white/10 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}

          {/* Icon */}
          {isFolder ? (
            <Folder className="w-4 h-4 text-lavender/70" />
          ) : (
            <FileSpreadsheet className="w-4 h-4 text-lavender" />
          )}

          {/* Name */}
          {isEditing ? (
            <input
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit(project.id);
                if (e.key === 'Escape') onCancelEdit();
              }}
              onBlur={() => onSaveEdit(project.id)}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-white/10 border border-lavender/50 rounded px-1 text-sm outline-none"
            />
          ) : (
            <span className="flex-1 truncate text-sm">{project.name}</span>
          )}

          {/* More menu */}
          <Dropdown
            align="right"
            trigger={
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded transition-opacity"
              >
                <MoreHorizontal className="w-3 h-3" />
              </button>
            }
            items={contextMenuItems}
          />
        </div>

        {/* Children */}
        {isExpanded && (
          <>
            {project.children?.map((child) => (
              <ProjectItem
                key={child.id}
                project={child}
                selectedId={selectedId}
                expandedFolders={expandedFolders}
                editingId={editingId}
                editingName={editingName}
                editingTableId={editingTableId}
                editingTableName={editingTableName}
                depth={depth + 1}
                onSelect={onSelect}
                onToggle={onToggle}
                onStartEdit={onStartEdit}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                setEditingName={setEditingName}
                onDelete={onDelete}
                onStartEditTable={onStartEditTable}
                onSaveEditTable={onSaveEditTable}
                onCancelEditTable={onCancelEditTable}
                setEditingTableName={setEditingTableName}
                onDeleteTable={onDeleteTable}
                onOpenMovePicker={onOpenMovePicker}
                onNavigate={onNavigate}
              />
            ))}

            {/* Tables (sheets) */}
            {project.tables?.map((table) => {
              const isEditingTable = editingTableId === table.id;
              const tableMenuItems = [
                {
                  label: 'Rename',
                  onClick: () => onStartEditTable(table.id, table.name),
                  shortcut: 'F2',
                },
                {
                  label: 'Move to…',
                  onClick: () =>
                    onOpenMovePicker({
                      kind: 'sheet',
                      id: table.id,
                      name: table.name,
                      currentProjectId: project.id,
                    }),
                },
                { divider: true, label: '', onClick: () => {} },
                {
                  label: 'Delete',
                  onClick: () => onDeleteTable(table.id),
                  danger: true,
                },
              ];

              return (
                <ContextMenu key={table.id} items={tableMenuItems}>
                  <div
                    className={cn(
                      'group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer',
                      'text-white/60 hover:bg-white/5 hover:text-white',
                      'transition-colors duration-150'
                    )}
                    style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                    onClick={() => {
                      if (!isEditingTable) onNavigate(`/table/${table.id}`);
                    }}
                  >
                    <span className="w-4" />
                    <FileSpreadsheet className="w-4 h-4 text-lavender/50" />
                    {isEditingTable ? (
                      <input
                        autoFocus
                        value={editingTableName}
                        onChange={(e) => setEditingTableName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onSaveEditTable(table.id);
                          if (e.key === 'Escape') onCancelEditTable();
                        }}
                        onBlur={() => onSaveEditTable(table.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-white/10 border border-lavender/50 rounded px-1 text-sm outline-none"
                      />
                    ) : (
                      <span className="flex-1 truncate text-sm">{table.name}</span>
                    )}
                    <Dropdown
                      align="right"
                      trigger={
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded transition-opacity"
                        >
                          <MoreHorizontal className="w-3 h-3" />
                        </button>
                      }
                      items={tableMenuItems}
                    />
                  </div>
                </ContextMenu>
              );
            })}
          </>
        )}
      </div>
    </ContextMenu>
  );
}

function filterProjects(
  projects: ProjectWithChildren[],
  query: string
): ProjectWithChildren[] {
  const lowerQuery = query.toLowerCase();

  return projects
    .map((project) => {
      const matchesName = project.name.toLowerCase().includes(lowerQuery);
      const filteredChildren = project.children
        ? filterProjects(project.children, query)
        : [];
      const filteredTables = project.tables?.filter((t) =>
        t.name.toLowerCase().includes(lowerQuery)
      );

      if (matchesName || filteredChildren.length > 0 || (filteredTables && filteredTables.length > 0)) {
        return {
          ...project,
          children: filteredChildren,
          tables: matchesName ? project.tables : filteredTables,
        };
      }

      return null;
    })
    .filter(Boolean) as ProjectWithChildren[];
}
