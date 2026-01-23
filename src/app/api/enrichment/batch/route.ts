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

// Vercel function config - extend timeout for file upload
export const maxDuration = 60;

// Batch size for chunked updates (Turso supports up to 1000 statements per batch)
const UPDATE_BATCH_SIZE = 1000;
// Number of parallel batch operations
const PARALLEL_BATCHES = 5;

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
    const { configId, tableId, targetColumnId, rowIds } = body;

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

    // Generate JSONL content
    const { content: jsonlContent, mappings } = generateBatchJSONL(rowPrompts);

    // Create job record in DB first
    const jobId = generateId();
    const now = new Date();

    await db.insert(schema.batchEnrichmentJobs).values({
      id: jobId,
      tableId,
      configId,
      targetColumnId,
      rowMappings: mappings,
      azureStatus: 'pending_upload',
      status: 'uploading',
      totalRows: rows.length,
      createdAt: now,
      updatedAt: now,
    });

    // Mark all cells as batch_submitted - prepare updates in memory first
    const rowUpdates = rows.map(row => {
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

    // Execute all updates in batches (much faster than sequential)
    await batchUpdateRows(rowUpdates);

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
      });

      // Update job with batch ID
      await db.update(schema.batchEnrichmentJobs).set({
        azureBatchId: batchResponse.id,
        azureStatus: batchResponse.status,
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.batchEnrichmentJobs.id, jobId));

      return NextResponse.json({
        jobId,
        azureBatchId: batchResponse.id,
        totalRows: rows.length,
        status: 'submitted',
        message: `Batch job submitted with ${rows.length} rows. Processing may take 1-24 hours.`,
        createdColumns: Object.keys(outputColumnIds).length > 0
          ? Object.entries(outputColumnIds).map(([name, id]) => ({ name, id }))
          : [],
        targetColumnId,
      });

    } catch (uploadError) {
      // Update job as error
      await db.update(schema.batchEnrichmentJobs).set({
        status: 'error',
        lastError: (uploadError as Error).message,
        updatedAt: new Date(),
      }).where(eq(schema.batchEnrichmentJobs.id, jobId));

      // Mark cells as error - prepare updates in memory first
      const errorUpdates = rows.map(row => {
        const updatedData: Record<string, CellValue> = {
          ...(row.data as Record<string, CellValue>),
          [targetColumnId]: {
            value: null,
            status: 'error' as const,
            error: `Batch submission failed: ${(uploadError as Error).message}`,
          },
        };

        for (const colId of Object.values(outputColumnIds)) {
          updatedData[colId] = {
            value: null,
            status: 'error' as const,
            error: `Batch submission failed: ${(uploadError as Error).message}`,
          };
        }

        return { id: row.id, data: updatedData };
      });

      // Execute all error updates in batches
      await batchUpdateRows(errorUpdates);

      throw uploadError;
    }

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
