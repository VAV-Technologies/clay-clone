import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

export const maxDuration = 60;

// POST /api/admin/migrate-folder-tables
// One-shot migration: wraps every legacy table that lives directly under a
// folder-type project in a new workbook project, so the data model is
// folder → workbook → sheet across the board. Idempotent — running it again
// after migration finds nothing to do.
//
// Auth: requires Authorization: Bearer ${DATAFLOW_API_KEY} (the /api/admin
// prefix is exempt from middleware auth, so we enforce it manually here).
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const validKey = process.env.DATAFLOW_API_KEY;
  if (!validKey || authHeader !== `Bearer ${validKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const folders = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.type, 'folder'));

    if (folders.length === 0) {
      return NextResponse.json({ migratedTables: 0, createdWorkbooks: 0, folders: 0 });
    }

    const folderIds = folders.map((f) => f.id);

    const orphanTables = await db
      .select()
      .from(schema.tables)
      .where(inArray(schema.tables.projectId, folderIds));

    let createdWorkbooks = 0;

    for (const table of orphanTables) {
      if (!table.projectId) continue;

      const now = new Date();
      const newWorkbookId = generateId();

      await db.insert(schema.projects).values({
        id: newWorkbookId,
        name: table.name,
        parentId: table.projectId,
        type: 'workbook',
        createdAt: now,
        updatedAt: now,
      });

      await db
        .update(schema.tables)
        .set({ projectId: newWorkbookId, updatedAt: now })
        .where(eq(schema.tables.id, table.id));

      createdWorkbooks += 1;
    }

    return NextResponse.json({
      folders: folders.length,
      migratedTables: orphanTables.length,
      createdWorkbooks,
    });
  } catch (error) {
    console.error('Error in migrate-folder-tables:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Migration failed' },
      { status: 500 }
    );
  }
}
