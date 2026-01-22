import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

export const maxDuration = 60;

// GET /api/tables?projectId= - Get tables for a project
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const tables = await db
      .select()
      .from(schema.tables)
      .where(eq(schema.tables.projectId, projectId));

    return NextResponse.json(tables);
  } catch (error) {
    console.error('Error fetching tables:', error);
    return NextResponse.json({ error: 'Failed to fetch tables' }, { status: 500 });
  }
}

// POST /api/tables - Create a new table
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, name, columns: initialColumns } = body;

    if (!projectId || !name) {
      return NextResponse.json({ error: 'projectId and name are required' }, { status: 400 });
    }

    const now = new Date();
    const tableId = generateId();

    // Create the table
    const table = {
      id: tableId,
      projectId,
      name,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.tables).values(table);

    // Create default columns if none provided
    const columnsToCreate = initialColumns || [
      { name: 'Name', type: 'text' },
      { name: 'Email', type: 'email' },
      { name: 'Company', type: 'text' },
    ];

    const columns = columnsToCreate.map((col: { name: string; type: string }, index: number) => ({
      id: generateId(),
      tableId,
      name: col.name,
      type: col.type,
      width: 150,
      order: index,
    }));

    if (columns.length > 0) {
      await db.insert(schema.columns).values(columns);
    }

    return NextResponse.json({ ...table, columns }, { status: 201 });
  } catch (error) {
    console.error('Error creating table:', error);
    return NextResponse.json({ error: 'Failed to create table' }, { status: 500 });
  }
}
