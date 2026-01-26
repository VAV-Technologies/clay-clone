import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, or, inArray, asc } from 'drizzle-orm';
import { getBatchStatus, isBatchAvailable } from '@/lib/azure-batch';

// GET /api/enrichment/batch/status - Get batch job status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const columnId = searchParams.get('columnId');
    const tableId = searchParams.get('tableId');
    const batchGroupId = searchParams.get('batchGroupId');

    if (!jobId && !columnId && !tableId && !batchGroupId) {
      return NextResponse.json(
        { error: 'jobId, columnId, tableId, or batchGroupId is required' },
        { status: 400 }
      );
    }

    let jobs;

    if (jobId) {
      // Get specific job
      jobs = await db
        .select()
        .from(schema.batchEnrichmentJobs)
        .where(eq(schema.batchEnrichmentJobs.id, jobId));
    } else if (batchGroupId) {
      // Get all jobs in a batch group, ordered by batch number
      jobs = await db
        .select()
        .from(schema.batchEnrichmentJobs)
        .where(eq(schema.batchEnrichmentJobs.batchGroupId, batchGroupId))
        .orderBy(asc(schema.batchEnrichmentJobs.batchNumber));
    } else if (columnId) {
      // Get jobs for a specific column
      jobs = await db
        .select()
        .from(schema.batchEnrichmentJobs)
        .where(eq(schema.batchEnrichmentJobs.targetColumnId, columnId));
    } else if (tableId) {
      // Get all jobs for a table
      jobs = await db
        .select()
        .from(schema.batchEnrichmentJobs)
        .where(eq(schema.batchEnrichmentJobs.tableId, tableId));
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ jobs: [] });
    }

    // Refresh Azure status for active jobs
    const refreshedJobs = await Promise.all(
      jobs.map(async (job) => {
        // Only refresh if job is active and has Azure batch ID
        if (
          job.azureBatchId &&
          ['submitted', 'processing'].includes(job.status) &&
          isBatchAvailable()
        ) {
          try {
            const azureStatus = await getBatchStatus(job.azureBatchId);

            // Update local status if changed
            if (azureStatus.status !== job.azureStatus) {
              const updates: Partial<typeof schema.batchEnrichmentJobs.$inferInsert> = {
                azureStatus: azureStatus.status,
                updatedAt: new Date(),
              };

              // Update output file ID if available
              if (azureStatus.output_file_id) {
                updates.azureOutputFileId = azureStatus.output_file_id;
              }
              if (azureStatus.error_file_id) {
                updates.azureErrorFileId = azureStatus.error_file_id;
              }

              // Update request counts
              if (azureStatus.request_counts) {
                updates.processedCount = azureStatus.request_counts.completed + azureStatus.request_counts.failed;
                updates.successCount = azureStatus.request_counts.completed;
                updates.errorCount = azureStatus.request_counts.failed;
              }

              // Map Azure status to internal status
              if (azureStatus.status === 'in_progress' || azureStatus.status === 'finalizing') {
                updates.status = 'processing';
              } else if (azureStatus.status === 'completed') {
                updates.status = 'downloading';
              } else if (azureStatus.status === 'failed' || azureStatus.status === 'expired') {
                updates.status = 'error';
                // Capture error details if available
                if (azureStatus.errors?.data?.length) {
                  updates.lastError = azureStatus.errors.data.map(e => e.message).join('; ');
                }
              } else if (azureStatus.status === 'cancelled' || azureStatus.status === 'cancelling') {
                updates.status = 'cancelled';
              }

              await db
                .update(schema.batchEnrichmentJobs)
                .set(updates)
                .where(eq(schema.batchEnrichmentJobs.id, job.id));

              return {
                ...job,
                ...updates,
                azureRequestCounts: azureStatus.request_counts,
              };
            }

            return {
              ...job,
              azureRequestCounts: azureStatus.request_counts,
            };
          } catch (error) {
            console.error(`Failed to refresh status for job ${job.id}:`, error);
            return job;
          }
        }

        return job;
      })
    );

    // Build job list with new fields
    const jobList = refreshedJobs.map((job) => ({
      id: job.id,
      tableId: job.tableId,
      configId: job.configId,
      targetColumnId: job.targetColumnId,
      azureBatchId: job.azureBatchId,
      azureStatus: job.azureStatus,
      status: job.status,
      totalRows: job.totalRows,
      processedCount: job.processedCount,
      successCount: job.successCount,
      errorCount: job.errorCount,
      totalCost: job.totalCost,
      lastError: job.lastError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      submittedAt: job.submittedAt,
      completedAt: job.completedAt,
      // Batch group fields
      batchGroupId: job.batchGroupId,
      batchNumber: job.batchNumber,
      totalBatches: job.totalBatches,
      azureRequestCounts: (job as Record<string, unknown>).azureRequestCounts,
    }));

    // Calculate batch group stats if this is a batch group query
    let batchGroupStats = null;
    if (batchGroupId && jobList.length > 1) {
      const groupTotalRows = jobList.reduce((sum, j) => sum + j.totalRows, 0);
      const groupProcessedCount = jobList.reduce((sum, j) => sum + j.processedCount, 0);
      const groupSuccessCount = jobList.reduce((sum, j) => sum + j.successCount, 0);
      const groupErrorCount = jobList.reduce((sum, j) => sum + j.errorCount, 0);
      const groupTotalCost = jobList.reduce((sum, j) => sum + j.totalCost, 0);
      const completedBatches = jobList.filter(j => j.status === 'complete').length;
      const errorBatches = jobList.filter(j => j.status === 'error' || j.status === 'cancelled').length;
      const processingBatches = jobList.filter(j => ['submitted', 'processing', 'downloading'].includes(j.status)).length;

      // Determine overall group status
      let groupStatus: string;
      if (completedBatches === jobList.length) {
        groupStatus = 'complete';
      } else if (errorBatches === jobList.length) {
        groupStatus = 'error';
      } else if (processingBatches > 0 || completedBatches > 0) {
        groupStatus = 'processing';
      } else {
        groupStatus = 'submitted';
      }

      batchGroupStats = {
        batchGroupId,
        totalBatches: jobList.length,
        completedBatches,
        errorBatches,
        processingBatches,
        groupStatus,
        groupTotalRows,
        groupProcessedCount,
        groupSuccessCount,
        groupErrorCount,
        groupTotalCost,
      };
    }

    return NextResponse.json({
      jobs: jobList,
      batchGroupStats,
    });
  } catch (error) {
    console.error('Error getting batch status:', error);
    return NextResponse.json(
      { error: 'Failed to get batch status' },
      { status: 500 }
    );
  }
}
