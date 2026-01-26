import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray, sql } from 'drizzle-orm';

// GET /api/admin/batch-debug?jobId=XXX
// Debug endpoint to check batch job and cell states
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    // Get the job directly
    const [job] = await db
      .select()
      .from(schema.batchEnrichmentJobs)
      .where(eq(schema.batchEnrichmentJobs.id, jobId));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get sample rows directly from the table (rowMappings may be empty)
    const sampleRows = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.tableId, job.tableId))
      .limit(10);

    // Extract cell status for target column
    const cellStatuses = sampleRows.map(row => {
      const data = row.data as Record<string, { status?: string; error?: string; value?: unknown }>;
      const targetCell = data[job.targetColumnId];
      return {
        rowId: row.id,
        cellStatus: targetCell?.status,
        cellError: targetCell?.error,
        cellValue: targetCell?.value,
      };
    });

    // Count cell statuses in sample
    const statusCounts: Record<string, number> = {};
    for (const cell of cellStatuses) {
      const status = cell.cellStatus || 'no_data';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    return NextResponse.json({
      jobId: job.id,
      jobStatus: job.status,
      jobLastError: job.lastError,
      jobErrorCount: job.errorCount,
      jobSuccessCount: job.successCount,
      jobProcessedCount: job.processedCount,
      jobRowCount: job.rowCount,
      jobUpdatedAt: job.updatedAt?.toISOString(),
      tableId: job.tableId,
      targetColumnId: job.targetColumnId,
      sampleSize: sampleRows.length,
      sampleStatusCounts: statusCounts,
      sampleCellStatuses: cellStatuses,
    });

  } catch (error) {
    console.error('Error in batch-debug:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to debug batch job' },
      { status: 500 }
    );
  }
}

// POST /api/admin/batch-debug?jobId=XXX - Force update job status
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    // Force update job status
    const result = await db
      .update(schema.batchEnrichmentJobs)
      .set({
        status: 'error',
        lastError: 'Upload failed - exceeded 25,000 row limit. Please split into smaller batches.',
        updatedAt: new Date(),
      })
      .where(eq(schema.batchEnrichmentJobs.id, jobId))
      .returning();

    // Verify the update
    const [job] = await db
      .select()
      .from(schema.batchEnrichmentJobs)
      .where(eq(schema.batchEnrichmentJobs.id, jobId));

    return NextResponse.json({
      updated: result.length > 0,
      jobStatus: job?.status,
      jobLastError: job?.lastError,
    });

  } catch (error) {
    console.error('Error in batch-debug POST:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to update batch job' },
      { status: 500 }
    );
  }
}
