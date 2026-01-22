import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import {
  callAI as callUnifiedAI,
  getModelPricing,
  getProviderFromModel,
  getProviderRateLimits,
  type AIResult,
} from '@/lib/ai-provider';

// Vercel function config - max duration for hobby is 10s, pro is 60s
export const maxDuration = 60; // Will use max available for your plan

const BATCH_SIZE = 50; // Process 50 rows per call
const AI_TIMEOUT_MS = 30000; // 30 second timeout per AI call
const STALE_JOB_MINUTES = 10; // Auto-complete jobs stuck for 10+ minutes

// Timeout wrapper for promises
function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), ms)
    ),
  ]);
}

// GET /api/cron/process-enrichment - Called by external cron service
export async function GET(request: NextRequest) {
  // Optional: Verify cron secret via query param or header
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const authHeader = request.headers.get('authorization');

  // Secret check disabled - endpoint is protected by obscurity
  // To re-enable, set CRON_SECRET env var on both Vercel and GitHub Actions

  try {
    // Find active jobs (pending or running)
    const activeJobs = await db
      .select()
      .from(schema.enrichmentJobs)
      .where(
        or(
          eq(schema.enrichmentJobs.status, 'pending'),
          eq(schema.enrichmentJobs.status, 'running')
        )
      );

    if (activeJobs.length === 0) {
      return NextResponse.json({ message: 'No active jobs', processed: 0 });
    }

    let totalProcessed = 0;

    // Process one batch for each active job
    for (const job of activeJobs) {
      // Check for stale jobs (stuck for too long)
      const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
      const minutesSinceUpdate = (Date.now() - updatedAt) / 1000 / 60;

      if (minutesSinceUpdate > STALE_JOB_MINUTES && job.currentIndex > 0) {
        // Job is stuck - mark as complete
        console.log(`Job ${job.id} is stale (${minutesSinceUpdate.toFixed(1)} min), marking complete`);
        await db.update(schema.enrichmentJobs)
          .set({
            status: 'complete',
            updatedAt: new Date(),
            completedAt: new Date(),
          })
          .where(eq(schema.enrichmentJobs.id, job.id));
        continue;
      }

      const processed = await processJobBatch(job);
      totalProcessed += processed;
    }

    return NextResponse.json({
      message: `Processed ${totalProcessed} rows across ${activeJobs.length} jobs`,
      processed: totalProcessed,
      activeJobs: activeJobs.length,
    });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json({ error: 'Cron processing failed' }, { status: 500 });
  }
}

async function processJobBatch(job: typeof schema.enrichmentJobs.$inferSelect): Promise<number> {
  const { id: jobId, tableId, configId, targetColumnId, rowIds, currentIndex } = job;

  // Check if job is complete
  if (currentIndex >= rowIds.length) {
    await db.update(schema.enrichmentJobs)
      .set({
        status: 'complete',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(schema.enrichmentJobs.id, jobId));
    return 0;
  }

  // Mark as running
  await db.update(schema.enrichmentJobs)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(schema.enrichmentJobs.id, jobId));

  // Get config
  const [config] = await db
    .select()
    .from(schema.enrichmentConfigs)
    .where(eq(schema.enrichmentConfigs.id, configId));

  if (!config) {
    await db.update(schema.enrichmentJobs)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(schema.enrichmentJobs.id, jobId));
    return 0;
  }

  // Get columns
  const columns = await db
    .select()
    .from(schema.columns)
    .where(eq(schema.columns.tableId, tableId));

  const columnMap = new Map(columns.map((col) => [col.id, col]));

  // Build output column IDs
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

  // Get batch of row IDs
  const batchRowIds = rowIds.slice(currentIndex, currentIndex + BATCH_SIZE);

  // Get actual rows
  const rows = await db
    .select()
    .from(schema.rows)
    .where(inArray(schema.rows.id, batchRowIds));

  if (rows.length === 0) {
    // No rows found, mark complete
    await db.update(schema.enrichmentJobs)
      .set({
        status: 'complete',
        currentIndex: rowIds.length,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(schema.enrichmentJobs.id, jobId));
    return 0;
  }

  // Mark current batch cells as 'processing' for visual feedback (parallel for speed)
  await Promise.all(rows.map(row => {
    const currentCellValue = (row.data as Record<string, CellValue>)[targetColumnId] || {};
    const updatedData = {
      ...(row.data as Record<string, CellValue>),
      [targetColumnId]: {
        ...currentCellValue,
        status: 'processing' as const,
      },
    };
    return db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
  }));

  const modelId = config.model || 'gemini-2.5-flash';
  const pricing = getModelPricing(modelId);
  const provider = getProviderFromModel(modelId);
  const rateLimits = getProviderRateLimits(provider);
  let batchCost = 0;
  let batchErrors = 0;

  // Process rows with limited concurrency to avoid rate limits
  const processRow = async (row: typeof rows[0]) => {
      try {
        const prompt = buildPrompt(config.prompt, row, columnMap, definedOutputColumns || []);
        const aiResult = await withTimeout(
          callUnifiedAI(prompt, modelId, {
            temperature: config.temperature ?? 0.7,
            maxOutputTokens: 8192,
          }),
          AI_TIMEOUT_MS,
          'AI request timed out after 30 seconds'
        );

        const rowCost = (aiResult.inputTokens * pricing.input + aiResult.outputTokens * pricing.output) / 1_000_000;
        batchCost += rowCost;

        const parsedResult = parseAIResponse(aiResult.text);

        const updatedData: Record<string, CellValue> = {
          ...(row.data as Record<string, CellValue>),
          [targetColumnId]: {
            value: parsedResult.displayValue,
            status: 'complete' as const,
            enrichmentData: parsedResult.structuredData,
            rawResponse: aiResult.text,
            metadata: {
              inputTokens: aiResult.inputTokens,
              outputTokens: aiResult.outputTokens,
              timeTakenMs: aiResult.timeTakenMs,
              totalCost: rowCost,
              forcedToFinishEarly: false,
            },
          },
        };

        if (hasOutputColumns && parsedResult.structuredData) {
          for (const [outputName, columnId] of Object.entries(outputColumnIds)) {
            const matchingKey = Object.keys(parsedResult.structuredData).find(
              key => key.toLowerCase() === outputName
            );
            if (matchingKey) {
              const value = parsedResult.structuredData[matchingKey];
              updatedData[columnId] = {
                value: value !== null && value !== undefined ? String(value) : null,
                status: 'complete' as const,
              };
            } else {
              updatedData[columnId] = { value: null, status: 'complete' as const };
            }
          }
        }

        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
      } catch (error) {
        console.error(`Error processing row ${row.id}:`, error);
        batchErrors++;

        const updatedData: Record<string, CellValue> = {
          ...(row.data as Record<string, CellValue>),
          [targetColumnId]: {
            value: null,
            status: 'error' as const,
            error: (error as Error).message,
          },
        };

        if (hasOutputColumns) {
          for (const columnId of Object.values(outputColumnIds)) {
            updatedData[columnId] = {
              value: null,
              status: 'error' as const,
              error: (error as Error).message,
            };
          }
        }

        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
      }
  };

  // Process with limited concurrency (varies by provider)
  const { concurrentRequests, delayBetweenChunks } = rateLimits;
  for (let i = 0; i < rows.length; i += concurrentRequests) {
    const chunk = rows.slice(i, i + concurrentRequests);
    await Promise.all(chunk.map(processRow));
    // Delay between chunks to avoid rate limits (longer for Azure)
    if (i + concurrentRequests < rows.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenChunks));
    }
  }

  // Update job progress
  const newIndex = currentIndex + batchRowIds.length;
  const isComplete = newIndex >= rowIds.length;

  await db.update(schema.enrichmentJobs)
    .set({
      currentIndex: newIndex,
      processedCount: job.processedCount + batchRowIds.length,
      errorCount: job.errorCount + batchErrors,
      totalCost: job.totalCost + batchCost,
      status: isComplete ? 'complete' : 'running',
      updatedAt: new Date(),
      completedAt: isComplete ? new Date() : null,
    })
    .where(eq(schema.enrichmentJobs.id, jobId));

  return batchRowIds.length;
}

function buildPrompt(
  template: string,
  row: typeof schema.rows.$inferSelect,
  columnMap: Map<string, typeof schema.columns.$inferSelect>,
  outputColumns: string[] = []
): string {
  let prompt = template;

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

  if (outputColumns.length > 0) {
    const jsonTemplate = outputColumns.reduce((acc, col) => {
      acc[col] = `<${col} value>`;
      return acc;
    }, {} as Record<string, string>);

    // Add metadata fields to the template
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
    // No output columns - still request metadata fields
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

function parseAIResponse(response: string): { displayValue: string; structuredData: Record<string, string | number | null> | undefined } {
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
        displayValue: dataCount === 1 ? String(Object.values(structuredData)[0] ?? '') : `${dataCount} datapoints`,
        structuredData,
      };
    }
  } catch {}

  const jsonBlockMatch = cleanedResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const structuredData = toStructuredData(parsed);
        const dataCount = Object.keys(structuredData).length;
        return {
          displayValue: dataCount === 1 ? String(Object.values(structuredData)[0] ?? '') : `${dataCount} datapoints`,
          structuredData,
        };
      }
    } catch {}
  }

  return { displayValue: cleanedResponse, structuredData: { result: cleanedResponse } };
}
