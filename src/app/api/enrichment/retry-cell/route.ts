import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

// POST /api/enrichment/retry-cell - Retry enrichment on a single cell
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rowId, columnId, tableId } = body;

    if (!rowId || !columnId || !tableId) {
      return NextResponse.json(
        { error: 'rowId, columnId, and tableId are required' },
        { status: 400 }
      );
    }

    // Get the column to find its enrichment config
    const [column] = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.id, columnId));

    if (!column || !column.enrichmentConfigId) {
      return NextResponse.json(
        { error: 'Column is not an enrichment column or has no config' },
        { status: 400 }
      );
    }

    // Get the enrichment config
    const [config] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, column.enrichmentConfigId));

    if (!config) {
      return NextResponse.json(
        { error: 'Enrichment config not found' },
        { status: 404 }
      );
    }

    // Get the row
    const [row] = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.id, rowId));

    if (!row) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    // Get all columns for variable substitution
    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    const columnMap = new Map(columns.map((col) => [col.id, col]));

    // Build output column ID map if config has output columns
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

    // Mark cell as processing
    const updatedData: Record<string, CellValue> = {
      ...(row.data as Record<string, CellValue>),
      [columnId]: {
        value: null,
        status: 'processing' as const,
      },
    };

    // Also mark output columns as processing
    if (hasOutputColumns) {
      for (const colId of Object.values(outputColumnIds)) {
        updatedData[colId] = {
          value: null,
          status: 'processing' as const,
        };
      }
    }

    await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, rowId));

    // Build prompt with variable substitution and JSON format instructions
    const prompt = buildPrompt(config.prompt, row, columnMap, definedOutputColumns || []);

    // Call AI
    try {
      const result = await callAI(prompt, config);

      // Parse the result for structured data
      const parsedResult = parseAIResponse(result);

      // Update with result
      const finalData: Record<string, CellValue> = {
        ...(row.data as Record<string, CellValue>),
        [columnId]: {
          value: parsedResult.displayValue,
          status: 'complete' as const,
          enrichmentData: parsedResult.structuredData,
          rawResponse: result,
        },
      };

      // If we have output columns defined, populate them with extracted values
      if (hasOutputColumns && parsedResult.structuredData) {
        for (const [outputName, colId] of Object.entries(outputColumnIds)) {
          const matchingKey = Object.keys(parsedResult.structuredData).find(
            key => key.toLowerCase() === outputName
          );

          if (matchingKey) {
            const value = parsedResult.structuredData[matchingKey];
            finalData[colId] = {
              value: value !== null && value !== undefined ? String(value) : null,
              status: 'complete' as const,
            };
          } else {
            finalData[colId] = {
              value: null,
              status: 'complete' as const,
            };
          }
        }
      }

      await db.update(schema.rows).set({ data: finalData }).where(eq(schema.rows.id, rowId));

      return NextResponse.json({
        success: true,
        result: parsedResult.displayValue,
        enrichmentData: parsedResult.structuredData,
      });
    } catch (error) {
      // Mark as error
      const errorData: Record<string, CellValue> = {
        ...(row.data as Record<string, CellValue>),
        [columnId]: {
          value: null,
          status: 'error' as const,
          error: (error as Error).message,
        },
      };

      // Also mark output columns as error
      if (hasOutputColumns) {
        for (const colId of Object.values(outputColumnIds)) {
          errorData[colId] = {
            value: null,
            status: 'error' as const,
            error: (error as Error).message,
          };
        }
      }

      await db.update(schema.rows).set({ data: errorData }).where(eq(schema.rows.id, rowId));

      return NextResponse.json({ success: false, error: (error as Error).message });
    }
  } catch (error) {
    console.error('Error retrying cell enrichment:', error);
    return NextResponse.json({ error: 'Failed to retry enrichment' }, { status: 500 });
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

async function callAI(
  prompt: string,
  config: typeof schema.enrichmentConfigs.$inferSelect
): Promise<string> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const apiKey = process.env.GEMINI_API_KEY;

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
  const { getGenerativeModel } = await import('@/lib/vertex-ai');

  const model = getGenerativeModel(config.model || 'gemini-2.0-flash', {
    temperature: config.temperature ?? 0.7,
    maxOutputTokens: 8192, // No token limit for retries
  });

  const result = await model.generateContent(prompt);
  const response = result.response;

  if (response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) {
    return response.candidates[0].content.parts[0].text;
  }

  return '';
}

async function callGeminiAPI(
  prompt: string,
  config: typeof schema.enrichmentConfigs.$inferSelect,
  apiKey: string
): Promise<string> {
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
        maxOutputTokens: 8192, // No token limit for retries
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }

  return '';
}

interface ParsedAIResponse {
  displayValue: string;
  structuredData: Record<string, string | number | null> | undefined;
}

function parseAIResponse(response: string): ParsedAIResponse {
  const cleanedResponse = response.trim();

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(cleanedResponse);
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
    // Not valid JSON
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
