import { NextRequest, NextResponse } from 'next/server';
import { db, schema, libsqlClient } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import {
  getBatchStatus,
  downloadBatchResults,
  parseBatchResults,
  deleteFile,
  calculateBatchCost,
} from '@/lib/azure-batch';

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

// POST /api/admin/batch-force-sync?jobId=XXX
// Force-syncs a stuck job by querying Azure for true status and processing accordingly
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

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

    if (!job.azureBatchId) {
      return NextResponse.json({ error: 'Job has no Azure batch ID' }, { status: 400 });
    }

    // Get current Azure status
    const azureStatus = await getBatchStatus(job.azureBatchId);
    console.log(`Force sync job ${job.id}: Azure status = ${azureStatus.status}`);

    const updates: Partial<typeof schema.batchEnrichmentJobs.$inferInsert> = {
      azureStatus: azureStatus.status,
      updatedAt: new Date(),
    };

    if (azureStatus.output_file_id) {
      updates.azureOutputFileId = azureStatus.output_file_id;
    }
    if (azureStatus.error_file_id) {
      updates.azureErrorFileId = azureStatus.error_file_id;
    }
    if (azureStatus.request_counts) {
      updates.processedCount = azureStatus.request_counts.completed + azureStatus.request_counts.failed;
      updates.successCount = azureStatus.request_counts.completed;
      updates.errorCount = azureStatus.request_counts.failed;
    }

    let result: Record<string, unknown> = {
      jobId: job.id,
      previousDbStatus: job.status,
      azureStatus: azureStatus.status,
    };

    // Handle different Azure statuses
    if (azureStatus.status === 'completed') {
      if (azureStatus.output_file_id) {
        console.log(`Force sync: Processing results from file ${azureStatus.output_file_id}`);
        const processResult = await processJobResults(job, azureStatus.output_file_id);
        updates.status = 'complete';
        updates.completedAt = new Date();
        updates.totalCost = processResult.totalCost;
        updates.totalInputTokens = processResult.totalInputTokens;
        updates.totalOutputTokens = processResult.totalOutputTokens;
        updates.successCount = processResult.successCount;
        updates.errorCount = processResult.errorCount;
        updates.processedCount = processResult.successCount + processResult.errorCount;

        result = {
          ...result,
          action: 'processed_results',
          newStatus: 'complete',
          processedCount: processResult.successCount + processResult.errorCount,
          successCount: processResult.successCount,
          errorCount: processResult.errorCount,
        };

        // Clean up Azure files
        try {
          if (job.azureFileId) await deleteFile(job.azureFileId);
          if (azureStatus.output_file_id) await deleteFile(azureStatus.output_file_id);
          if (azureStatus.error_file_id) await deleteFile(azureStatus.error_file_id);
        } catch (cleanupError) {
          console.error(`Failed to clean up files for job ${job.id}:`, cleanupError);
        }
      } else {
        updates.status = 'error';
        updates.lastError = 'Batch completed but no output file available';
        result = {
          ...result,
          action: 'marked_error',
          newStatus: 'error',
          error: updates.lastError,
        };
      }
    } else if (azureStatus.status === 'failed') {
      updates.status = 'error';
      if (azureStatus.errors?.data?.length) {
        updates.lastError = azureStatus.errors.data.map(e => e.message).join('; ');
      } else {
        updates.lastError = 'Batch job failed';
      }

      await markJobCellsAsError(job, updates.lastError || 'Batch job failed');

      result = {
        ...result,
        action: 'marked_cells_error',
        newStatus: 'error',
        error: updates.lastError,
      };
    } else if (azureStatus.status === 'expired') {
      updates.status = 'error';
      updates.lastError = 'Batch job expired (exceeded 24 hour window)';

      await markJobCellsAsError(job, updates.lastError);

      result = {
        ...result,
        action: 'marked_cells_error',
        newStatus: 'error',
        error: updates.lastError,
      };
    } else if (azureStatus.status === 'cancelled' || azureStatus.status === 'cancelling') {
      updates.status = 'cancelled';

      await markJobCellsAsError(job, 'Batch job was cancelled');

      result = {
        ...result,
        action: 'marked_cells_error',
        newStatus: 'cancelled',
      };
    } else {
      // Still in progress
      updates.status = 'processing';
      result = {
        ...result,
        action: 'updated_status',
        newStatus: 'processing',
        requestCounts: azureStatus.request_counts,
      };
    }

    // Update job in database
    await db
      .update(schema.batchEnrichmentJobs)
      .set(updates)
      .where(eq(schema.batchEnrichmentJobs.id, job.id));

    return NextResponse.json({
      success: true,
      result,
    });

  } catch (error) {
    console.error('Error in batch-force-sync:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to force sync batch job' },
      { status: 500 }
    );
  }
}

async function processJobResults(
  job: typeof schema.batchEnrichmentJobs.$inferSelect,
  outputFileId: string
) {
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

  const hasOutputColumns = Object.keys(outputColumnIds).length > 0;

  // Download results
  const resultsContent = await downloadBatchResults(outputFileId);
  const results = parseBatchResults(resultsContent);

  // Get row mappings
  const rowMappings = job.rowMappings as Array<{ rowId: string; customId: string }>;
  const customIdToRowId = new Map(rowMappings.map(m => [m.customId, m.rowId]));

  // Get all rows for this job
  const rowIds = rowMappings.map(m => m.rowId);
  const rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));
  const rowMap = new Map(rows.map(r => [r.id, r]));

  // Process each result
  let successCount = 0;
  let errorCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const rowUpdates: Array<{ id: string; data: Record<string, CellValue> }> = [];

  for (const result of results) {
    const rowId = customIdToRowId.get(result.custom_id);
    if (!rowId) continue;

    const row = rowMap.get(rowId);
    if (!row) continue;

    const updatedData: Record<string, CellValue> = {
      ...(row.data as Record<string, CellValue>),
    };

    if (result.error) {
      errorCount++;
      updatedData[job.targetColumnId] = {
        value: null,
        status: 'error' as const,
        error: result.error.message || result.error.code,
      };

      for (const colId of Object.values(outputColumnIds)) {
        updatedData[colId] = {
          value: null,
          status: 'error' as const,
          error: result.error.message || result.error.code,
        };
      }
    } else if (result.response) {
      successCount++;
      const usage = result.response.body.usage;
      totalInputTokens += usage.prompt_tokens;
      totalOutputTokens += usage.completion_tokens;

      const responseText = result.response.body.choices[0]?.message?.content || '';
      const parsed = parseAIResponse(responseText);
      const rowCost = calculateBatchCost(usage.prompt_tokens, usage.completion_tokens);

      updatedData[job.targetColumnId] = {
        value: parsed.displayValue,
        status: 'complete' as const,
        enrichmentData: parsed.structuredData,
        rawResponse: responseText,
        metadata: {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          timeTakenMs: 0,
          totalCost: rowCost,
        },
      };

      if (hasOutputColumns && parsed.structuredData) {
        for (const [outputName, columnId] of Object.entries(outputColumnIds)) {
          const matchingKey = Object.keys(parsed.structuredData).find(
            key => key.toLowerCase() === outputName
          );

          if (matchingKey) {
            const value = parsed.structuredData[matchingKey];
            updatedData[columnId] = {
              value: value !== null && value !== undefined ? String(value) : null,
              status: 'complete' as const,
            };
          } else {
            updatedData[columnId] = {
              value: null,
              status: 'complete' as const,
            };
          }
        }
      }
    }

    rowUpdates.push({ id: rowId, data: updatedData });
  }

  // Execute all updates in batches
  console.log(`Force sync: Batch updating ${rowUpdates.length} rows for job ${job.id}`);
  await batchUpdateRows(rowUpdates);

  // Handle orphaned rows (not returned by Azure)
  const processedRowIds = new Set(rowUpdates.map(u => u.id));
  const allMappedRowIds = rowMappings.map(m => m.rowId);
  const orphanedRowIds = allMappedRowIds.filter(id => !processedRowIds.has(id));

  if (orphanedRowIds.length > 0) {
    console.warn(`Force sync: ${orphanedRowIds.length} rows not returned by Azure for job ${job.id}`);

    const orphanedRows = await db.select().from(schema.rows).where(inArray(schema.rows.id, orphanedRowIds));

    const orphanUpdates = orphanedRows.map(row => {
      const updatedData: Record<string, CellValue> = {
        ...(row.data as Record<string, CellValue>),
        [job.targetColumnId]: {
          value: null,
          status: 'error' as const,
          error: 'Row exceeded Azure batch limit (25,000 max). Please resubmit.',
        },
      };

      for (const colId of Object.values(outputColumnIds)) {
        updatedData[colId] = {
          value: null,
          status: 'error' as const,
          error: 'Row exceeded Azure batch limit (25,000 max). Please resubmit.',
        };
      }

      return { id: row.id, data: updatedData };
    });

    await batchUpdateRows(orphanUpdates);
    errorCount += orphanedRowIds.length;
  }

  const totalCost = calculateBatchCost(totalInputTokens, totalOutputTokens);

  return {
    successCount,
    errorCount,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
  };
}

async function markJobCellsAsError(
  job: typeof schema.batchEnrichmentJobs.$inferSelect,
  errorMessage: string
) {
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
  console.log(`Force sync: Marking ${rowUpdates.length} rows as error for job ${job.id}`);
  await batchUpdateRows(rowUpdates);
}

interface ParsedAIResponse {
  displayValue: string;
  structuredData: Record<string, string | number | null> | undefined;
}

function parseAIResponse(response: string): ParsedAIResponse {
  const cleanedResponse = response.trim();

  const toStructuredData = (parsed: Record<string, unknown>): Record<string, string | number | null> => {
    const result: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) {
        result[key] = null;
      } else if (typeof value === 'string' || typeof value === 'number') {
        result[key] = value;
      } else if (Array.isArray(value)) {
        result[key] = value.map(v => String(v ?? '')).join(', ');
      } else if (typeof value === 'object') {
        result[key] = JSON.stringify(value);
      } else {
        result[key] = String(value);
      }
    }
    return result;
  };

  try {
    const parsed = JSON.parse(cleanedResponse);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const structuredData = toStructuredData(parsed);
      const dataCount = Object.keys(structuredData).length;
      return {
        displayValue: dataCount === 1
          ? String(Object.values(structuredData)[0] ?? '')
          : `${dataCount} datapoints`,
        structuredData,
      };
    }
  } catch {
    // Not valid JSON
  }

  const jsonBlockPatterns = [
    /```json\s*([\s\S]*?)```/i,
    /```\s*([\s\S]*?)```/,
  ];

  for (const pattern of jsonBlockPatterns) {
    const match = cleanedResponse.match(pattern);
    if (match) {
      const content = match[1].trim();
      if (content.startsWith('{')) {
        try {
          const parsed = JSON.parse(content);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const structuredData = toStructuredData(parsed);
            const dataCount = Object.keys(structuredData).length;
            return {
              displayValue: dataCount === 1
                ? String(Object.values(structuredData)[0] ?? '')
                : `${dataCount} datapoints`,
              structuredData,
            };
          }
        } catch {
          // Continue
        }
      }
    }
  }

  const jsonStartIndex = cleanedResponse.indexOf('{');
  if (jsonStartIndex !== -1) {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = jsonStartIndex; i < cleanedResponse.length; i++) {
      const char = cleanedResponse[i];

      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\' && inString) { escapeNext = true; continue; }
      if (char === '"' && !escapeNext) { inString = !inString; continue; }

      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;

        if (braceCount === 0) {
          const jsonStr = cleanedResponse.slice(jsonStartIndex, i + 1);
          try {
            const parsed = JSON.parse(jsonStr);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              const structuredData = toStructuredData(parsed);
              const dataCount = Object.keys(structuredData).length;
              return {
                displayValue: dataCount === 1
                  ? String(Object.values(structuredData)[0] ?? '')
                  : `${dataCount} datapoints`,
                structuredData,
              };
            }
          } catch {
            // Continue
          }
          break;
        }
      }
    }
  }

  return {
    displayValue: cleanedResponse,
    structuredData: { result: cleanedResponse },
  };
}
