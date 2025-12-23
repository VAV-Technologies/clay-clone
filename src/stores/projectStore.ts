import { create } from 'zustand';
import type { Project, Table } from '@/lib/db/schema';

interface ProjectWithChildren extends Project {
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
  deleteProject: (id: string) => void;
  selectProject: (id: string | null) => void;
  toggleFolder: (id: string) => void;
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

  deleteProject: (id) =>
    set((state) => ({
      projects: removeProjectFromTree(state.projects, id),
      selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
    })),

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
