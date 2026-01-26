import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { listBatchJobs, getBatchStatus, type BatchJobResponse } from '@/lib/azure-batch';

// GET /api/admin/batch-status
// Returns all batch jobs from both Azure and database with comparison
export async function GET() {
  try {
    // Get all Azure batch jobs
    let azureJobs: BatchJobResponse[] = [];
    let azureError: string | null = null;

    try {
      const azureResponse = await listBatchJobs(100);
      azureJobs = azureResponse.data;
    } catch (err) {
      azureError = (err as Error).message;
    }

    // Get all batch jobs from database (not just active ones)
    const dbJobs = await db
      .select({
        job: schema.batchEnrichmentJobs,
        tableName: schema.tables.name,
      })
      .from(schema.batchEnrichmentJobs)
      .leftJoin(schema.tables, eq(schema.batchEnrichmentJobs.tableId, schema.tables.id))
      .orderBy(schema.batchEnrichmentJobs.createdAt);

    // Build Azure job lookup map
    const azureJobMap = new Map(azureJobs.map(j => [j.id, j]));

    // Build comparison report
    const comparison = dbJobs.map(({ job, tableName }) => {
      const azureJob = job.azureBatchId ? azureJobMap.get(job.azureBatchId) : null;

      const isOutOfSync = azureJob && job.status !== 'complete' && job.status !== 'error' && job.status !== 'cancelled' && (
        (azureJob.status === 'completed' && job.status !== 'complete') ||
        (azureJob.status === 'failed' && job.status !== 'error') ||
        (azureJob.status === 'expired' && job.status !== 'error') ||
        (azureJob.status === 'cancelled' && job.status !== 'cancelled')
      );

      return {
        jobId: job.id,
        tableName: tableName || 'Unknown',
        tableId: job.tableId,
        totalRows: job.totalRows,
        createdAt: job.createdAt?.toISOString(),
        submittedAt: job.submittedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        database: {
          status: job.status,
          azureStatus: job.azureStatus,
          azureBatchId: job.azureBatchId,
          processedCount: job.processedCount,
          successCount: job.successCount,
          errorCount: job.errorCount,
          lastError: job.lastError,
        },
        azure: azureJob ? {
          status: azureJob.status,
          requestCounts: azureJob.request_counts,
          createdAt: azureJob.created_at ? new Date(azureJob.created_at * 1000).toISOString() : null,
          expiresAt: azureJob.expires_at ? new Date(azureJob.expires_at * 1000).toISOString() : null,
          completedAt: azureJob.completed_at ? new Date(azureJob.completed_at * 1000).toISOString() : null,
          failedAt: azureJob.failed_at ? new Date(azureJob.failed_at * 1000).toISOString() : null,
          expiredAt: azureJob.expired_at ? new Date(azureJob.expired_at * 1000).toISOString() : null,
          errors: azureJob.errors?.data,
          hasOutputFile: !!azureJob.output_file_id,
          hasErrorFile: !!azureJob.error_file_id,
        } : null,
        isOutOfSync,
        syncIssue: isOutOfSync ? `DB shows '${job.status}' but Azure shows '${azureJob?.status}'` : null,
      };
    });

    // Find stuck jobs (active in DB but expired/failed/completed in Azure)
    const stuckJobs = comparison.filter(c => c.isOutOfSync);

    // Find Azure jobs not in DB (orphaned)
    const dbAzureBatchIds = new Set(dbJobs.map(j => j.job.azureBatchId).filter(Boolean));
    const orphanedAzureJobs = azureJobs.filter(j => !dbAzureBatchIds.has(j.id));

    return NextResponse.json({
      success: true,
      summary: {
        totalDbJobs: dbJobs.length,
        totalAzureJobs: azureJobs.length,
        stuckJobsCount: stuckJobs.length,
        orphanedAzureJobsCount: orphanedAzureJobs.length,
      },
      stuckJobs: stuckJobs.map(j => ({
        jobId: j.jobId,
        tableName: j.tableName,
        totalRows: j.totalRows,
        syncIssue: j.syncIssue,
        dbStatus: j.database.status,
        azureStatus: j.azure?.status,
      })),
      allJobs: comparison,
      orphanedAzureJobs: orphanedAzureJobs.map(j => ({
        id: j.id,
        status: j.status,
        createdAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
        requestCounts: j.request_counts,
      })),
      azureError,
    });

  } catch (error) {
    console.error('Error in batch-status:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to get batch status' },
      { status: 500 }
    );
  }
}
