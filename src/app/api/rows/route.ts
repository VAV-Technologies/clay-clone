import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import { applyFilters, sortRows, UnknownFilterColumnError } from '@/lib/filter-utils';
import type { Filter, FilterLogic } from '@/lib/filter-utils';

export const maxDuration = 60;

// GET /api/rows?tableId= - Get rows for a table
// Optional: rowIds= (comma-separated), sortBy=, sortOrder=asc|desc,
//   filters= (JSON array of {columnId, operator, value}), filterLogic=AND|OR
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tableId = searchParams.get('tableId');
    const rowIdsParam = searchParams.get('rowIds');
    const limit = parseInt(searchParams.get('limit') || '100000');
    const offset = parseInt(searchParams.get('offset') || '0');
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

    const totalCount = rows.length;
    const needsSortOrFilter = sortBy || filtersParam;

    if (needsSortOrFilter) {
      // Fetch columns for type-aware sort/filter
      const columns = await db
        .select()
        .from(schema.columns)
        .where(eq(schema.columns.tableId, tableId));

      // Apply filters
      if (filtersParam) {
        let filters: Filter[];
        try {
          filters = JSON.parse(filtersParam);
        } catch {
          return NextResponse.json({ error: 'Invalid filters JSON' }, { status: 400 });
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

    // Apply pagination after sort/filter
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

    const now = new Date();
    const rowsToInsert = (rowsData || [{}]).map((data: Record<string, unknown>) => ({
      id: generateId(),
      tableId,
      data: data || {},
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

    let updatedCount = 0;
    for (const { id, data } of updates) {
      if (!id || !data) continue;
      const existing = await db.select().from(schema.rows).where(eq(schema.rows.id, id)).limit(1);
      if (existing.length === 0) continue;
      const mergedData = { ...existing[0].data, ...data };
      await db.update(schema.rows).set({ data: mergedData }).where(eq(schema.rows.id, id));
      updatedCount++;
    }

    return NextResponse.json({ success: true, updatedCount });
  } catch (error) {
    console.error('Error bulk updating rows:', error);
    return NextResponse.json({ error: 'Failed to update rows' }, { status: 500 });
  }
}

// DELETE /api/rows - Delete rows (bulk)
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, tableId } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    await db.delete(schema.rows).where(inArray(schema.rows.id, ids));

    // Update table's updatedAt if tableId provided
    if (tableId) {
      await db
        .update(schema.tables)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tables.id, tableId));
    }

    return NextResponse.json({ success: true, deletedCount: ids.length });
  } catch (error) {
    console.error('Error deleting rows:', error);
    return NextResponse.json({ error: 'Failed to delete rows' }, { status: 500 });
  }
}
