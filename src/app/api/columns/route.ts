import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

// GET /api/columns?tableId= - Get columns for a table
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tableId = searchParams.get('tableId');

    if (!tableId) {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 });
    }

    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId))
      .orderBy(schema.columns.order);

    return NextResponse.json(columns);
  } catch (error) {
    console.error('Error fetching columns:', error);
    return NextResponse.json({ error: 'Failed to fetch columns' }, { status: 500 });
  }
}

// POST /api/columns - Add a new column
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tableId, name, type = 'text', width = 150, enrichmentConfigId } = body;

    if (!tableId || !name) {
      return NextResponse.json({ error: 'tableId and name are required' }, { status: 400 });
    }

    // Get the highest order number
    const existingColumns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    const maxOrder = existingColumns.reduce((max, col) => Math.max(max, col.order), -1);

    const column = {
      id: generateId(),
      tableId,
      name,
      type,
      width,
      order: maxOrder + 1,
      enrichmentConfigId: enrichmentConfigId || null,
    };

    await db.insert(schema.columns).values(column);

    // Update table's updatedAt
    await db
      .update(schema.tables)
      .set({ updatedAt: new Date() })
      .where(eq(schema.tables.id, tableId));

    return NextResponse.json(column, { status: 201 });
  } catch (error) {
    console.error('Error creating column:', error);
    return NextResponse.json({ error: 'Failed to create column' }, { status: 500 });
  }
}
