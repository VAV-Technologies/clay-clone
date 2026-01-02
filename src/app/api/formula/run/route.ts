import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { evaluateFormula } from '@/lib/formula/evaluator';
import type { CellValue } from '@/lib/db/schema';

function generateId() {
  return nanoid(12);
}

// In-memory progress tracking (in production, use Redis or similar)
const progressMap = new Map<string, { completed: number; total: number; status: string }>();

// POST /api/formula/run - Run formula on rows
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tableId,
      formula,
      outputColumnName,
      rowIds, // Optional: specific rows to process
      configId, // Optional: existing config to re-run
    } = body;

    if (!tableId || !formula || !outputColumnName) {
      return NextResponse.json(
        { error: 'tableId, formula, and outputColumnName are required' },
        { status: 400 }
      );
    }

    // Get columns for variable substitution
    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    // Get max order for new column placement
    const maxOrder = columns.reduce((max, col) => Math.max(max, col.order), 0);
    const nextOrder = maxOrder + 1;

    // Create or update formula config
    let formulaConfigId = configId;
    const now = new Date();

    if (!formulaConfigId) {
      // Create new formula config
      formulaConfigId = generateId();
      await db.insert(schema.formulaConfigs).values({
        id: formulaConfigId,
        name: outputColumnName,
        formula,
        createdAt: now,
      });
    } else {
      // Update existing formula config
      await db
        .update(schema.formulaConfigs)
        .set({ formula, name: outputColumnName })
        .where(eq(schema.formulaConfigs.id, formulaConfigId));
    }

    // Create output column with formula type and config link
    const columnId = generateId();
    await db.insert(schema.columns).values({
      id: columnId,
      tableId,
      name: outputColumnName,
      type: 'formula',
      width: 150,
      order: nextOrder,
      enrichmentConfigId: null,
      formulaConfigId,
    });

    // Get rows to process
    let rows;
    if (rowIds && Array.isArray(rowIds) && rowIds.length > 0) {
      rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));
    } else {
      rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
    }

    if (rows.length === 0) {
      return NextResponse.json({
        jobId: null,
        columnId,
        message: 'No rows to process'
      });
    }

    // Generate job ID for progress tracking
    const jobId = generateId();

    // Initialize progress
    progressMap.set(jobId, {
      completed: 0,
      total: rows.length,
      status: 'running',
    });

    // Process rows asynchronously
    processFormulaBatch(jobId, formula, rows, columns, columnId);

    return NextResponse.json({ jobId, columnId });
  } catch (error) {
    console.error('Error running formula:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to run formula' },
      { status: 500 }
    );
  }
}

// GET /api/formula/run?jobId=xxx - Get progress
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const progress = progressMap.get(jobId);

  if (!progress) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(progress);
}

async function processFormulaBatch(
  jobId: string,
  formula: string,
  rows: Array<{ id: string; data: Record<string, CellValue>; tableId: string | null }>,
  columns: Array<{ id: string; name: string; type: string }>,
  outputColumnId: string
) {
  const BATCH_SIZE = 10; // Process 10 rows at a time
  let completed = 0;

  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      await Promise.all(
        batch.map(async (row) => {
          try {
            // Evaluate formula for this row
            const result = evaluateFormula(formula, {
              row: row.data as Record<string, { value: string | number | null }>,
              columns: columns.map(c => ({ id: c.id, name: c.name })),
            });

            // Update row with computed value
            const updatedData = {
              ...row.data,
              [outputColumnId]: {
                value: result.value,
                status: result.error ? 'error' : 'complete',
                error: result.error,
              },
            } as Record<string, CellValue>;

            await db
              .update(schema.rows)
              .set({ data: updatedData })
              .where(eq(schema.rows.id, row.id));
          } catch (error) {
            console.error(`Error processing row ${row.id}:`, error);

            // Mark cell as error
            const updatedData = {
              ...row.data,
              [outputColumnId]: {
                value: null,
                status: 'error',
                error: (error as Error).message,
              },
            } as Record<string, CellValue>;

            await db
              .update(schema.rows)
              .set({ data: updatedData })
              .where(eq(schema.rows.id, row.id));
          }

          completed++;
          progressMap.set(jobId, {
            completed,
            total: rows.length,
            status: completed === rows.length ? 'complete' : 'running',
          });
        })
      );

      // Small delay between batches to prevent overwhelming the system
      if (i + BATCH_SIZE < rows.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Ensure final status is set
    progressMap.set(jobId, {
      completed: rows.length,
      total: rows.length,
      status: 'complete',
    });

    // Clean up progress after 5 minutes
    setTimeout(() => {
      progressMap.delete(jobId);
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error in formula batch processing:', error);
    progressMap.set(jobId, {
      completed,
      total: rows.length,
      status: 'error',
    });
  }
}
