import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';

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
    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

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
    processEnrichmentBatch(jobId, rows, config, targetColumnId, columnMap);

    return NextResponse.json({
      jobId,
      message: 'Enrichment started',
      totalRows: rows.length,
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
  columnMap: Map<string, typeof schema.columns.$inferSelect>
) {
  const batchSize = 5;
  const delayMs = 1000;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (row) => {
        try {
          // Build prompt with variable substitution
          const prompt = buildPrompt(config.prompt, row, columnMap);

          // Call AI (mock for now, replace with actual Vertex AI call)
          const result = await callAI(prompt, config);

          // Update row with result
          const updatedData = {
            ...row.data,
            [targetColumnId]: {
              value: result,
              status: 'complete' as const,
            },
          };

          await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        } catch (error) {
          console.error(`Error enriching row ${row.id}:`, error);

          // Mark as error
          const updatedData = {
            ...row.data,
            [targetColumnId]: {
              value: null,
              status: 'error' as const,
              error: (error as Error).message,
            },
          };

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
  columnMap: Map<string, typeof schema.columns.$inferSelect>
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

  return prompt;
}

async function callAI(
  prompt: string,
  config: typeof schema.enrichmentConfigs.$inferSelect
): Promise<string> {
  // Check if Vertex AI is configured
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    // Return mock response for development
    return `[AI Response for: "${prompt.substring(0, 50)}..."]`;
  }

  try {
    // Dynamic import to avoid build errors when not configured
    const { VertexAI } = await import('@google-cloud/vertexai');

    const vertexAI = new VertexAI({
      project: projectId,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    });

    const model = vertexAI.getGenerativeModel({
      model: config.model,
      generationConfig: {
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens ?? 1000,
      },
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
