import { NextRequest, NextResponse } from 'next/server';
import { db, schema, libsqlClient } from '@/lib/db';
import { eq, inArray, or } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import {
  getBatchStatus,
  downloadBatchResults,
  parseBatchResults,
  deleteFile,
  calculateBatchCost,
  isBatchAvailable,
} from '@/lib/azure-batch';

// Vercel function config - extend timeout for batch processing
export const maxDuration = 300; // 5 minutes

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

// GET /api/cron/process-batch - Poll and process batch jobs
export async function GET(request: NextRequest) {
  // Verify cron secret for security (optional but recommended)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Skip auth check if no secret configured (for development)
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isBatchAvailable()) {
    return NextResponse.json({
      success: true,
      message: 'Azure Batch API not configured',
      processed: 0,
    });
  }

  try {
    // Find all active batch jobs
    const activeJobs = await db
      .select()
      .from(schema.batchEnrichmentJobs)
      .where(
        or(
          eq(schema.batchEnrichmentJobs.status, 'submitted'),
          eq(schema.batchEnrichmentJobs.status, 'processing'),
          eq(schema.batchEnrichmentJobs.status, 'downloading')
        )
      );

    if (activeJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active batch jobs',
        processed: 0,
      });
    }

    console.log(`Processing ${activeJobs.length} active batch jobs`);

    const results = [];

    for (const job of activeJobs) {
      try {
        // Skip if no Azure batch ID
        if (!job.azureBatchId) {
          console.warn(`Job ${job.id} has no Azure batch ID`);
          continue;
        }

        // Get current Azure status
        const azureStatus = await getBatchStatus(job.azureBatchId);
        console.log(`Job ${job.id}: Azure status = ${azureStatus.status}`);

        // Update job with latest Azure status
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

        // Handle different Azure statuses
        if (azureStatus.status === 'completed') {
          // Process results
          if (azureStatus.output_file_id) {
            console.log(`Job ${job.id}: Processing results from file ${azureStatus.output_file_id}`);
            const processResult = await processJobResults(job, azureStatus.output_file_id);
            updates.status = 'complete';
            updates.completedAt = new Date();
            updates.totalCost = processResult.totalCost;
            updates.totalInputTokens = processResult.totalInputTokens;
            updates.totalOutputTokens = processResult.totalOutputTokens;
            updates.successCount = processResult.successCount;
            updates.errorCount = processResult.errorCount;
            updates.processedCount = processResult.successCount + processResult.errorCount;

            results.push({
              jobId: job.id,
              status: 'completed',
              processedCount: processResult.successCount + processResult.errorCount,
              successCount: processResult.successCount,
              errorCount: processResult.errorCount,
            });

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
          }
        } else if (azureStatus.status === 'in_progress' || azureStatus.status === 'finalizing' || azureStatus.status === 'validating') {
          updates.status = 'processing';
          results.push({
            jobId: job.id,
            status: 'processing',
            azureStatus: azureStatus.status,
            requestCounts: azureStatus.request_counts,
          });
        } else if (azureStatus.status === 'failed') {
          updates.status = 'error';
          if (azureStatus.errors?.data?.length) {
            updates.lastError = azureStatus.errors.data.map(e => e.message).join('; ');
          } else {
            updates.lastError = 'Batch job failed';
          }

          // Mark all cells as error
          await markJobCellsAsError(job, updates.lastError || 'Batch job failed');

          results.push({
            jobId: job.id,
            status: 'failed',
            error: updates.lastError,
          });
        } else if (azureStatus.status === 'expired') {
          updates.status = 'error';
          updates.lastError = 'Batch job expired (exceeded 24 hour window)';

          // Mark all cells as error
          await markJobCellsAsError(job, updates.lastError);

          results.push({
            jobId: job.id,
            status: 'expired',
            error: updates.lastError,
          });
        } else if (azureStatus.status === 'cancelled' || azureStatus.status === 'cancelling') {
          updates.status = 'cancelled';

          // Mark all cells as error
          await markJobCellsAsError(job, 'Batch job was cancelled');

          results.push({
            jobId: job.id,
            status: 'cancelled',
          });
        }

        // Update job in database
        await db
          .update(schema.batchEnrichmentJobs)
          .set(updates)
          .where(eq(schema.batchEnrichmentJobs.id, job.id));

      } catch (jobError) {
        console.error(`Error processing job ${job.id}:`, jobError);
        results.push({
          jobId: job.id,
          status: 'error',
          error: (jobError as Error).message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
    });

  } catch (error) {
    console.error('Error in batch cron job:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to process batch jobs' },
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

  // Derive row IDs from Azure results - custom_id format is "row-{rowId}"
  const rowIds = results
    .map(r => r.custom_id.startsWith('row-') ? r.custom_id.slice(4) : null)
    .filter((id): id is string => id !== null);

  // Get all rows for this job
  const rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));
  const rowMap = new Map(rows.map(r => [r.id, r]));

  // Process each result - collect updates in memory first
  let successCount = 0;
  let errorCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const rowUpdates: Array<{ id: string; data: Record<string, CellValue> }> = [];

  for (const result of results) {
    // Extract rowId from custom_id (format: "row-{rowId}")
    const rowId = result.custom_id.startsWith('row-') ? result.custom_id.slice(4) : null;
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
      const usage = result.response.body?.usage;
      totalInputTokens += usage?.prompt_tokens || 0;
      totalOutputTokens += usage?.completion_tokens || 0;

      const responseText = result.response.body?.choices?.[0]?.message?.content || '';
      const parsed = parseAIResponse(responseText);
      const inputTokens = usage?.prompt_tokens || 0;
      const outputTokens = usage?.completion_tokens || 0;
      const rowCost = calculateBatchCost(inputTokens, outputTokens);

      updatedData[job.targetColumnId] = {
        value: parsed.displayValue,
        status: 'complete' as const,
        enrichmentData: parsed.structuredData,
        rawResponse: responseText,
        metadata: {
          inputTokens,
          outputTokens,
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

    // Collect update for batching
    rowUpdates.push({ id: rowId, data: updatedData });
  }

  // Execute all updates in batches (much faster than sequential)
  console.log(`Batch updating ${rowUpdates.length} rows for job ${job.id}`);
  await batchUpdateRows(rowUpdates);

  // Log batch group info if applicable
  if (job.batchGroupId && job.batchNumber && job.totalBatches) {
    console.log(`Completed batch ${job.batchNumber}/${job.totalBatches} in group ${job.batchGroupId}`);
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

  // Get all rows for this table that have "request sent" status for the target column
  // (rowMappings is stored empty - we must query and filter instead)
  const allTableRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, job.tableId));

  // Filter to only rows with "request sent" status for this enrichment column
  const rows = allTableRows.filter(row => {
    const data = row.data as Record<string, CellValue> | null;
    if (!data) return false;
    const cellData = data[job.targetColumnId];
    return cellData && cellData.status === 'request sent';
  });

  // Collect all updates in memory first
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
  console.log(`Batch marking ${rowUpdates.length} rows as error for job ${job.id}`);
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
