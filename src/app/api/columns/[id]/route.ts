import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

// PATCH /api/columns/[id] - Update column
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, type, width, order } = body;

    const [existing] = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Column not found' }, { status: 404 });
    }

    const updates: Partial<typeof schema.columns.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (width !== undefined) updates.width = width;
    if (order !== undefined) updates.order = order;

    await db.update(schema.columns).set(updates).where(eq(schema.columns.id, id));

    // Update table's updatedAt
    if (existing.tableId) {
      await db
        .update(schema.tables)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tables.id, existing.tableId));
    }

    return NextResponse.json({ ...existing, ...updates });
  } catch (error) {
    console.error('Error updating column:', error);
    return NextResponse.json({ error: 'Failed to update column' }, { status: 500 });
  }
}

// DELETE /api/columns/[id] - Delete column
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [existing] = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Column not found' }, { status: 404 });
    }

    // Delete the column
    await db.delete(schema.columns).where(eq(schema.columns.id, id));

    // Update table's updatedAt
    if (existing.tableId) {
      await db
        .update(schema.tables)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tables.id, existing.tableId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting column:', error);
    return NextResponse.json({ error: 'Failed to delete column' }, { status: 500 });
  }
}
