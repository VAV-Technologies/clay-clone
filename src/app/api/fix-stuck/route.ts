import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, like } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

// GET /api/fix-stuck - Fix stuck processing cells
export async function GET() {
  try {
    // 1. Cancel all active jobs
    await db.update(schema.enrichmentJobs)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(or(
        eq(schema.enrichmentJobs.status, 'pending'),
        eq(schema.enrichmentJobs.status, 'running')
      ));

    // 2. Find all rows and fix stuck processing cells
    const allRows = await db.select().from(schema.rows);
    let fixedCount = 0;

    for (const row of allRows) {
      const data = row.data as Record<string, CellValue>;
      let hasStuck = false;

      for (const [colId, cell] of Object.entries(data)) {
        if (cell && cell.status === 'processing') {
          hasStuck = true;
          data[colId] = { ...cell, status: 'pending' };
        }
      }

      if (hasStuck) {
        await db.update(schema.rows).set({ data }).where(eq(schema.rows.id, row.id));
        fixedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Cancelled all jobs and fixed ${fixedCount} rows with stuck processing cells`
    });
  } catch (error) {
    console.error('Error fixing stuck cells:', error);
    return NextResponse.json({ error: 'Failed to fix stuck cells' }, { status: 500 });
  }
}
