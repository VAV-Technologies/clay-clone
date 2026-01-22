import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { CellValue } from '@/lib/db/schema';
import { callAI as callUnifiedAI, getModelPricing } from '@/lib/ai-provider';

function generateId() {
  return nanoid(12);
}

// Result for a single row
interface RowResult {
  rowId: string;
  success: boolean;
  data?: Record<string, CellValue>;
  error?: string;
  cost?: number;
}

// POST /api/enrichment/run - Run enrichment on rows (synchronously)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      configId,
      tableId,
      targetColumnId,
      rowIds, // Required: specific rows to enrich (batch from client)
      onlyEmpty = false,
      includeErrors = false,
      forceRerun = false,
    } = body;

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
    let columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    // Create output columns if they don't exist (from Data Guide)
    const outputColumnIds: Record<string, string> = {};
    const definedOutputColumns = config.outputColumns as string[] | null;
    let newColumnsCreated: typeof columns = [];

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
          columns.push({ ...newColumn, enrichmentConfigId: null, formulaConfigId: null });
          newColumnsCreated.push({ ...newColumn, enrichmentConfigId: null, formulaConfigId: null });
        }
      }
    }

    const columnMap = new Map(columns.map((col) => [col.id, col]));

    // Get rows to enrich - must have rowIds for batch processing
    let rows;
    if (rowIds && Array.isArray(rowIds) && rowIds.length > 0) {
      rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));
    } else {
      // If no rowIds, get all rows but limit to prevent timeout
      rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
    }

    // Filter rows based on run mode
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
      return NextResponse.json({
        message: 'No rows to enrich',
        results: [],
        newColumns: newColumnsCreated,
      });
    }

    // Process rows IN PARALLEL for speed
    const hasOutputColumns = Object.keys(outputColumnIds).length > 0;
    const modelId = config.model || 'gemini-2.5-flash';
    const pricing = getModelPricing(modelId);
    let totalCost = 0;

    // Process all rows in parallel using Promise.all
    const results = await Promise.all(
      rows.map(async (row): Promise<RowResult> => {
        try {
          // Build prompt
          const prompt = buildPrompt(config.prompt, row, columnMap, definedOutputColumns || []);

          // Call AI using unified provider
          const aiResult = await callUnifiedAI(prompt, modelId, {
            temperature: config.temperature ?? 0.7,
            maxOutputTokens: 8192,
          });

          // Calculate cost
          const rowCost = (aiResult.inputTokens * pricing.input + aiResult.outputTokens * pricing.output) / 1_000_000;
          totalCost += rowCost;

          // Parse result
          const parsedResult = parseAIResponse(aiResult.text);

          // Build updated data
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

          // Populate output columns
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
                updatedData[columnId] = {
                  value: null,
                  status: 'complete' as const,
                };
              }
            }
          }

          // Save to database
          await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

          return {
            rowId: row.id,
            success: true,
            data: updatedData,
            cost: rowCost,
          };

        } catch (error) {
          console.error(`Error enriching row ${row.id}:`, error);

          // Mark as error
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
      })
    );

    return NextResponse.json({
      results,
      totalCost,
      processedCount: results.length,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length,
      newColumns: newColumnsCreated,
    });

  } catch (error) {
    console.error('Error running enrichment:', error);
    return NextResponse.json({ error: 'Failed to run enrichment' }, { status: 500 });
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
