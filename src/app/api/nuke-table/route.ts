import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// GET /api/nuke-table?id=xxx - Delete a table completely
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tableId = searchParams.get('id');

  if (!tableId) {
    return NextResponse.json({ error: 'Table ID required' }, { status: 400 });
  }

  try {
    // Delete all enrichment jobs for this table
    await db.delete(schema.enrichmentJobs).where(eq(schema.enrichmentJobs.tableId, tableId));

    // Delete all rows
    await db.delete(schema.rows).where(eq(schema.rows.tableId, tableId));

    // Delete all columns
    await db.delete(schema.columns).where(eq(schema.columns.tableId, tableId));

    // Delete the table itself
    await db.delete(schema.tables).where(eq(schema.tables.id, tableId));

    return NextResponse.json({ success: true, message: `Table ${tableId} completely deleted` });
  } catch (error) {
    console.error('Error nuking table:', error);
    return NextResponse.json({ error: 'Failed to delete table', details: String(error) }, { status: 500 });
  }
}
