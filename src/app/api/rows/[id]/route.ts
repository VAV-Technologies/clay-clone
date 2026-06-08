import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getColumnIdSet, invalidColumnIds, COLUMN_SCOPE_MESSAGE } from '@/lib/api-validation';

// PATCH /api/rows/[id] - Update row
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { data } = body;

    const [existing] = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    // Reject cell keys that don't belong to this row's table (column-scope guard
    // on the single-row write path — same protection as the bulk endpoints).
    if (data && existing.tableId) {
      const bad = invalidColumnIds(Object.keys(data), await getColumnIdSet(existing.tableId));
      if (bad.length > 0) {
        return NextResponse.json(
          { error: COLUMN_SCOPE_MESSAGE, invalidColumnIds: bad, tableId: existing.tableId },
          { status: 400 }
        );
      }
    }

    // Merge existing data with new data
    const mergedData = { ...existing.data, ...data };

    await db
      .update(schema.rows)
      .set({ data: mergedData })
      .where(eq(schema.rows.id, id));

    // Update table's updatedAt
    if (existing.tableId) {
      await db
        .update(schema.tables)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tables.id, existing.tableId));
    }

    return NextResponse.json({ ...existing, data: mergedData });
  } catch (error) {
    console.error('Error updating row:', error);
    return NextResponse.json({ error: 'Failed to update row' }, { status: 500 });
  }
}

// DELETE /api/rows/[id] - Delete single row
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [existing] = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    await db.delete(schema.rows).where(eq(schema.rows.id, id));

    // Update table's updatedAt
    if (existing.tableId) {
      await db
        .update(schema.tables)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tables.id, existing.tableId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting row:', error);
    return NextResponse.json({ error: 'Failed to delete row' }, { status: 500 });
  }
}
