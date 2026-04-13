export interface Filter {
  columnId: string;
  operator: FilterOperator;
  value: string | number | [string | number, string | number];
}

export type FilterOperator =
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

export type FilterLogic = 'AND' | 'OR';

interface CellValue {
  value?: string | number | null;
  [key: string]: unknown;
}

export interface RowLike {
  data: Record<string, CellValue>;
  [key: string]: unknown;
}

interface ColumnLike {
  id: string;
  type: string;
  [key: string]: unknown;
}

export function applyFilter(row: RowLike, filter: Filter, columns: ColumnLike[]): boolean {
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

export function applyFilters(rows: RowLike[], filters: Filter[], filterLogic: FilterLogic, columns: ColumnLike[]): RowLike[] {
  if (filters.length === 0) return rows;

  return rows.filter((row) => {
    if (filterLogic === 'AND') {
      return filters.every((filter) => applyFilter(row, filter, columns));
    } else {
      return filters.some((filter) => applyFilter(row, filter, columns));
    }
  });
}

export function sortRows(rows: RowLike[], sortColumnId: string, sortDirection: 'asc' | 'desc', columns: ColumnLike[]): RowLike[] {
  const column = columns.find((c) => c.id === sortColumnId);
  if (!column) return rows;

  return [...rows].sort((a, b) => {
    const aVal = a.data[sortColumnId]?.value;
    const bVal = b.data[sortColumnId]?.value;

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
}
