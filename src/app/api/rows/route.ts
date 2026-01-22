import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

export const maxDuration = 60;

// GET /api/rows?tableId= - Get rows for a table
// Optional: rowIds= to filter specific rows (comma-separated)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tableId = searchParams.get('tableId');
    const rowIdsParam = searchParams.get('rowIds');
    // Support up to 100k rows - no artificial limit
    const limit = parseInt(searchParams.get('limit') || '100000');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!tableId) {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 });
    }

    // If rowIds provided, filter to only those rows
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

    const rows = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.tableId, tableId))
      .limit(limit)
      .offset(offset);

    return NextResponse.json(rows);
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
