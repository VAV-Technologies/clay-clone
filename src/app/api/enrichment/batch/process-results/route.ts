import { NextRequest, NextResponse } from 'next/server';
import { db, schema, libsqlClient } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import {
  downloadBatchResults,
  parseBatchResults,
  deleteFile,
  calculateBatchCost,
  type BatchResultLine,
} from '@/lib/azure-batch';

// Vercel function config - extend timeout for downloading results
export const maxDuration = 120;

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

// POST /api/enrichment/batch/process-results - Process completed batch results
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Get job
    const [job] = await db
      .select()
      .from(schema.batchEnrichmentJobs)
      .where(eq(schema.batchEnrichmentJobs.id, jobId));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Check if job has output file
    if (!job.azureOutputFileId) {
      return NextResponse.json(
        { error: 'Job has no output file yet' },
        { status: 400 }
      );
    }

    // Get config for output columns
    const [config] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, job.configId));

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    // Get columns
    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, job.tableId));

    // Build output column ID map
    const outputColumnIds: Record<string, string> = {};
    const definedOutputColumns = config.outputColumns as string[] | null;

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
    console.log(`Downloading batch results for job ${jobId}`);
    const resultsContent = await downloadBatchResults(job.azureOutputFileId);
    const results = parseBatchResults(resultsContent);

    // Get row mappings
    const rowMappings = job.rowMappings as Array<{ rowId: string; customId: string }>;
    const customIdToRowId = new Map(rowMappings.map(m => [m.customId, m.rowId]));

    // Get all rows for this job
    const rowIds = rowMappings.map(m => m.rowId);
    const rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));
    const rowMap = new Map(rows.map(r => [r.id, r]));

    // Process each result - collect updates in memory first
    let successCount = 0;
    let errorCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const rowUpdates: Array<{ id: string; data: Record<string, CellValue> }> = [];

    for (const result of results) {
      const rowId = customIdToRowId.get(result.custom_id);
      if (!rowId) {
        console.warn(`No row mapping for custom_id: ${result.custom_id}`);
        continue;
      }

      const row = rowMap.get(rowId);
      if (!row) {
        console.warn(`Row not found: ${rowId}`);
        continue;
      }

      const updatedData: Record<string, CellValue> = {
        ...(row.data as Record<string, CellValue>),
      };

      if (result.error) {
        // Handle error result
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
        // Handle success result
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
            timeTakenMs: 0, // Batch doesn't have per-row timing
            totalCost: rowCost,
          },
        };

        // Populate output columns
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
    console.log(`Batch updating ${rowUpdates.length} rows for job ${jobId}`);
    await batchUpdateRows(rowUpdates);

    // Detect orphaned rows (in rowMappings but not returned by Azure - happens when > 25,000 rows submitted)
    const processedRowIds = new Set(rowUpdates.map(u => u.id));
    const allMappedRowIds = rowMappings.map(m => m.rowId);
    const orphanedRowIds = allMappedRowIds.filter(id => !processedRowIds.has(id));

    if (orphanedRowIds.length > 0) {
      console.warn(`${orphanedRowIds.length} rows not returned by Azure for job ${jobId} (exceeded 25,000 batch limit)`);

      // Fetch orphaned rows
      const orphanedRows = await db.select().from(schema.rows).where(inArray(schema.rows.id, orphanedRowIds));

      // Mark them as error
      const orphanUpdates = orphanedRows.map(row => {
        const updatedData: Record<string, CellValue> = {
          ...(row.data as Record<string, CellValue>),
          [job.targetColumnId]: {
            value: null,
            status: 'error' as const,
            error: 'Row exceeded Azure batch limit (25,000 max). Please resubmit.',
          },
        };

        // Also mark output columns as error
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

    // Calculate total cost
    const totalCost = calculateBatchCost(totalInputTokens, totalOutputTokens);

    // Update job as complete
    await db
      .update(schema.batchEnrichmentJobs)
      .set({
        status: 'complete',
        processedCount: successCount + errorCount,
        successCount,
        errorCount,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.batchEnrichmentJobs.id, jobId));

    // Clean up Azure files (best effort)
    try {
      if (job.azureFileId) {
        await deleteFile(job.azureFileId);
      }
      if (job.azureOutputFileId) {
        await deleteFile(job.azureOutputFileId);
      }
      if (job.azureErrorFileId) {
        await deleteFile(job.azureErrorFileId);
      }
    } catch (cleanupError) {
      console.error('Failed to clean up Azure files:', cleanupError);
    }

    return NextResponse.json({
      success: true,
      jobId,
      processedCount: successCount + errorCount,
      successCount,
      errorCount,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
    });

  } catch (error) {
    console.error('Error processing batch results:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to process batch results' },
      { status: 500 }
    );
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

  // Try direct JSON parse
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

  // Try markdown code blocks
  const jsonBlockPatterns = [
    /```json\s*([\s\S]*?)```/i,
    /```JSON\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
    /~~~json\s*([\s\S]*?)~~~/i,
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

  // Try inline JSON with balanced braces
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

  // Fallback: wrap as plain text
  return {
    displayValue: cleanedResponse,
    structuredData: { result: cleanedResponse },
  };
}
