import { create } from 'zustand';
import type { Table, Column, Row, CellValue } from '@/lib/db/schema';

interface Filter {
  columnId: string;
  operator: FilterOperator;
  value: string | number | [string | number, string | number];
}

type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'between';

interface TableState {
  currentTable: Table | null;
  columns: Column[];
  rows: Row[];
  selectedCells: Set<string>; // Format: "rowId:columnId"
  selectedRows: Set<string>;
  filters: Filter[];
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  isLoading: boolean;
  error: string | null;
  editingCell: { rowId: string; columnId: string } | null;

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
  setSort: (columnId: string | null, direction?: 'asc' | 'desc') => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchTable: (tableId: string) => Promise<void>;

  // Computed
  getFilteredRows: () => Row[];
  getSortedRows: () => Row[];
}

export const useTableStore = create<TableState>((set, get) => ({
  currentTable: null,
  columns: [],
  rows: [],
  selectedCells: new Set(),
  selectedRows: new Set(),
  filters: [],
  sortColumn: null,
  sortDirection: 'asc',
  isLoading: false,
  error: null,
  editingCell: null,

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

  clearFilters: () => set({ filters: [] }),

  setSort: (columnId, direction = 'asc') =>
    set((state) => ({
      sortColumn: columnId,
      sortDirection: state.sortColumn === columnId && state.sortDirection === 'asc' ? 'desc' : direction,
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  fetchTable: async (tableId: string) => {
    set({ isLoading: true, error: null });
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

  getFilteredRows: () => {
    const { rows, filters, columns } = get();
    if (filters.length === 0) return rows;

    return rows.filter((row) =>
      filters.every((filter) => applyFilter(row, filter, columns))
    );
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
}));

function applyFilter(row: Row, filter: Filter, columns: Column[]): boolean {
  const cellValue = row.data[filter.columnId]?.value;
  const column = columns.find((c) => c.id === filter.columnId);

  if (!column) return true;

  const stringValue = cellValue?.toString().toLowerCase() ?? '';
  const filterValue = Array.isArray(filter.value)
    ? filter.value
    : filter.value?.toString().toLowerCase() ?? '';

  switch (filter.operator) {
    case 'equals':
      return stringValue === filterValue;
    case 'not_equals':
      return stringValue !== filterValue;
    case 'contains':
      return stringValue.includes(filterValue as string);
    case 'not_contains':
      return !stringValue.includes(filterValue as string);
    case 'is_empty':
      return !cellValue || stringValue === '';
    case 'is_not_empty':
      return !!cellValue && stringValue !== '';
    case 'starts_with':
      return stringValue.startsWith(filterValue as string);
    case 'ends_with':
      return stringValue.endsWith(filterValue as string);
    case 'greater_than':
      return Number(cellValue) > Number(filter.value);
    case 'less_than':
      return Number(cellValue) < Number(filter.value);
    case 'between':
      if (Array.isArray(filter.value)) {
        const num = Number(cellValue);
        return num >= Number(filter.value[0]) && num <= Number(filter.value[1]);
      }
      return true;
    default:
      return true;
  }
}
