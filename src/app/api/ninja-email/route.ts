import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

/**
 * POST /api/ninja-email
 * Creates or gets the output column for ninja email finder
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tableId, outputColumnName } = body;

    if (!tableId || !outputColumnName) {
      return NextResponse.json(
        { error: 'tableId and outputColumnName are required' },
        { status: 400 }
      );
    }

    // Check if column already exists with this name
    const existingColumns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    const existingColumn = existingColumns.find(
      col => col.name.toLowerCase() === outputColumnName.toLowerCase()
    );

    if (existingColumn) {
      return NextResponse.json({ column: existingColumn }, { status: 200 });
    }

    // Create new column
    const maxOrder = existingColumns.length > 0
      ? Math.max(...existingColumns.map(c => c.order))
      : 0;

    const newColumn = {
      id: nanoid(12),
      tableId,
      name: outputColumnName,
      type: 'text' as const,
      order: maxOrder + 1,
      width: 200,
    };

    await db.insert(schema.columns).values(newColumn);

    return NextResponse.json({ column: newColumn }, { status: 201 });

  } catch (error) {
    console.error('Error creating ninja email column:', error);
    return NextResponse.json(
      { error: 'Failed to create column' },
      { status: 500 }
    );
  }
}
