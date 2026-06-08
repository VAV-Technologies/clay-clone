import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray, and } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import { applyFilters, sortRows, UnknownFilterColumnError } from '@/lib/filter-utils';
import type { Filter, FilterLogic } from '@/lib/filter-utils';
import { getColumnIdSet, tableExists, invalidColumnIds, COLUMN_SCOPE_MESSAGE } from '@/lib/api-validation';

export const maxDuration = 60;

// Drizzle's inferred shape for a row's JSON `data` column (Record<string, CellValue>).
type RowData = (typeof schema.rows.$inferInsert)['data'];

// GET /api/rows?tableId= - Get rows for a table
// Optional: rowIds= (comma-separated), sortBy=, sortOrder=asc|desc,
//   filters= (JSON array of {columnId, operator, value}), filterLogic=AND|OR
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tableId = searchParams.get('tableId');
    const rowIdsParam = searchParams.get('rowIds');
    // Clamp pagination: a negative/NaN limit must never silently drop rows
    // (raw Array.slice(0,-1) dropped the last row), a negative offset must not
    // yield an empty page. See QA findings C2-007 / C2-008.
    let limit = parseInt(searchParams.get('limit') || '100000', 10);
    if (!Number.isFinite(limit) || limit < 0) limit = 100000;
    let offset = parseInt(searchParams.get('offset') || '0', 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    const sortBy = searchParams.get('sortBy');
    const sortOrder = (searchParams.get('sortOrder') || 'asc') as 'asc' | 'desc';
    const filtersParam = searchParams.get('filters');
    const filterLogic = (searchParams.get('filterLogic') || 'AND') as FilterLogic;

    if (!tableId) {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 });
    }

    // If rowIds provided, filter to only those rows (no sort/filter support)
    if (rowIdsParam) {
      const rowIds = rowIdsParam.split(',').filter(id => id.trim());
      if (rowIds.length > 0) {
        const rows = await db
          .select()
          .from(schema.rows)
          .where(inArray(schema.rows.id, rowIds));
        return NextResponse.json(rows);
      }
    }

    // Fetch all rows for the table
    let rows = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.tableId, tableId));

    // Distinguish "empty table" from "table does not exist" — a typo'd tableId
    // should 404, not masquerade as an empty sheet (QA finding C4-016). The
    // existence check only runs when the result is empty, so the hot path
    // (non-empty tables) pays nothing.
    if (rows.length === 0 && !(await tableExists(tableId))) {
      return NextResponse.json({ error: 'Table not found', tableId }, { status: 404 });
    }

    const totalCount = rows.length;
    const needsSortOrFilter = sortBy || filtersParam;

    if (needsSortOrFilter) {
      // Fetch columns for type-aware sort/filter
      const columns = await db
        .select()
        .from(schema.columns)
        .where(eq(schema.columns.tableId, tableId));

      // Validate filter/sort columnIds against this table's columns BEFORE
      // calling into filter-utils. Doing this inline (not in filter-utils) so
      // the validation lives in the same bundle as the route handler and
      // can't be skipped by stale chunk caching.
      const validColumnIds = new Set(columns.map((c) => c.id));

      // Apply filters
      if (filtersParam) {
        let filters: Filter[];
        try {
          filters = JSON.parse(filtersParam);
        } catch {
          return NextResponse.json({ error: 'Invalid filters JSON' }, { status: 400 });
        }
        const invalidFilterCols = Array.from(
          new Set(filters.map((f) => f.columnId).filter((id) => !validColumnIds.has(id)))
        );
        if (invalidFilterCols.length > 0) {
          return NextResponse.json(
            {
              error: 'Filter references columnId(s) that do not belong to this table. Column IDs are scoped per-table — fetch GET /api/columns?tableId=... for the sheet you are filtering.',
              invalidColumnIds: invalidFilterCols,
              tableId,
            },
            { status: 400 }
          );
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rows = applyFilters(rows as any, filters, filterLogic, columns) as unknown as typeof rows;
        } catch (err) {
          if (err instanceof UnknownFilterColumnError) {
            return NextResponse.json(
              {
                error: 'Filter references columnId(s) that do not belong to this table. Column IDs are scoped per-table — fetch GET /api/columns?tableId=... for the sheet you are filtering.',
                invalidColumnIds: err.columnIds,
                tableId,
              },
              { status: 400 }
            );
          }
          throw err;
        }
      }

      // Apply sorting
      if (sortBy) {
        if (!validColumnIds.has(sortBy)) {
          return NextResponse.json(
            {
              error: 'sortBy references a columnId that does not belong to this table. Column IDs are scoped per-table — fetch GET /api/columns?tableId=... for the sheet you are sorting.',
              invalidColumnIds: [sortBy],
              tableId,
            },
            { status: 400 }
          );
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rows = sortRows(rows as any, sortBy, sortOrder, columns) as unknown as typeof rows;
        } catch (err) {
          if (err instanceof UnknownFilterColumnError) {
            return NextResponse.json(
              {
                error: 'sortBy references a columnId that does not belong to this table. Column IDs are scoped per-table — fetch GET /api/columns?tableId=... for the sheet you are sorting.',
                invalidColumnIds: err.columnIds,
                tableId,
              },
              { status: 400 }
            );
          }
          throw err;
        }
      }
    }

    const filteredCount = rows.length;

    // Apply pagination after sort/filter (limit/offset already clamped above)
    rows = rows.slice(offset, offset + limit);

    const response = NextResponse.json(rows);
    response.headers.set('X-Total-Count', String(totalCount));
    response.headers.set('X-Filtered-Count', String(filteredCount));
    return response;
  } catch (error) {
    console.error('Error fetching rows:', error);
    return NextResponse.json({ error: 'Failed to fetch rows' }, { status: 500 });
  }
}

// POST /api/rows - Add row(s)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tableId, rows: rowsData } = body;

    if (!tableId) {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 });
    }
    if (!(await tableExists(tableId))) {
      return NextResponse.json({ error: 'Table not found', tableId }, { status: 404 });
    }

    // Validate that every cell key is a real column of THIS table, so a foreign
    // or phantom columnId can't silently persist an orphaned, UI-invisible cell
    // (QA finding A-022). Empty rows ({}) are fine.
    const validIds = await getColumnIdSet(tableId);
    const incoming: Record<string, unknown>[] = rowsData || [{}];
    const badKeys = invalidColumnIds(
      incoming.flatMap((d) => Object.keys(d || {})),
      validIds
    );
    if (badKeys.length > 0) {
      return NextResponse.json(
        { error: COLUMN_SCOPE_MESSAGE, invalidColumnIds: badKeys, tableId },
        { status: 400 }
      );
    }

    const now = new Date();
    const rowsToInsert = incoming.map((data: Record<string, unknown>) => ({
      id: generateId(),
      tableId,
      data: (data || {}) as RowData,
      createdAt: now,
    }));

    if (rowsToInsert.length > 0) {
      await db.insert(schema.rows).values(rowsToInsert);
    }

    // Update table's updatedAt
    await db
      .update(schema.tables)
      .set({ updatedAt: now })
      .where(eq(schema.tables.id, tableId));

    return NextResponse.json(rowsToInsert, { status: 201 });
  } catch (error) {
    console.error('Error creating rows:', error);
    return NextResponse.json({ error: 'Failed to create rows' }, { status: 500 });
  }
}

// PATCH /api/rows - Bulk update rows
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { updates } = body as { updates: Array<{ id: string; data: Record<string, unknown> }> };

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: 'updates array is required: [{id, data}]' }, { status: 400 });
    }

    // Load the target rows so we can validate each update's cell keys against
    // the column set of the row's OWN table (QA finding A-023 — the write path
    // accepted foreign columnIds and persisted orphan cells).
    const ids = updates.map((u) => u.id).filter(Boolean);
    const existingRows = ids.length
      ? await db.select().from(schema.rows).where(inArray(schema.rows.id, ids))
      : [];
    const rowById = new Map(existingRows.map((r) => [r.id, r]));

    const colSetCache = new Map<string, Set<string>>();
    const colsFor = async (tid: string) => {
      if (!colSetCache.has(tid)) colSetCache.set(tid, await getColumnIdSet(tid));
      return colSetCache.get(tid)!;
    };

    const allInvalid = new Set<string>();
    for (const u of updates) {
      const r = u.id ? rowById.get(u.id) : undefined;
      if (!r || !u.data || !r.tableId) continue;
      const set = await colsFor(r.tableId);
      for (const k of invalidColumnIds(Object.keys(u.data), set)) allInvalid.add(k);
    }
    if (allInvalid.size > 0) {
      return NextResponse.json(
        { error: COLUMN_SCOPE_MESSAGE, invalidColumnIds: Array.from(allInvalid) },
        { status: 400 }
      );
    }

    let updatedCount = 0;
    for (const { id, data } of updates) {
      if (!id || !data) continue;
      const existing = rowById.get(id);
      if (!existing) continue;
      const mergedData = { ...existing.data, ...data } as RowData;
      await db.update(schema.rows).set({ data: mergedData }).where(eq(schema.rows.id, id));
      updatedCount++;
    }

    return NextResponse.json({ success: true, updatedCount });
  } catch (error) {
    console.error('Error bulk updating rows:', error);
    return NextResponse.json({ error: 'Failed to update rows' }, { status: 500 });
  }
}

// DELETE /api/rows - Delete rows (bulk), scoped to a table
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, tableId } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }
    // Require tableId and scope the delete to it, so a caller can't delete rows
    // of a sheet they didn't specify by guessing ids (QA finding A-015).
    if (!tableId) {
      return NextResponse.json({ error: 'tableId is required to scope the delete' }, { status: 400 });
    }

    // .returning() gives the actual deleted rows so deletedCount is accurate
    // rather than echoing ids.length (QA finding A-016).
    const deleted = await db
      .delete(schema.rows)
      .where(and(inArray(schema.rows.id, ids), eq(schema.rows.tableId, tableId)))
      .returning({ id: schema.rows.id });

    await db
      .update(schema.tables)
      .set({ updatedAt: new Date() })
      .where(eq(schema.tables.id, tableId));

    return NextResponse.json({ success: true, deletedCount: deleted.length });
  } catch (error) {
    console.error('Error deleting rows:', error);
    return NextResponse.json({ error: 'Failed to delete rows' }, { status: 500 });
  }
}
