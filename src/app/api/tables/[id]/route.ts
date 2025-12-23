import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

// GET /api/tables/[id] - Get single table with columns
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [table] = await db
      .select()
      .from(schema.tables)
      .where(eq(schema.tables.id, id));

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 });
    }

    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, id))
      .orderBy(schema.columns.order);

    return NextResponse.json({ ...table, columns });
  } catch (error) {
    console.error('Error fetching table:', error);
    return NextResponse.json({ error: 'Failed to fetch table' }, { status: 500 });
  }
}

// PATCH /api/tables/[id] - Update table
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name } = body;

    const [existing] = await db
      .select()
      .from(schema.tables)
      .where(eq(schema.tables.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 });
    }

    const updates = {
      name: name ?? existing.name,
      updatedAt: new Date(),
    };

    await db.update(schema.tables).set(updates).where(eq(schema.tables.id, id));

    return NextResponse.json({ ...existing, ...updates });
  } catch (error) {
    console.error('Error updating table:', error);
    return NextResponse.json({ error: 'Failed to update table' }, { status: 500 });
  }
}

// DELETE /api/tables/[id] - Delete table
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Delete columns
    await db.delete(schema.columns).where(eq(schema.columns.tableId, id));

    // Delete rows
    await db.delete(schema.rows).where(eq(schema.rows.tableId, id));

    // Delete table
    await db.delete(schema.tables).where(eq(schema.tables.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting table:', error);
    return NextResponse.json({ error: 'Failed to delete table' }, { status: 500 });
  }
}
