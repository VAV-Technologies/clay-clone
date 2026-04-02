import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function calculateETA(startedAt: Date, processedCount: number, totalCount: number) {
  if (processedCount === 0) return { elapsedSeconds: 0, estimatedRemainingSeconds: null, rowsPerMinute: 0, estimatedCompletionAt: null };

  const elapsedMs = Date.now() - startedAt.getTime();
  const elapsedSeconds = Math.round(elapsedMs / 1000);
  const msPerRow = elapsedMs / processedCount;
  const remainingRows = totalCount - processedCount;
  const estimatedRemainingMs = msPerRow * remainingRows;
  const estimatedRemainingSeconds = Math.round(estimatedRemainingMs / 1000);
  const rowsPerMinute = Math.round((processedCount / elapsedMs) * 60000);
  const estimatedCompletionAt = new Date(Date.now() + estimatedRemainingMs).toISOString();

  return { elapsedSeconds, estimatedRemainingSeconds, rowsPerMinute, estimatedCompletionAt };
}

export async function GET(request: NextRequest) {
  try {
    const tableIdFilter = request.nextUrl.searchParams.get('tableId');
    const columnIdFilter = request.nextUrl.searchParams.get('columnId');

    // Fetch enrichment jobs (active + recently completed)
    const enrichmentJobs = await db.select().from(schema.enrichmentJobs);
    const activeEnrichment = enrichmentJobs.filter(j => j.status === 'pending' || j.status === 'running');
    const recentEnrichment = enrichmentJobs
      .filter(j => j.status === 'complete' || j.status === 'error')
      .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))
      .slice(0, 10);

    // Fetch batch jobs (active + recently completed)
    const batchJobs = await db.select().from(schema.batchEnrichmentJobs);
    const activeBatch = batchJobs.filter(j =>
      !['complete', 'error', 'cancelled'].includes(j.status)
    );
    const recentBatch = batchJobs
      .filter(j => ['complete', 'error', 'cancelled'].includes(j.status))
      .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))
      .slice(0, 10);

    // Get table + column names for context
    const allTableIds = new Set([
      ...enrichmentJobs.map(j => j.tableId),
      ...batchJobs.map(j => j.tableId),
    ]);
    const allColumnIds = new Set([
      ...enrichmentJobs.map(j => j.targetColumnId),
      ...batchJobs.map(j => j.targetColumnId),
    ]);

    const tables = allTableIds.size > 0
      ? await db.select().from(schema.tables).where(inArray(schema.tables.id, [...allTableIds]))
      : [];
    const columns = allColumnIds.size > 0
      ? await db.select().from(schema.columns).where(inArray(schema.columns.id, [...allColumnIds]))
      : [];

    const tableMap = Object.fromEntries(tables.map(t => [t.id, t.name]));
    const columnMap = Object.fromEntries(columns.map(c => [c.id, c.name]));

    // Build active jobs list
    const activeJobs = [
      ...activeEnrichment
        .filter(j => !tableIdFilter || j.tableId === tableIdFilter)
        .filter(j => !columnIdFilter || j.targetColumnId === columnIdFilter)
        .map(j => {
          const totalRows = j.rowIds?.length || 0;
          const timing = calculateETA(j.createdAt, j.processedCount, totalRows);
          const costPerRow = j.processedCount > 0 ? j.totalCost / j.processedCount : 0;

          return {
            id: j.id,
            type: 'enrichment' as const,
            tableId: j.tableId,
            tableName: tableMap[j.tableId] || 'Unknown',
            columnId: j.targetColumnId,
            columnName: columnMap[j.targetColumnId] || 'Unknown',
            status: j.status,
            progress: {
              total: totalRows,
              completed: j.processedCount,
              errors: j.errorCount,
              pending: totalRows - j.processedCount,
              percentComplete: totalRows > 0 ? Math.round((j.processedCount / totalRows) * 1000) / 10 : 0,
            },
            timing: {
              startedAt: j.createdAt.toISOString(),
              ...timing,
            },
            cost: {
              totalSoFar: Math.round(j.totalCost * 10000) / 10000,
              estimatedTotal: totalRows > 0 ? Math.round(costPerRow * totalRows * 10000) / 10000 : 0,
              costPerRow: Math.round(costPerRow * 1000000) / 1000000,
            },
          };
        }),
      ...activeBatch
        .filter(j => !tableIdFilter || j.tableId === tableIdFilter)
        .filter(j => !columnIdFilter || j.targetColumnId === columnIdFilter)
        .map(j => {
          const timing = j.submittedAt
            ? calculateETA(j.submittedAt, j.processedCount, j.totalRows)
            : { elapsedSeconds: 0, estimatedRemainingSeconds: null, rowsPerMinute: 0, estimatedCompletionAt: null };
          const costPerRow = j.processedCount > 0 ? j.totalCost / j.processedCount : 0;

          return {
            id: j.id,
            type: 'batch' as const,
            tableId: j.tableId,
            tableName: tableMap[j.tableId] || 'Unknown',
            columnId: j.targetColumnId,
            columnName: columnMap[j.targetColumnId] || 'Unknown',
            status: j.status,
            azureStatus: j.azureStatus,
            progress: {
              total: j.totalRows,
              completed: j.processedCount,
              success: j.successCount,
              errors: j.errorCount,
              pending: j.totalRows - j.processedCount,
              percentComplete: j.totalRows > 0 ? Math.round((j.processedCount / j.totalRows) * 1000) / 10 : 0,
            },
            timing: {
              startedAt: (j.submittedAt || j.createdAt).toISOString(),
              ...timing,
            },
            cost: {
              totalSoFar: Math.round(j.totalCost * 10000) / 10000,
              estimatedTotal: j.totalRows > 0 ? Math.round(costPerRow * j.totalRows * 10000) / 10000 : 0,
              costPerRow: Math.round(costPerRow * 1000000) / 1000000,
            },
            batch: j.batchGroupId ? {
              groupId: j.batchGroupId,
              batchNumber: j.batchNumber,
              totalBatches: j.totalBatches,
            } : undefined,
          };
        }),
    ];

    // Build recent completed list
    const recentCompleted = [
      ...recentEnrichment.map(j => ({
        id: j.id,
        type: 'enrichment' as const,
        tableName: tableMap[j.tableId] || 'Unknown',
        columnName: columnMap[j.targetColumnId] || 'Unknown',
        status: j.status,
        processedCount: j.processedCount,
        errorCount: j.errorCount,
        totalCost: Math.round(j.totalCost * 10000) / 10000,
        completedAt: j.completedAt?.toISOString() || null,
      })),
      ...recentBatch.map(j => ({
        id: j.id,
        type: 'batch' as const,
        tableName: tableMap[j.tableId] || 'Unknown',
        columnName: columnMap[j.targetColumnId] || 'Unknown',
        status: j.status,
        processedCount: j.processedCount,
        errorCount: j.errorCount,
        totalCost: Math.round(j.totalCost * 10000) / 10000,
        completedAt: j.completedAt?.toISOString() || null,
      })),
    ].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 10);

    // Summary
    const totalActive = activeJobs.length;
    const totalRowsProcessing = activeJobs.reduce((s, j) => s + j.progress.total, 0);
    const totalRowsCompleted = activeJobs.reduce((s, j) => s + j.progress.completed, 0);
    const totalErrors = activeJobs.reduce((s, j) => s + j.progress.errors, 0);
    const maxRemaining = activeJobs.reduce((s, j) =>
      Math.max(s, j.timing.estimatedRemainingSeconds || 0), 0);

    return NextResponse.json({
      activeJobs,
      recentCompleted,
      summary: {
        totalActiveJobs: totalActive,
        totalRowsProcessing,
        totalRowsCompleted,
        totalErrors,
        estimatedTimeToAllComplete: maxRemaining || null,
      },
    });
  } catch (error) {
    console.error('Error fetching job status:', error);
    return NextResponse.json({ error: 'Failed to fetch job status' }, { status: 500 });
  }
}
