import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

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
