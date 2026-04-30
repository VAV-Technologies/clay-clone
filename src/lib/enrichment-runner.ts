// Shared enrichment-execution core. Used by both:
//   - POST /api/enrichment/run         (existing low-level: takes configId)
//   - POST /api/enrichment/setup-and-run (canonical: creates config + column, then runs)
//
// Single source of truth for: prompt building, AI dispatch with tool-calling,
// response parsing, output-column auto-creation, per-cell metadata, and rate
// limiting. Both routes parse their own body shape, then delegate here.

import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { CellValue, EnrichmentConfig } from '@/lib/db/schema';
import { callAI as callUnifiedAI, getModelPricing, getProviderRateLimits } from '@/lib/ai-provider';
import { WEB_SEARCH_TOOLS, dispatchToolCall, WEB_SEARCH_SYSTEM_HINT } from '@/lib/enrichment-tools';

const AI_TIMEOUT_MS_NO_TOOLS = 30000;
const AI_TIMEOUT_MS_WITH_TOOLS = 90000;

function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms)),
  ]);
}

function generateId() {
  return nanoid(12);
}

export interface RowResult {
  rowId: string;
  success: boolean;
  data?: Record<string, CellValue>;
  error?: string;
  cost?: number;
}

export interface EnrichmentRunInput {
  config: EnrichmentConfig;
  tableId: string;
  targetColumnId: string;
  rowIds?: string[];
  onlyEmpty?: boolean;
  includeErrors?: boolean;
  forceRerun?: boolean;
}

export interface EnrichmentRunOutput {
  results: RowResult[];
  totalCost: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  newColumns: typeof schema.columns.$inferSelect[];
  message?: string;
}

// Run a configured enrichment over a set of rows. Atomic per row, rate-limited
// across rows, persists cells back to the rows table. Auto-creates output
// columns from `config.outputColumns` (Data Guide) if they don't exist yet.
export async function runEnrichmentJob(input: EnrichmentRunInput): Promise<EnrichmentRunOutput> {
  const { config, tableId, targetColumnId, rowIds, onlyEmpty, includeErrors, forceRerun } = input;

  // Get columns for variable substitution
  let columns = await db
    .select()
    .from(schema.columns)
    .where(eq(schema.columns.tableId, tableId));

  // Create output columns if they don't exist (from Data Guide)
  const outputColumnIds: Record<string, string> = {};
  const definedOutputColumns = (config.outputColumns as string[] | null) ?? [];
  const newColumnsCreated: typeof columns = [];

  if (definedOutputColumns.length > 0) {
    const maxOrder = columns.reduce((max, col) => Math.max(max, col.order), 0);
    let currentOrder = maxOrder + 1;

    for (const outputColName of definedOutputColumns) {
      const existingCol = columns.find(
        (c) => c.name.toLowerCase() === outputColName.toLowerCase()
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
        columns.push({ ...newColumn });
        newColumnsCreated.push({ ...newColumn });
      }
    }
  }

  const columnMap = new Map(columns.map((col) => [col.id, col]));

  // Get rows to enrich
  let rows;
  if (rowIds && Array.isArray(rowIds) && rowIds.length > 0) {
    rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));
  } else {
    rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
  }

  // Filter rows based on run mode (matches /run behavior exactly)
  if (forceRerun) {
    // Force re-run: include all rows
  } else if (onlyEmpty && includeErrors) {
    rows = rows.filter((row) => {
      const cellValue = row.data[targetColumnId];
      if (!cellValue || !cellValue.value) return true;
      if (cellValue.status === 'error') return true;
      return false;
    });
  } else if (onlyEmpty) {
    rows = rows.filter((row) => {
      const cellValue = row.data[targetColumnId];
      return !cellValue || !cellValue.value;
    });
  }

  if (rows.length === 0) {
    return {
      results: [],
      totalCost: 0,
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      newColumns: newColumnsCreated,
      message: 'No rows to enrich',
    };
  }

  const hasOutputColumns = Object.keys(outputColumnIds).length > 0;
  const modelId = config.model || 'gpt-5-mini';
  const pricing = getModelPricing(modelId);
  const rateLimits = getProviderRateLimits(modelId);
  let totalCost = 0;
  const results: RowResult[] = [];

  const processRow = async (row: typeof rows[0]): Promise<RowResult> => {
    try {
      const prompt = buildPrompt(config.prompt, row, columnMap, definedOutputColumns);

      const webSearchEnabled = !!config.webSearchEnabled;
      const aiTimeout = webSearchEnabled ? AI_TIMEOUT_MS_WITH_TOOLS : AI_TIMEOUT_MS_NO_TOOLS;
      const aiResult = await withTimeout(
        callUnifiedAI(prompt, modelId, {
          temperature: config.temperature ?? 0.7,
          maxOutputTokens: 8192,
          tools: webSearchEnabled ? WEB_SEARCH_TOOLS : undefined,
          toolDispatcher: webSearchEnabled ? dispatchToolCall : undefined,
          systemHint: webSearchEnabled ? WEB_SEARCH_SYSTEM_HINT : undefined,
        }),
        aiTimeout,
        `AI request timed out after ${aiTimeout / 1000} seconds`
      );

      const modelCost = (aiResult.inputTokens * pricing.input + aiResult.outputTokens * pricing.output) / 1_000_000;
      const webSearchCost = aiResult.toolCost ?? 0;
      const rowCost = modelCost + webSearchCost;
      totalCost += rowCost;

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
            webSearchCalls: aiResult.toolCallCount ?? 0,
            webSearchCost,
          },
        },
      };

      if (hasOutputColumns && parsedResult.structuredData) {
        for (const [outputName, columnId] of Object.entries(outputColumnIds)) {
          const matchingKey = Object.keys(parsedResult.structuredData).find(
            (key) => key.toLowerCase() === outputName
          );

          if (matchingKey) {
            const value = parsedResult.structuredData[matchingKey];
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

      await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

      return {
        rowId: row.id,
        success: true,
        data: updatedData,
        cost: rowCost,
      };
    } catch (error) {
      console.error(`Error enriching row ${row.id}:`, error);

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

      return {
        rowId: row.id,
        success: false,
        data: updatedData,
        error: (error as Error).message,
      };
    }
  };

  const { concurrentRequests, delayBetweenChunks } = rateLimits;
  for (let i = 0; i < rows.length; i += concurrentRequests) {
    const chunk = rows.slice(i, i + concurrentRequests);
    const chunkResults = await Promise.all(chunk.map(processRow));
    results.push(...chunkResults);

    if (i + concurrentRequests < rows.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenChunks));
    }
  }

  return {
    results,
    totalCost,
    processedCount: results.length,
    successCount: results.filter((r) => r.success).length,
    errorCount: results.filter((r) => !r.success).length,
    newColumns: newColumnsCreated,
  };
}

// Substitutes {{Column Name}} placeholders with cell values, then appends the
// JSON-output instruction (with reasoning/confidence/steps_taken metadata fields).
export function buildPrompt(
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

    const jsonTemplateWithMetadata = {
      ...jsonTemplate,
      reasoning: '<brief explanation of your answer, 1-2 sentences>',
      confidence: '<"high", "medium", or "low">',
      steps_taken: '<brief list of what you did>',
    };

    prompt += `\n\n---\nIMPORTANT: You must respond with ONLY a valid JSON object using exactly these keys:\n${JSON.stringify(jsonTemplateWithMetadata, null, 2)}\n\nReplace each placeholder with the actual value. Do not include any other text, markdown, or explanation. Only output the JSON object.`;
  } else {
    prompt += `\n\n---\nRespond with JSON including these fields:\n- Your actual response data\n- "reasoning": brief explanation (1-2 sentences)\n- "confidence": "high", "medium", or "low"\n- "steps_taken": brief list of what you did`;
  }

  return prompt;
}

interface ParsedAIResponse {
  displayValue: string;
  structuredData: Record<string, string | number | null> | undefined;
}

// Best-effort JSON extraction from the model's output. Tries direct parse,
// then markdown code blocks, then balanced-brace inline, then plain-text fallback.
export function parseAIResponse(response: string): ParsedAIResponse {
  const cleanedResponse = response.trim();

  const toStructuredData = (parsed: Record<string, unknown>): Record<string, string | number | null> => {
    const result: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) {
        result[key] = null;
      } else if (typeof value === 'string' || typeof value === 'number') {
        result[key] = value;
      } else if (Array.isArray(value)) {
        result[key] = value.map((v) => String(v ?? '')).join(', ');
      } else if (typeof value === 'object') {
        result[key] = JSON.stringify(value);
      } else {
        result[key] = String(value);
      }
    }
    return result;
  };

  // Direct JSON parse
  try {
    const parsed = JSON.parse(cleanedResponse);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const structuredData = toStructuredData(parsed);
      const dataCount = Object.keys(structuredData).length;
      return {
        displayValue:
          dataCount === 1
            ? String(Object.values(structuredData)[0] ?? '')
            : `${dataCount} datapoints`,
        structuredData,
      };
    }
  } catch {
    // not valid JSON, try other extraction strategies
  }

  // Markdown code blocks
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
              displayValue:
                dataCount === 1
                  ? String(Object.values(structuredData)[0] ?? '')
                  : `${dataCount} datapoints`,
              structuredData,
            };
          }
        } catch {
          // continue to next strategy
        }
      }
    }
  }

  // Inline JSON via balanced braces
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
                displayValue:
                  dataCount === 1
                    ? String(Object.values(structuredData)[0] ?? '')
                    : `${dataCount} datapoints`,
                structuredData,
              };
            }
          } catch {
            // continue
          }
          break;
        }
      }
    }
  }

  // Fallback: plain text
  return {
    displayValue: cleanedResponse,
    structuredData: { result: cleanedResponse },
  };
}
