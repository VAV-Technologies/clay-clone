import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { evaluateFormula } from '@/lib/formula/evaluator';
import type { CellValue } from '@/lib/db/schema';

function generateId() {
  return nanoid(12);
}

// In-memory progress tracking
const progressMap = new Map<string, { completed: number; total: number; status: string }>();

// POST /api/formula/rerun - Re-run formula on existing column
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      columnId,
      configId,
      formula,
      outputColumnName,
      rowIds, // Optional: specific rows to process
    } = body;

    if (!columnId || !formula) {
      return NextResponse.json(
        { error: 'columnId and formula are required' },
        { status: 400 }
      );
    }

    // Get the column
    const [column] = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.id, columnId));

    if (!column) {
      return NextResponse.json({ error: 'Column not found' }, { status: 404 });
    }

    const tableId = column.tableId!;

    // Update formula config if provided
    if (configId) {
      await db
        .update(schema.formulaConfigs)
        .set({ formula, name: outputColumnName || column.name })
        .where(eq(schema.formulaConfigs.id, configId));
    }

    // Update column name if changed
    if (outputColumnName && outputColumnName !== column.name) {
      await db
        .update(schema.columns)
        .set({ name: outputColumnName })
        .where(eq(schema.columns.id, columnId));
    }

    // Get columns for variable substitution
    const columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

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
    console.error('Error re-running formula:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to re-run formula' },
      { status: 500 }
    );
  }
}

// GET /api/formula/rerun?jobId=xxx - Get progress
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
  const BATCH_SIZE = 10;
  let completed = 0;

  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (row) => {
          try {
            const result = evaluateFormula(formula, {
              row: row.data as Record<string, { value: string | number | null }>,
              columns: columns.map(c => ({ id: c.id, name: c.name })),
            });

            const updatedData: Record<string, CellValue> = {
              ...row.data,
              [outputColumnId]: {
                value: result.value,
                status: result.error ? 'error' : 'complete',
                error: result.error,
              },
            };

            await db
              .update(schema.rows)
              .set({ data: updatedData })
              .where(eq(schema.rows.id, row.id));
          } catch (error) {
            console.error(`Error processing row ${row.id}:`, error);

            const updatedData: Record<string, CellValue> = {
              ...row.data,
              [outputColumnId]: {
                value: null,
                status: 'error',
                error: (error as Error).message,
              },
            };

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

      if (i + BATCH_SIZE < rows.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    progressMap.set(jobId, {
      completed: rows.length,
      total: rows.length,
      status: 'complete',
    });

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
