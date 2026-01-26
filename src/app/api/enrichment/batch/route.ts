import { NextRequest, NextResponse } from 'next/server';
import { db, schema, libsqlClient } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { CellValue } from '@/lib/db/schema';
import {
  generateBatchJSONL,
  uploadBatchFile,
  createBatchJob,
  isBatchAvailable,
} from '@/lib/azure-batch';

// Vercel function config - extend timeout for large batch processing
export const maxDuration = 300; // 5 minutes for large batches

// Batch size for chunked updates (Turso supports up to 1000 statements per batch)
const UPDATE_BATCH_SIZE = 1000;
// Number of parallel batch operations
const PARALLEL_BATCHES = 5;

// Azure Batch API limits
const MAX_ROWS_PER_BATCH = 24999;  // Azure limit is 25,000, use safety margin
const MAX_TOTAL_ROWS = 100000;     // Support up to 100K rows (5 batches max)

function generateId() {
  return nanoid(12);
}

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

// POST /api/enrichment/batch - Create a new batch enrichment job
export async function POST(request: NextRequest) {
  try {
    // Check if batch API is available
    if (!isBatchAvailable()) {
      return NextResponse.json(
        { error: 'Azure OpenAI Batch API is not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { configId, tableId, targetColumnId, rowIds, model = 'gpt-4.1-mini' } = body;

    if (!configId || !tableId || !targetColumnId) {
      return NextResponse.json(
        { error: 'configId, tableId, and targetColumnId are required' },
        { status: 400 }
      );
    }

    // Get enrichment config
    const [config] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, configId));

    if (!config) {
      return NextResponse.json({ error: 'Enrichment config not found' }, { status: 404 });
    }

    // Get columns for variable substitution
    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    const columnMap = new Map(columns.map((col) => [col.id, col]));

    // Get rows to process
    let rows;
    if (rowIds && Array.isArray(rowIds) && rowIds.length > 0) {
      rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));
    } else {
      rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No rows to process' }, { status: 400 });
    }

    // Check if exceeds maximum total rows
    if (rows.length > MAX_TOTAL_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${rows.length.toLocaleString()}). Maximum allowed is ${MAX_TOTAL_ROWS.toLocaleString()} rows.` },
        { status: 400 }
      );
    }

    // Create output columns if they don't exist (from Data Guide)
    const outputColumnIds: Record<string, string> = {};
    const definedOutputColumns = config.outputColumns as string[] | null;

    if (definedOutputColumns && definedOutputColumns.length > 0) {
      const maxOrder = columns.reduce((max, col) => Math.max(max, col.order), 0);
      let currentOrder = maxOrder + 1;

      for (const outputColName of definedOutputColumns) {
        const existingCol = columns.find(
          c => c.name.toLowerCase() === outputColName.toLowerCase()
        );

        if (existingCol) {
          outputColumnIds[outputColName.toLowerCase()] = existingCol.id;
        } else {
          const newColId = generateId();
          const newColumn = {
            id: newColId,
            tableId,
            name: outputColName,
            type: 'text' as const,
            width: 150,
            order: currentOrder++,
            enrichmentConfigId: null,
            formulaConfigId: null,
          };
          await db.insert(schema.columns).values(newColumn);
          outputColumnIds[outputColName.toLowerCase()] = newColId;
        }
      }
    }

    // Build prompts for each row
    const rowPrompts: Array<{ rowId: string; prompt: string }> = [];
    for (const row of rows) {
      const prompt = buildPrompt(config.prompt, row, columnMap, definedOutputColumns || []);
      rowPrompts.push({ rowId: row.id, prompt });
    }

    // Calculate number of batches needed
    const totalBatches = Math.ceil(rows.length / MAX_ROWS_PER_BATCH);
    const batchGroupId = totalBatches > 1 ? generateId() : null;

    console.log(`Processing ${rows.length} rows in ${totalBatches} batch(es)${batchGroupId ? ` (group ${batchGroupId})` : ''}`);

    // Track all created jobs
    const createdJobs: Array<{
      jobId: string;
      batchNumber: number;
      rowCount: number;
      status: string;
      azureBatchId?: string;
    }> = [];

    // Process each batch chunk
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchNumber = batchIndex + 1;
      const startIdx = batchIndex * MAX_ROWS_PER_BATCH;
      const endIdx = Math.min(startIdx + MAX_ROWS_PER_BATCH, rows.length);
      const batchRows = rows.slice(startIdx, endIdx);
      const batchPrompts = rowPrompts.slice(startIdx, endIdx);

      console.log(`Creating batch ${batchNumber}/${totalBatches}: rows ${startIdx + 1}-${endIdx} (${batchRows.length} rows)`);

      // Generate JSONL content for this batch
      const { content: jsonlContent, mappings } = generateBatchJSONL(batchPrompts, 8192, model);

      // Create job record in DB first
      const jobId = generateId();
      const now = new Date();

      // Don't store row mappings - they're stored in cells as batchJobId
      // customId is derivable as `row-${rowId}`, and we query rows by batchJobId
      try {
        await db.insert(schema.batchEnrichmentJobs).values({
          id: jobId,
          tableId,
          configId,
          targetColumnId,
          batchGroupId,
          batchNumber,
          totalBatches,
          rowMappings: [], // Empty - rows are tracked via batchJobId in cells
          azureStatus: 'pending_upload',
          status: 'uploading',
          totalRows: batchRows.length,
          createdAt: now,
          updatedAt: now,
        });
      } catch (insertError) {
        console.error(`Failed to insert batch job record for batch ${batchNumber}:`, insertError);
        throw new Error(`Failed to create batch job record: ${(insertError as Error).message}`);
      }

      // Mark cells for this batch as batch_submitted
      const rowUpdates = batchRows.map(row => {
        const updatedData: Record<string, CellValue> = {
          ...(row.data as Record<string, CellValue>),
          [targetColumnId]: {
            value: null,
            status: 'batch_submitted' as const,
            batchJobId: jobId,
          },
        };

        // Also mark output columns
        for (const colId of Object.values(outputColumnIds)) {
          updatedData[colId] = {
            value: null,
            status: 'batch_submitted' as const,
            batchJobId: jobId,
          };
        }

        return { id: row.id, data: updatedData };
      });

      try {
        console.log(`Marking ${rowUpdates.length} cells as batch_submitted for batch ${batchNumber}`);
        await batchUpdateRows(rowUpdates);
        console.log(`Successfully marked cells for batch ${batchNumber}`);
      } catch (updateError) {
        console.error(`Failed to mark cells as batch_submitted for batch ${batchNumber}:`, updateError);
        // Update job as error
        await db.update(schema.batchEnrichmentJobs).set({
          status: 'error',
          lastError: `Failed to mark cells: ${(updateError as Error).message}`,
          updatedAt: new Date(),
        }).where(eq(schema.batchEnrichmentJobs.id, jobId));
        throw new Error(`Failed to mark cells for batch ${batchNumber}: ${(updateError as Error).message}`);
      }

      try {
        // Upload file to Azure
        const filename = `batch_${jobId}_${Date.now()}.jsonl`;
        const fileResponse = await uploadBatchFile(jsonlContent, filename);

        // Update job with file ID
        await db.update(schema.batchEnrichmentJobs).set({
          azureFileId: fileResponse.id,
          status: 'submitted',
          updatedAt: new Date(),
        }).where(eq(schema.batchEnrichmentJobs.id, jobId));

        // Create batch job
        const batchResponse = await createBatchJob(fileResponse.id, {
          jobId,
          tableId,
          batchNumber: String(batchNumber),
          totalBatches: String(totalBatches),
        });

        // Update job with batch ID
        await db.update(schema.batchEnrichmentJobs).set({
          azureBatchId: batchResponse.id,
          azureStatus: batchResponse.status,
          status: 'submitted',
          submittedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(schema.batchEnrichmentJobs.id, jobId));

        createdJobs.push({
          jobId,
          batchNumber,
          rowCount: batchRows.length,
          status: 'submitted',
          azureBatchId: batchResponse.id,
        });

      } catch (uploadError) {
        // Update job as error
        await db.update(schema.batchEnrichmentJobs).set({
          status: 'error',
          lastError: (uploadError as Error).message,
          updatedAt: new Date(),
        }).where(eq(schema.batchEnrichmentJobs.id, jobId));

        // Mark cells as error for this batch
        const errorUpdates = batchRows.map(row => {
          const updatedData: Record<string, CellValue> = {
            ...(row.data as Record<string, CellValue>),
            [targetColumnId]: {
              value: null,
              status: 'error' as const,
              error: `Batch ${batchNumber} submission failed: ${(uploadError as Error).message}`,
            },
          };

          for (const colId of Object.values(outputColumnIds)) {
            updatedData[colId] = {
              value: null,
              status: 'error' as const,
              error: `Batch ${batchNumber} submission failed: ${(uploadError as Error).message}`,
            };
          }

          return { id: row.id, data: updatedData };
        });

        await batchUpdateRows(errorUpdates);

        createdJobs.push({
          jobId,
          batchNumber,
          rowCount: batchRows.length,
          status: 'error',
        });

        // Continue with remaining batches instead of failing completely
        console.error(`Batch ${batchNumber} failed, continuing with remaining batches:`, uploadError);
      }
    }

    // Calculate summary stats
    const successfulBatches = createdJobs.filter(j => j.status === 'submitted').length;
    const failedBatches = createdJobs.filter(j => j.status === 'error').length;
    const totalRowsSubmitted = createdJobs
      .filter(j => j.status === 'submitted')
      .reduce((sum, j) => sum + j.rowCount, 0);

    // Build response message
    let message: string;
    if (totalBatches === 1) {
      message = `Batch job submitted with ${rows.length.toLocaleString()} rows. Processing may take 1-24 hours.`;
    } else if (failedBatches === 0) {
      message = `${totalBatches} batches submitted with ${rows.length.toLocaleString()} total rows. Processing may take 1-24 hours.`;
    } else {
      message = `${successfulBatches}/${totalBatches} batches submitted (${totalRowsSubmitted.toLocaleString()} rows). ${failedBatches} batch(es) failed.`;
    }

    return NextResponse.json({
      // Legacy fields for single-batch compatibility
      jobId: createdJobs[0]?.jobId,
      azureBatchId: createdJobs[0]?.azureBatchId,
      // New batch group fields
      batchGroupId,
      totalBatches,
      totalRows: rows.length,
      jobs: createdJobs,
      status: failedBatches === totalBatches ? 'error' : 'submitted',
      message,
      createdColumns: Object.keys(outputColumnIds).length > 0
        ? Object.entries(outputColumnIds).map(([name, id]) => ({ name, id }))
        : [],
      targetColumnId,
    });

  } catch (error) {
    console.error('Error creating batch job:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to create batch job' },
      { status: 500 }
    );
  }
}

function buildPrompt(
  template: string,
  row: typeof schema.rows.$inferSelect,
  columnMap: Map<string, typeof schema.columns.$inferSelect>,
  outputColumns: string[] = []
): string {
  let prompt = template;

  // Replace {{column_name}} with actual values
  const variablePattern = /\{\{([^}]+)\}\}/g;
  prompt = prompt.replace(variablePattern, (match, columnName) => {
    const column = Array.from(columnMap.values()).find(
      (col) => col.name.toLowerCase() === columnName.toLowerCase().trim()
    );

    if (column) {
      const cellValue = row.data[column.id];
      return cellValue?.value?.toString() ?? '';
    }

    return match;
  });

  // Add JSON format instructions if output columns defined
  if (outputColumns.length > 0) {
    const jsonTemplate = outputColumns.reduce((acc, col) => {
      acc[col] = `<${col} value>`;
      return acc;
    }, {} as Record<string, string>);

    const jsonTemplateWithMetadata = {
      ...jsonTemplate,
      reasoning: '<brief explanation of your answer, 1-2 sentences>',
      confidence: '<"high", "medium", or "low">',
      steps_taken: '<brief list of what you did>',
    };

    prompt += `

---
IMPORTANT: You must respond with ONLY a valid JSON object using exactly these keys:
${JSON.stringify(jsonTemplateWithMetadata, null, 2)}

Replace each placeholder with the actual value. Do not include any other text, markdown, or explanation. Only output the JSON object.`;
  } else {
    prompt += `

---
Respond with JSON including these fields:
- Your actual response data
- "reasoning": brief explanation (1-2 sentences)
- "confidence": "high", "medium", or "low"
- "steps_taken": brief list of what you did`;
  }

  return prompt;
}
