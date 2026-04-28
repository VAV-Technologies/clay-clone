import { create } from 'zustand';
import type { Project, Table } from '@/lib/db/schema';

export interface ProjectWithChildren extends Project {
  children?: ProjectWithChildren[];
  tables?: Table[];
}

interface ProjectState {
  projects: ProjectWithChildren[];
  selectedProjectId: string | null;
  expandedFolders: Set<string>;
  isLoading: boolean;
  error: string | null;

  // Actions
  setProjects: (projects: ProjectWithChildren[]) => void;
  addProject: (project: ProjectWithChildren) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  moveProject: (id: string, newParentId: string | null) => void;
  deleteProject: (id: string) => void;
  updateTable: (tableId: string, updates: Partial<Table>) => void;
  removeTable: (tableId: string) => void;
  moveTable: (tableId: string, fromProjectId: string, toProjectId: string) => void;
  selectProject: (id: string | null) => void;
  toggleFolder: (id: string) => void;
  expandFolder: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchProjects: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  expandedFolders: new Set(),
  isLoading: false,
  error: null,

  setProjects: (projects) => set({ projects }),

  addProject: (project) =>
    set((state) => ({
      projects: [...state.projects, project],
    })),

  updateProject: (id, updates) =>
    set((state) => ({
      projects: updateProjectInTree(state.projects, id, updates),
    })),

  moveProject: (id, newParentId) =>
    set((state) => {
      const detached = detachProject(state.projects, id);
      if (!detached.node) return state;
      const moved = { ...detached.node, parentId: newParentId };
      return { projects: attachProject(detached.tree, moved, newParentId) };
    }),

  deleteProject: (id) =>
    set((state) => ({
      projects: removeProjectFromTree(state.projects, id),
      selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
    })),

  updateTable: (tableId, updates) =>
    set((state) => ({
      projects: updateTableInTree(state.projects, tableId, updates),
    })),

  removeTable: (tableId) =>
    set((state) => ({
      projects: removeTableFromTree(state.projects, tableId),
    })),

  moveTable: (tableId, fromProjectId, toProjectId) =>
    set((state) => {
      const detached = detachTable(state.projects, fromProjectId, tableId);
      if (!detached.table) return state;
      const moved = { ...detached.table, projectId: toProjectId };
      return { projects: attachTable(detached.tree, toProjectId, moved) };
    }),

  selectProject: (id) => set({ selectedProjectId: id }),

  toggleFolder: (id) =>
    set((state) => {
      const newExpanded = new Set(state.expandedFolders);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return { expandedFolders: newExpanded };
    }),

  expandFolder: (id) =>
    set((state) => {
      if (state.expandedFolders.has(id)) return state;
      const newExpanded = new Set(state.expandedFolders);
      newExpanded.add(id);
      return { expandedFolders: newExpanded };
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      set({ projects: data, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
}));

// Helper functions for tree operations
function updateProjectInTree(
  projects: ProjectWithChildren[],
  id: string,
  updates: Partial<Project>
): ProjectWithChildren[] {
  return projects.map((project) => {
    if (project.id === id) {
      return { ...project, ...updates };
    }
    if (project.children) {
      return {
        ...project,
        children: updateProjectInTree(project.children, id, updates),
      };
    }
    return project;
  });
}

function removeProjectFromTree(
  projects: ProjectWithChildren[],
  id: string
): ProjectWithChildren[] {
  return projects
    .filter((project) => project.id !== id)
    .map((project) => {
      if (project.children) {
        return {
          ...project,
          children: removeProjectFromTree(project.children, id),
        };
      }
      return project;
    });
}

// Detach a project subtree from the tree, returning both the new tree and the node.
function detachProject(
  projects: ProjectWithChildren[],
  id: string
): { tree: ProjectWithChildren[]; node: ProjectWithChildren | null } {
  let found: ProjectWithChildren | null = null;
  const tree = projects.flatMap((project) => {
    if (project.id === id) {
      found = project;
      return [];
    }
    if (project.children) {
      const childResult = detachProject(project.children, id);
      if (childResult.node) found = childResult.node;
      return [{ ...project, children: childResult.tree }];
    }
    return [project];
  });
  return { tree, node: found };
}

// Insert a project node under a parent (or at root when parentId is null).
function attachProject(
  projects: ProjectWithChildren[],
  node: ProjectWithChildren,
  parentId: string | null
): ProjectWithChildren[] {
  if (parentId === null) {
    return [...projects, node];
  }
  return projects.map((project) => {
    if (project.id === parentId) {
      return { ...project, children: [...(project.children ?? []), node] };
    }
    if (project.children) {
      return {
        ...project,
        children: attachProject(project.children, node, parentId),
      };
    }
    return project;
  });
}

function updateTableInTree(
  projects: ProjectWithChildren[],
  tableId: string,
  updates: Partial<Table>
): ProjectWithChildren[] {
  return projects.map((project) => {
    let nextTables = project.tables;
    if (nextTables?.some((t) => t.id === tableId)) {
      nextTables = nextTables.map((t) => (t.id === tableId ? { ...t, ...updates } : t));
    }
    const nextChildren = project.children
      ? updateTableInTree(project.children, tableId, updates)
      : project.children;
    return { ...project, tables: nextTables, children: nextChildren };
  });
}

function removeTableFromTree(
  projects: ProjectWithChildren[],
  tableId: string
): ProjectWithChildren[] {
  return projects.map((project) => ({
    ...project,
    tables: project.tables?.filter((t) => t.id !== tableId),
    children: project.children
      ? removeTableFromTree(project.children, tableId)
      : project.children,
  }));
}

function detachTable(
  projects: ProjectWithChildren[],
  fromProjectId: string,
  tableId: string
): { tree: ProjectWithChildren[]; table: Table | null } {
  let found: Table | null = null;
  const tree = projects.map((project) => {
    let nextTables = project.tables;
    if (project.id === fromProjectId && nextTables) {
      const target = nextTables.find((t) => t.id === tableId);
      if (target) {
        found = target;
        nextTables = nextTables.filter((t) => t.id !== tableId);
      }
    }
    let nextChildren = project.children;
    if (nextChildren) {
      const childResult = detachTable(nextChildren, fromProjectId, tableId);
      if (childResult.table) found = childResult.table;
      nextChildren = childResult.tree;
    }
    return { ...project, tables: nextTables, children: nextChildren };
  });
  return { tree, table: found };
}

function attachTable(
  projects: ProjectWithChildren[],
  toProjectId: string,
  table: Table
): ProjectWithChildren[] {
  return projects.map((project) => {
    if (project.id === toProjectId) {
      return { ...project, tables: [...(project.tables ?? []), table] };
    }
    if (project.children) {
      return {
        ...project,
        children: attachTable(project.children, toProjectId, table),
      };
    }
    return project;
  });
}
