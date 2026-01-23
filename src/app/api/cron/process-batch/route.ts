import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray, or, and, ne } from 'drizzle-orm';
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

    await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, rowId));
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

  // Update each row
  for (const row of rows) {
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

    await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
  }
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
