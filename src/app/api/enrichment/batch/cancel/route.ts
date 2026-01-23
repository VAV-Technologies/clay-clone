import { NextRequest, NextResponse } from 'next/server';
import { db, schema, libsqlClient } from '@/lib/db';
import { eq, and, inArray, or } from 'drizzle-orm';
import { cancelBatchJob } from '@/lib/azure-batch';
import type { CellValue } from '@/lib/db/schema';

// Batch size for chunked updates (Turso supports up to 1000 statements per batch)
const UPDATE_BATCH_SIZE = 1000;
// Number of parallel batch operations
const PARALLEL_BATCHES = 5;

// Helper to batch update rows efficiently using Turso's batch API
async function batchUpdateRows(
  updates: Array<{ id: string; data: Record<string, CellValue> }>
): Promise<void> {
  if (updates.length === 0) return;

  // Use libsqlClient batch for Turso (production) - much faster than individual queries
  if (libsqlClient) {
    // Split updates into chunks
    const chunks: Array<Array<{ id: string; data: Record<string, CellValue> }>> = [];
    for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
      chunks.push(updates.slice(i, i + UPDATE_BATCH_SIZE));
    }

    // Process chunks in parallel groups for maximum throughput
    for (let i = 0; i < chunks.length; i += PARALLEL_BATCHES) {
      const parallelChunks = chunks.slice(i, i + PARALLEL_BATCHES);
      await Promise.all(
        parallelChunks.map(chunk => {
          const statements = chunk.map(({ id, data }) => ({
            sql: 'UPDATE rows SET data = ? WHERE id = ?',
            args: [JSON.stringify(data), id],
          }));
          return libsqlClient!.batch(statements, 'write');
        })
      );
    }
  } else {
    // Fallback for local SQLite - use parallel chunks
    for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
      const chunk = updates.slice(i, i + UPDATE_BATCH_SIZE);
      await Promise.all(
        chunk.map(({ id, data }) =>
          db.update(schema.rows).set({ data }).where(eq(schema.rows.id, id))
        )
      );
    }
  }
}

// DELETE /api/enrichment/batch/cancel - Cancel batch jobs for a column
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const columnId = searchParams.get('columnId');

    if (!columnId) {
      return NextResponse.json(
        { error: 'columnId is required' },
        { status: 400 }
      );
    }

    // Find active batch jobs for this column
    const activeJobs = await db
      .select()
      .from(schema.batchEnrichmentJobs)
      .where(
        and(
          eq(schema.batchEnrichmentJobs.targetColumnId, columnId),
          or(
            eq(schema.batchEnrichmentJobs.status, 'uploading'),
            eq(schema.batchEnrichmentJobs.status, 'submitted'),
            eq(schema.batchEnrichmentJobs.status, 'processing')
          )
        )
      );

    if (activeJobs.length === 0) {
      return NextResponse.json({
        message: 'No active batch jobs found',
        cancelledCount: 0,
      });
    }

    const cancelledJobIds: string[] = [];
    const errors: string[] = [];

    // Cancel each job in Azure and update database
    for (const job of activeJobs) {
      try {
        // Cancel in Azure if we have a batch ID
        if (job.azureBatchId) {
          try {
            await cancelBatchJob(job.azureBatchId);
          } catch (azureError) {
            // Job might already be completed or cancelled, continue anyway
            console.warn(`Azure cancel failed for ${job.azureBatchId}:`, (azureError as Error).message);
          }
        }

        // Update job status in database
        await db
          .update(schema.batchEnrichmentJobs)
          .set({
            status: 'cancelled',
            azureStatus: 'cancelled',
            updatedAt: new Date(),
          })
          .where(eq(schema.batchEnrichmentJobs.id, job.id));

        cancelledJobIds.push(job.id);

        // Get all rows that have cells with batch_submitted status for this job
        const rowMappings = job.rowMappings as Array<{ rowId: string; customId: string }>;
        const rowIds = rowMappings.map(m => m.rowId);

        if (rowIds.length > 0) {
          // Fetch the rows
          const rows = await db
            .select()
            .from(schema.rows)
            .where(inArray(schema.rows.id, rowIds));

          // Prepare updates - only update cells that are batch_submitted, not completed ones
          const rowUpdates = rows
            .filter(row => {
              const cell = row.data[columnId] as CellValue | undefined;
              return cell?.status === 'batch_submitted' || cell?.status === 'batch_processing';
            })
            .map(row => {
              const updatedData: Record<string, CellValue> = { ...row.data as Record<string, CellValue> };

              // Update the target column cell if it's batch_submitted
              const targetCell = updatedData[columnId];
              if (targetCell?.status === 'batch_submitted' || targetCell?.status === 'batch_processing') {
                updatedData[columnId] = {
                  value: null,
                  status: 'error' as const,
                  error: 'Cancelled by user',
                };
              }

              // Also update any output columns that might have batch_submitted status
              for (const [colId, cell] of Object.entries(updatedData)) {
                if (cell && typeof cell === 'object' && 'status' in cell) {
                  const cellValue = cell as CellValue;
                  if (
                    (cellValue.status === 'batch_submitted' || cellValue.status === 'batch_processing') &&
                    cellValue.batchJobId === job.id
                  ) {
                    updatedData[colId] = {
                      value: null,
                      status: 'error' as const,
                      error: 'Cancelled by user',
                    };
                  }
                }
              }

              return { id: row.id, data: updatedData };
            });

          // Execute batch updates
          await batchUpdateRows(rowUpdates);
        }

      } catch (jobError) {
        console.error(`Error cancelling job ${job.id}:`, jobError);
        errors.push(`Failed to cancel job ${job.id}: ${(jobError as Error).message}`);
      }
    }

    return NextResponse.json({
      message: `Cancelled ${cancelledJobIds.length} batch job(s)`,
      cancelledCount: cancelledJobIds.length,
      cancelledJobIds,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('Error cancelling batch jobs:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to cancel batch jobs' },
      { status: 500 }
    );
  }
}
