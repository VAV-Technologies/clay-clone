import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const columnId = params.id;

    // Get column info
    const [column] = await db.select().from(schema.columns).where(eq(schema.columns.id, columnId)).limit(1);
    if (!column) {
      return NextResponse.json({ error: 'Column not found' }, { status: 404 });
    }

    // Get all rows for this column's table
    const rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, column.tableId));

    // Count cell statuses
    const statuses = { complete: 0, processing: 0, pending: 0, error: 0, batch_submitted: 0, batch_processing: 0, empty: 0 };
    const errorSamples: Array<{ rowId: string; error: string }> = [];

    for (const row of rows) {
      const cell = (row.data as Record<string, CellValue>)[columnId];
      if (!cell || (!cell.value && !cell.status)) {
        statuses.empty++;
      } else if (cell.status === 'complete') {
        statuses.complete++;
      } else if (cell.status === 'processing') {
        statuses.processing++;
      } else if (cell.status === 'pending') {
        statuses.pending++;
      } else if (cell.status === 'error') {
        statuses.error++;
        if (errorSamples.length < 5) {
          errorSamples.push({ rowId: row.id, error: cell.error || 'Unknown error' });
        }
      } else if (cell.status === 'batch_submitted') {
        statuses.batch_submitted++;
      } else if (cell.status === 'batch_processing') {
        statuses.batch_processing++;
      } else if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
        statuses.complete++;
      } else {
        statuses.empty++;
      }
    }

    // Find the related enrichment job for timing
    let timing: Record<string, unknown> = {};
    const jobs = await db.select().from(schema.enrichmentJobs)
      .where(eq(schema.enrichmentJobs.targetColumnId, columnId));
    const activeJob = jobs.find(j => j.status === 'pending' || j.status === 'running');
    const latestJob = jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    const relevantJob = activeJob || latestJob;
    if (relevantJob && relevantJob.processedCount > 0) {
      const elapsedMs = Date.now() - relevantJob.createdAt.getTime();
      const elapsedSeconds = Math.round(elapsedMs / 1000);
      const totalRows = relevantJob.rowIds?.length || rows.length;
      const remaining = totalRows - relevantJob.processedCount;
      const msPerRow = elapsedMs / relevantJob.processedCount;
      const rowsPerMinute = Math.round((relevantJob.processedCount / elapsedMs) * 60000);
      const estimatedRemainingSeconds = remaining > 0 ? Math.round((msPerRow * remaining) / 1000) : 0;

      timing = {
        startedAt: relevantJob.createdAt.toISOString(),
        elapsedSeconds,
        rowsPerMinute,
        estimatedRemainingSeconds,
        estimatedCompletionAt: remaining > 0
          ? new Date(Date.now() + msPerRow * remaining).toISOString()
          : null,
      };
    }

    // Also check batch jobs
    const batchJobs = await db.select().from(schema.batchEnrichmentJobs)
      .where(eq(schema.batchEnrichmentJobs.targetColumnId, columnId));
    const activeBatch = batchJobs.find(j => !['complete', 'error', 'cancelled'].includes(j.status));

    if (activeBatch && activeBatch.processedCount > 0) {
      const startTime = activeBatch.submittedAt || activeBatch.createdAt;
      const elapsedMs = Date.now() - startTime.getTime();
      const remaining = activeBatch.totalRows - activeBatch.processedCount;
      const msPerRow = elapsedMs / activeBatch.processedCount;

      timing = {
        startedAt: startTime.toISOString(),
        elapsedSeconds: Math.round(elapsedMs / 1000),
        rowsPerMinute: Math.round((activeBatch.processedCount / elapsedMs) * 60000),
        estimatedRemainingSeconds: remaining > 0 ? Math.round((msPerRow * remaining) / 1000) : 0,
        estimatedCompletionAt: remaining > 0
          ? new Date(Date.now() + msPerRow * remaining).toISOString()
          : null,
        batchStatus: activeBatch.status,
        azureStatus: activeBatch.azureStatus,
      };
    }

    return NextResponse.json({
      columnId,
      columnName: column.name,
      columnType: column.type,
      tableId: column.tableId,
      totalRows: rows.length,
      cellStatuses: statuses,
      timing,
      errors: {
        count: statuses.error,
        samples: errorSamples,
      },
    });
  } catch (error) {
    console.error('Error fetching column progress:', error);
    return NextResponse.json({ error: 'Failed to fetch progress' }, { status: 500 });
  }
}
