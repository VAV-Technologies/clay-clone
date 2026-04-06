import { create } from 'zustand';
import type { Table, Column, Row, CellValue } from '@/lib/db/schema';
import { applyFilter as sharedApplyFilter } from '@/lib/filter-utils';
import type { Filter, FilterOperator, FilterLogic } from '@/lib/filter-utils';
export type { Filter, FilterOperator, FilterLogic };

interface SheetInfo {
  id: string;
  name: string;
  projectId: string;
}

interface TableState {
  // Workbook (multi-sheet) state
  workbookId: string | null;
  sheets: SheetInfo[];
  activeSheetId: string | null;

  currentTable: Table | null;
  columns: Column[];
  rows: Row[];
  selectedCells: Set<string>; // Format: "rowId:columnId"
  selectedRows: Set<string>;
  filters: Filter[];
  filterLogic: FilterLogic;
  showFilters: boolean;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  isLoading: boolean;
  error: string | null;
  editingCell: { rowId: string; columnId: string } | null;

  // Row display range (for limiting visible rows)
  rowDisplayStart: number;
  rowDisplayLimit: number | null; // null = show all

  // Column visibility
  hiddenColumns: Set<string>;

  // Active enrichment jobs (columnId → jobId)
  activeEnrichmentJobs: Map<string, string>;

  // Actions
  setCurrentTable: (table: Table | null) => void;
  setColumns: (columns: Column[]) => void;
  setRows: (rows: Row[]) => void;
  addColumn: (column: Column) => void;
  updateColumn: (id: string, updates: Partial<Column>) => void;
  deleteColumn: (id: string) => void;
  reorderColumns: (columnIds: string[]) => void;
  addRow: (row: Row) => void;
  updateRow: (id: string, data: Record<string, CellValue>) => void;
  updateCell: (rowId: string, columnId: string, value: CellValue) => void;
  deleteRows: (ids: string[]) => void;
  selectCell: (rowId: string, columnId: string, multi?: boolean) => void;
  selectRow: (rowId: string, multi?: boolean) => void;
  clearSelection: () => void;
  setEditingCell: (cell: { rowId: string; columnId: string } | null) => void;
  addFilter: (filter: Filter) => void;
  removeFilter: (columnId: string) => void;
  clearFilters: () => void;
  toggleFilterLogic: () => void;
  setShowFilters: (show: boolean) => void;
  setSort: (columnId: string | null, direction?: 'asc' | 'desc') => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchTable: (tableId: string, silent?: boolean) => Promise<void>;

  // Row display range actions
  setRowDisplayRange: (start: number, limit: number | null) => void;
  resetRowDisplayRange: () => void;

  // Column visibility actions
  hideColumn: (columnId: string) => void;
  showColumn: (columnId: string) => void;
  toggleColumnVisibility: (columnId: string) => void;
  showAllColumns: () => void;

  // Enrichment job actions
  setActiveJob: (columnId: string, jobId: string | null) => void;
  getActiveJobId: (columnId: string) => string | null;

  // Workbook actions
  fetchWorkbook: (workbookId: string, sheetId?: string) => Promise<void>;
  switchSheet: (sheetId: string) => Promise<void>;
  addSheet: (name: string) => Promise<SheetInfo | null>;
  renameSheet: (sheetId: string, name: string) => Promise<void>;
  deleteSheet: (sheetId: string) => Promise<void>;

  // Computed
  getFilteredRows: () => Row[];
  getSortedRows: () => Row[];
  getDisplayedRows: () => Row[];
  getVisibleColumns: () => Column[];
}

export const useTableStore = create<TableState>((set, get) => ({
  workbookId: null,
  sheets: [],
  activeSheetId: null,

  currentTable: null,
  columns: [],
  rows: [],
  selectedCells: new Set(),
  selectedRows: new Set(),
  filters: [],
  filterLogic: 'AND' as FilterLogic,
  showFilters: false,
  sortColumn: null,
  sortDirection: 'asc',
  isLoading: false,
  error: null,
  editingCell: null,
  rowDisplayStart: 0,
  rowDisplayLimit: null,
  hiddenColumns: new Set(),
  activeEnrichmentJobs: new Map(),

  setCurrentTable: (table) => set({ currentTable: table }),

  setColumns: (columns) => set({ columns }),

  setRows: (rows) => set({ rows }),

  addColumn: (column) =>
    set((state) => ({
      columns: [...state.columns, column],
    })),

  updateColumn: (id, updates) =>
    set((state) => ({
      columns: state.columns.map((col) =>
        col.id === id ? { ...col, ...updates } : col
      ),
    })),

  deleteColumn: (id) =>
    set((state) => ({
      columns: state.columns.filter((col) => col.id !== id),
      rows: state.rows.map((row) => {
        const newData = { ...row.data };
        delete newData[id];
        return { ...row, data: newData };
      }),
    })),

  reorderColumns: (columnIds) =>
    set((state) => ({
      columns: columnIds.map((id, index) => {
        const col = state.columns.find((c) => c.id === id);
        return col ? { ...col, order: index } : col;
      }).filter(Boolean) as Column[],
    })),

  addRow: (row) =>
    set((state) => ({
      rows: [...state.rows, row],
    })),

  updateRow: (id, data) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.id === id ? { ...row, data } : row
      ),
    })),

  updateCell: (rowId, columnId, value) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.id === rowId
          ? { ...row, data: { ...row.data, [columnId]: value } }
          : row
      ),
    })),

  deleteRows: (ids) =>
    set((state) => ({
      rows: state.rows.filter((row) => !ids.includes(row.id)),
      selectedRows: new Set(),
    })),

  selectCell: (rowId, columnId, multi = false) =>
    set((state) => {
      const key = `${rowId}:${columnId}`;
      const newSelection = multi ? new Set(state.selectedCells) : new Set<string>();
      if (newSelection.has(key)) {
        newSelection.delete(key);
      } else {
        newSelection.add(key);
      }
      return { selectedCells: newSelection, selectedRows: new Set() };
    }),

  selectRow: (rowId, multi = false) =>
    set((state) => {
      const newSelection = multi ? new Set(state.selectedRows) : new Set<string>();
      if (newSelection.has(rowId)) {
        newSelection.delete(rowId);
      } else {
        newSelection.add(rowId);
      }
      return { selectedRows: newSelection, selectedCells: new Set() };
    }),

  clearSelection: () =>
    set({ selectedCells: new Set(), selectedRows: new Set() }),

  setEditingCell: (cell) => set({ editingCell: cell }),

  addFilter: (filter) =>
    set((state) => ({
      filters: [...state.filters.filter((f) => f.columnId !== filter.columnId), filter],
    })),

  removeFilter: (columnId) =>
    set((state) => ({
      filters: state.filters.filter((f) => f.columnId !== columnId),
    })),

  clearFilters: () => set({ filters: [], filterLogic: 'AND' as FilterLogic }),

  toggleFilterLogic: () =>
    set((state) => ({
      filterLogic: state.filterLogic === 'AND' ? 'OR' : 'AND',
    })),

  setShowFilters: (show) => set({ showFilters: show }),

  setSort: (columnId, direction = 'asc') =>
    set((state) => ({
      sortColumn: columnId,
      sortDirection: state.sortColumn === columnId && state.sortDirection === 'asc' ? 'desc' : direction,
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  fetchTable: async (tableId: string, silent?: boolean) => {
    if (!silent) {
      set({ isLoading: true, error: null });
    }
    try {
      const [tableRes, columnsRes, rowsRes] = await Promise.all([
        fetch(`/api/tables/${tableId}`),
        fetch(`/api/columns?tableId=${tableId}`),
        fetch(`/api/rows?tableId=${tableId}`),
      ]);

      if (!tableRes.ok || !columnsRes.ok || !rowsRes.ok) {
        throw new Error('Failed to fetch table data');
      }

      const [table, columns, rows] = await Promise.all([
        tableRes.json(),
        columnsRes.json(),
        rowsRes.json(),
      ]);

      set({
        currentTable: table,
        columns,
        rows,
        isLoading: false,
      });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  // ─── Workbook actions ────────────────────────────────────────────

  fetchWorkbook: async (workbookId: string, sheetId?: string) => {
    set({ isLoading: true, error: null, workbookId });
    try {
      // Fetch all tables (sheets) for this workbook/project
      const res = await fetch(`/api/tables?projectId=${workbookId}`);
      if (!res.ok) throw new Error('Failed to fetch workbook sheets');
      const tables = await res.json();

      const sheets: SheetInfo[] = tables.map((t: Table) => ({
        id: t.id, name: t.name, projectId: workbookId,
      }));

      // Pick which sheet to display
      const targetSheetId = sheetId || sheets[0]?.id;
      set({ sheets, activeSheetId: targetSheetId });

      // Load that sheet's data
      if (targetSheetId) {
        await get().fetchTable(targetSheetId, true);
      }
      set({ isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  switchSheet: async (sheetId: string) => {
    set({ activeSheetId: sheetId, selectedRows: new Set(), selectedCells: new Set(), editingCell: null, filters: [], sortColumn: null });
    await get().fetchTable(sheetId, false);
  },

  addSheet: async (name: string) => {
    const { workbookId, sheets } = get();
    if (!workbookId) return null;
    try {
      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: workbookId, name }),
      });
      if (!res.ok) throw new Error('Failed to create sheet');
      const newTable = await res.json();
      const newSheet: SheetInfo = { id: newTable.id, name: newTable.name, projectId: workbookId };
      set({ sheets: [...sheets, newSheet] });
      // Switch to the new sheet
      await get().switchSheet(newTable.id);
      return newSheet;
    } catch {
      return null;
    }
  },

  renameSheet: async (sheetId: string, name: string) => {
    try {
      await fetch(`/api/tables/${sheetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      set((state) => ({
        sheets: state.sheets.map(s => s.id === sheetId ? { ...s, name } : s),
        currentTable: state.currentTable?.id === sheetId
          ? { ...state.currentTable, name }
          : state.currentTable,
      }));
    } catch { /* */ }
  },

  deleteSheet: async (sheetId: string) => {
    const { sheets, activeSheetId } = get();
    if (sheets.length <= 1) return; // Must keep at least 1 sheet
    try {
      await fetch(`/api/tables/${sheetId}`, { method: 'DELETE' });
      const remaining = sheets.filter(s => s.id !== sheetId);
      set({ sheets: remaining });
      // If we deleted the active sheet, switch to the first remaining
      if (activeSheetId === sheetId && remaining.length > 0) {
        await get().switchSheet(remaining[0].id);
      }
    } catch { /* */ }
  },

  getFilteredRows: () => {
    const { rows, filters, filterLogic, columns } = get();
    if (filters.length === 0) return rows;

    return rows.filter((row) => {
      if (filterLogic === 'AND') {
        return filters.every((filter) => applyFilter(row, filter, columns));
      } else {
        return filters.some((filter) => applyFilter(row, filter, columns));
      }
    });
  },

  getSortedRows: () => {
    const { sortColumn, sortDirection, columns } = get();
    const filteredRows = get().getFilteredRows();

    if (!sortColumn) return filteredRows;

    const column = columns.find((c) => c.id === sortColumn);
    if (!column) return filteredRows;

    return [...filteredRows].sort((a, b) => {
      const aVal = a.data[sortColumn]?.value;
      const bVal = b.data[sortColumn]?.value;

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (column.type === 'number') {
        comparison = Number(aVal) - Number(bVal);
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortDirection === 'desc' ? -comparison : comparison;
    });
  },

  // Row display range actions
  setRowDisplayRange: (start, limit) =>
    set({ rowDisplayStart: start, rowDisplayLimit: limit }),

  resetRowDisplayRange: () =>
    set({ rowDisplayStart: 0, rowDisplayLimit: null }),

  // Column visibility actions
  hideColumn: (columnId) =>
    set((state) => {
      const newHidden = new Set(state.hiddenColumns);
      newHidden.add(columnId);
      return { hiddenColumns: newHidden };
    }),

  showColumn: (columnId) =>
    set((state) => {
      const newHidden = new Set(state.hiddenColumns);
      newHidden.delete(columnId);
      return { hiddenColumns: newHidden };
    }),

  toggleColumnVisibility: (columnId) =>
    set((state) => {
      const newHidden = new Set(state.hiddenColumns);
      if (newHidden.has(columnId)) {
        newHidden.delete(columnId);
      } else {
        newHidden.add(columnId);
      }
      return { hiddenColumns: newHidden };
    }),

  showAllColumns: () => set({ hiddenColumns: new Set() }),

  // Enrichment job actions
  setActiveJob: (columnId, jobId) =>
    set((state) => {
      const newJobs = new Map(state.activeEnrichmentJobs);
      if (jobId === null) {
        newJobs.delete(columnId);
      } else {
        newJobs.set(columnId, jobId);
      }
      return { activeEnrichmentJobs: newJobs };
    }),

  getActiveJobId: (columnId) => get().activeEnrichmentJobs.get(columnId) ?? null,

  // Computed: Get displayed rows (sorted + sliced by range)
  getDisplayedRows: () => {
    const { rowDisplayStart, rowDisplayLimit } = get();
    const sortedRows = get().getSortedRows();

    if (rowDisplayLimit === null) {
      return sortedRows.slice(rowDisplayStart);
    }

    return sortedRows.slice(rowDisplayStart, rowDisplayStart + rowDisplayLimit);
  },

  // Computed: Get visible columns
  getVisibleColumns: () => {
    const { columns, hiddenColumns } = get();
    return columns.filter((col) => !hiddenColumns.has(col.id));
  },
}));

function applyFilter(row: Row, filter: Filter, columns: Column[]): boolean {
  return sharedApplyFilter(row as unknown as Parameters<typeof sharedApplyFilter>[0], filter, columns);
}
