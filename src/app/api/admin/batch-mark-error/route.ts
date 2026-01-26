import { NextRequest, NextResponse } from 'next/server';
import { db, schema, libsqlClient } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

// Batch size for chunked updates
const UPDATE_BATCH_SIZE = 1000;
const PARALLEL_BATCHES = 5;

// Helper to batch update rows efficiently
async function batchUpdateRows(
  updates: Array<{ id: string; data: Record<string, CellValue> }>
): Promise<void> {
  if (updates.length === 0) return;

  if (libsqlClient) {
    const chunks: Array<Array<{ id: string; data: Record<string, CellValue> }>> = [];
    for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
      chunks.push(updates.slice(i, i + UPDATE_BATCH_SIZE));
    }

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

// POST /api/admin/batch-mark-error?jobId=XXX&error=message
// Marks a stuck job as error (for jobs that never made it to Azure)
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const errorMessage = searchParams.get('error') || 'Job failed during upload - please resubmit';

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    // Get the job from database
    const [job] = await db
      .select()
      .from(schema.batchEnrichmentJobs)
      .where(eq(schema.batchEnrichmentJobs.id, jobId));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get config for output columns
    const [config] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, job.configId));

    // Get columns
    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, job.tableId));

    // Build output column ID map
    const outputColumnIds: Record<string, string> = {};
    const definedOutputColumns = config?.outputColumns as string[] | null;

    if (definedOutputColumns && definedOutputColumns.length > 0) {
      for (const outputColName of definedOutputColumns) {
        const existingCol = columns.find(
          c => c.name.toLowerCase() === outputColName.toLowerCase()
        );
        if (existingCol) {
          outputColumnIds[outputColName.toLowerCase()] = existingCol.id;
        }
      }
    }

    // Get row mappings
    const rowMappings = job.rowMappings as Array<{ rowId: string; customId: string }>;
    const rowIds = rowMappings.map(m => m.rowId);

    // Get all rows
    const rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));

    // Collect all updates
    const rowUpdates = rows.map(row => {
      const updatedData: Record<string, CellValue> = {
        ...(row.data as Record<string, CellValue>),
        [job.targetColumnId]: {
          value: null,
          status: 'error' as const,
          error: errorMessage,
        },
      };

      for (const colId of Object.values(outputColumnIds)) {
        updatedData[colId] = {
          value: null,
          status: 'error' as const,
          error: errorMessage,
        };
      }

      return { id: row.id, data: updatedData };
    });

    // Execute all updates in batches
    console.log(`Marking ${rowUpdates.length} rows as error for job ${job.id}`);
    await batchUpdateRows(rowUpdates);

    // Update job status
    await db
      .update(schema.batchEnrichmentJobs)
      .set({
        status: 'error',
        lastError: errorMessage,
        errorCount: rowUpdates.length,
        updatedAt: new Date(),
      })
      .where(eq(schema.batchEnrichmentJobs.id, job.id));

    return NextResponse.json({
      success: true,
      jobId: job.id,
      rowsMarked: rowUpdates.length,
      errorMessage,
    });

  } catch (error) {
    console.error('Error in batch-mark-error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to mark batch job as error' },
      { status: 500 }
    );
  }
}
