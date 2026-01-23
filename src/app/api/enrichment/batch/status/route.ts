import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, or, inArray } from 'drizzle-orm';
import { getBatchStatus, isBatchAvailable } from '@/lib/azure-batch';

// GET /api/enrichment/batch/status - Get batch job status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const columnId = searchParams.get('columnId');
    const tableId = searchParams.get('tableId');

    if (!jobId && !columnId && !tableId) {
      return NextResponse.json(
        { error: 'jobId, columnId, or tableId is required' },
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

    return NextResponse.json({
      jobs: refreshedJobs.map((job) => ({
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
        azureRequestCounts: (job as Record<string, unknown>).azureRequestCounts,
      })),
    });
  } catch (error) {
    console.error('Error getting batch status:', error);
    return NextResponse.json(
      { error: 'Failed to get batch status' },
      { status: 500 }
    );
  }
}
