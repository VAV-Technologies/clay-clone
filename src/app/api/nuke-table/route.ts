import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { collectAzureFileIdsForTable, deleteTableDependents, purgeAzureFiles } from '@/lib/db/cascade';

export const dynamic = 'force-dynamic';

// GET /api/nuke-table?id=xxx - Delete a table completely
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tableId = searchParams.get('id');

  if (!tableId) {
    return NextResponse.json({ error: 'Table ID required' }, { status: 400 });
  }

  try {
    const azureFileIds = await collectAzureFileIdsForTable(db, tableId);

    await db.transaction(async (tx) => {
      // Non-cascading dependents: batch jobs, enrichment jobs, columns, orphaned configs.
      await deleteTableDependents(tx, tableId);
      // Rows and the table itself.
      await tx.delete(schema.rows).where(eq(schema.rows.tableId, tableId));
      await tx.delete(schema.tables).where(eq(schema.tables.id, tableId));
    });

    await purgeAzureFiles(azureFileIds);

    return NextResponse.json({ success: true, message: `Table ${tableId} completely deleted` });
  } catch (error) {
    console.error('Error nuking table:', error);
    return NextResponse.json({ error: 'Failed to delete table', details: String(error) }, { status: 500 });
  }
}
