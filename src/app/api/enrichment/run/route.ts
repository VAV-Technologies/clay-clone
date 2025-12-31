import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

function generateId() {
  return nanoid(12);
}

// In-memory progress tracking (in production, use Redis or similar)
const progressMap = new Map<string, { completed: number; total: number; status: string }>();

// POST /api/enrichment/run - Run enrichment on rows
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      configId,
      tableId,
      targetColumnId,
      rowIds, // Optional: specific rows to enrich
      onlyEmpty = false, // Only enrich cells without values
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

    if (definedOutputColumns && definedOutputColumns.length > 0) {
      const maxOrder = columns.reduce((max, col) => Math.max(max, col.order), 0);
      let currentOrder = maxOrder + 1;

      for (const outputColName of definedOutputColumns) {
        // Check if column already exists (case-insensitive)
        const existingCol = columns.find(
          c => c.name.toLowerCase() === outputColName.toLowerCase()
        );

        if (existingCol) {
          outputColumnIds[outputColName.toLowerCase()] = existingCol.id;
        } else {
          // Create new column for this output
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

    // Filter to only empty cells if requested
    if (onlyEmpty) {
      rows = rows.filter((row) => {
        const cellValue = row.data[targetColumnId];
        return !cellValue || !cellValue.value;
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ message: 'No rows to enrich', rowsProcessed: 0 });
    }

    // Create a job ID for progress tracking
    const jobId = crypto.randomUUID();
    progressMap.set(jobId, { completed: 0, total: rows.length, status: 'running' });

    // Process enrichment asynchronously
    processEnrichmentBatch(jobId, rows, config, targetColumnId, columnMap, outputColumnIds);

    return NextResponse.json({
      jobId,
      message: 'Enrichment started',
      totalRows: rows.length,
      outputColumns: Object.keys(outputColumnIds),
    });
  } catch (error) {
    console.error('Error starting enrichment:', error);
    return NextResponse.json({ error: 'Failed to start enrichment' }, { status: 500 });
  }
}

async function processEnrichmentBatch(
  jobId: string,
  rows: typeof schema.rows.$inferSelect[],
  config: typeof schema.enrichmentConfigs.$inferSelect,
  targetColumnId: string,
  columnMap: Map<string, typeof schema.columns.$inferSelect>,
  outputColumnIds: Record<string, string> = {}
) {
  const batchSize = 5;
  const delayMs = 1000;
  const hasOutputColumns = Object.keys(outputColumnIds).length > 0;
  const definedOutputColumns = (config.outputColumns as string[] | null) || [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (row) => {
        try {
          // Build prompt with variable substitution and JSON format instructions
          const prompt = buildPrompt(config.prompt, row, columnMap, definedOutputColumns);

          // Call AI
          const result = await callAI(prompt, config);

          // Parse the result - try to extract JSON for structured data
          const parsedResult = parseAIResponse(result);

          // Update row with result
          const updatedData = {
            ...row.data,
            [targetColumnId]: {
              value: parsedResult.displayValue,
              status: 'complete' as const,
              enrichmentData: parsedResult.structuredData,
              rawResponse: result,
            },
          };

          // If we have output columns defined, populate them with extracted values
          if (hasOutputColumns && parsedResult.structuredData) {
            for (const [outputName, columnId] of Object.entries(outputColumnIds)) {
              // Look for matching key in structured data (case-insensitive)
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
                // No matching value found for this output column
                updatedData[columnId] = {
                  value: null,
                  status: 'complete' as const,
                };
              }
            }
          }

          await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        } catch (error) {
          console.error(`Error enriching row ${row.id}:`, error);

          // Mark as error
          const updatedData: Record<string, unknown> = {
            ...row.data,
            [targetColumnId]: {
              value: null,
              status: 'error' as const,
              error: (error as Error).message,
            },
          };

          // Also mark output columns as error
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
      })
    );

    // Update progress
    const progress = progressMap.get(jobId);
    if (progress) {
      progress.completed = Math.min(i + batchSize, rows.length);
    }

    // Delay between batches
    if (i + batchSize < rows.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Mark job as complete
  const progress = progressMap.get(jobId);
  if (progress) {
    progress.status = 'complete';
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
    // Find column by name
    const column = Array.from(columnMap.values()).find(
      (col) => col.name.toLowerCase() === columnName.toLowerCase().trim()
    );

    if (column) {
      const cellValue = row.data[column.id];
      return cellValue?.value?.toString() ?? '';
    }

    return match; // Keep original if column not found
  });

  // If output columns are defined, append JSON format instructions
  if (outputColumns.length > 0) {
    const jsonTemplate = outputColumns.reduce((acc, col) => {
      acc[col] = `<${col} value>`;
      return acc;
    }, {} as Record<string, string>);

    prompt += `

---
IMPORTANT: You must respond with ONLY a valid JSON object using exactly these keys:
${JSON.stringify(jsonTemplate, null, 2)}

Replace each placeholder with the actual value. Do not include any other text, markdown, or explanation. Only output the JSON object.`;
  }

  return prompt;
}

interface ParsedAIResponse {
  displayValue: string;
  structuredData: Record<string, string | number | null> | undefined;
}

function parseAIResponse(response: string): ParsedAIResponse {
  // Try to extract JSON from the response
  const cleanedResponse = response.trim();

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(cleanedResponse);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      // It's a valid JSON object - use as structured data
      const dataCount = Object.keys(parsed).length;
      return {
        displayValue: dataCount === 1
          ? String(Object.values(parsed)[0] ?? '')
          : `${dataCount} datapoints`,
        structuredData: parsed as Record<string, string | number | null>,
      };
    }
  } catch {
    // Not valid JSON, try to extract from markdown code blocks
  }

  // Try to find JSON in markdown code blocks
  const jsonBlockMatch = cleanedResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const dataCount = Object.keys(parsed).length;
        return {
          displayValue: dataCount === 1
            ? String(Object.values(parsed)[0] ?? '')
            : `${dataCount} datapoints`,
          structuredData: parsed as Record<string, string | number | null>,
        };
      }
    } catch {
      // Not valid JSON in code block
    }
  }

  // Try to find inline JSON object
  const inlineJsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
  if (inlineJsonMatch) {
    try {
      const parsed = JSON.parse(inlineJsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const dataCount = Object.keys(parsed).length;
        return {
          displayValue: dataCount === 1
            ? String(Object.values(parsed)[0] ?? '')
            : `${dataCount} datapoints`,
          structuredData: parsed as Record<string, string | number | null>,
        };
      }
    } catch {
      // Not valid inline JSON
    }
  }

  // No structured data found - wrap plain text as structured data with "result" key
  // This ensures we always have structured data for extraction
  return {
    displayValue: cleanedResponse,
    structuredData: { result: cleanedResponse },
  };
}

async function callAI(
  prompt: string,
  config: typeof schema.enrichmentConfigs.$inferSelect
): Promise<string> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const apiKey = process.env.GEMINI_API_KEY;

  // Prefer Vertex AI for better rate limits, fall back to Gemini API
  if (projectId) {
    return callVertexAI(prompt, config, projectId);
  } else if (apiKey) {
    return callGeminiAPI(prompt, config, apiKey);
  } else {
    throw new Error('No AI provider configured. Set GOOGLE_CLOUD_PROJECT for Vertex AI or GEMINI_API_KEY for Gemini API.');
  }
}

async function callVertexAI(
  prompt: string,
  config: typeof schema.enrichmentConfigs.$inferSelect,
  projectId: string
): Promise<string> {
  try {
    const { getGenerativeModel } = await import('@/lib/vertex-ai');

    const model = getGenerativeModel(config.model || 'gemini-2.0-flash', {
      temperature: config.temperature ?? 0.7,
      maxOutputTokens: config.maxTokens ?? 1000,
    });

    const result = await model.generateContent(prompt);
    const response = result.response;

    if (response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) {
      return response.candidates[0].content.parts[0].text;
    }

    return '';
  } catch (error) {
    console.error('Vertex AI error:', error);
    throw error;
  }
}

async function callGeminiAPI(
  prompt: string,
  config: typeof schema.enrichmentConfigs.$inferSelect,
  apiKey: string
): Promise<string> {
  try {
    const modelId = config.model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: config.temperature ?? 0.7,
          maxOutputTokens: config.maxTokens ?? 1000,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Gemini API error:', errorData);
      throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    }

    return '';
  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
}

// Export progress checker
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const progress = progressMap.get(jobId);

  if (!progress) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(progress);
}
