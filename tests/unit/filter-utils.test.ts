import { describe, it, expect } from 'vitest';
import {
  applyFilters,
  sortRows,
  UnknownFilterColumnError,
  type RowLike,
} from '@/lib/filter-utils';

const columns = [
  { id: 'name', type: 'text' },
  { id: 'age', type: 'number' },
];
const rows: RowLike[] = [
  { data: { name: { value: 'Alice' }, age: { value: 30 } } },
  { data: { name: { value: 'Bob' }, age: { value: 25 } } },
  { data: { name: { value: '' }, age: { value: 40 } } },
];

describe('applyFilters', () => {
  it('contains matches a substring case-insensitively', () => {
    expect(applyFilters(rows, [{ columnId: 'name', operator: 'contains', value: 'ali' }], 'AND', columns)).toHaveLength(1);
  });

  it('is_empty matches blank cells', () => {
    expect(applyFilters(rows, [{ columnId: 'name', operator: 'is_empty', value: '' }], 'AND', columns)).toHaveLength(1);
  });

  it('applies AND logic', () => {
    const out = applyFilters(rows, [
      { columnId: 'name', operator: 'is_not_empty', value: '' },
      { columnId: 'age', operator: 'greater_than', value: 28 },
    ], 'AND', columns);
    expect(out).toHaveLength(1); // Alice only (30, name set)
  });

  it('applies OR logic', () => {
    const out = applyFilters(rows, [
      { columnId: 'name', operator: 'equals', value: 'bob' },
      { columnId: 'age', operator: 'greater_than', value: 35 },
    ], 'OR', columns);
    expect(out).toHaveLength(2); // Bob + the age-40 blank row
  });

  // Locks in the column-ID per-sheet scope guard — the historical silent-wrong-answer
  // trap where a foreign columnId matched every row. Must throw, never match-all.
  it('throws UnknownFilterColumnError for a foreign columnId', () => {
    expect(() =>
      applyFilters(rows, [{ columnId: 'FOREIGN_SHEET_COL', operator: 'contains', value: 'x' }], 'AND', columns),
    ).toThrow(UnknownFilterColumnError);
  });
});

describe('sortRows', () => {
  it('sorts numeric column ascending', () => {
    expect(sortRows(rows, 'age', 'asc', columns).map((r) => r.data.age.value)).toEqual([25, 30, 40]);
  });

  it('throws for an unknown sort column', () => {
    expect(() => sortRows(rows, 'NOPE', 'asc', columns)).toThrow(UnknownFilterColumnError);
  });
});
