import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// POST /api/enrichment/jobs - Create a new background job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { configId, tableId, targetColumnId, rowIds } = body;

    if (!configId || !tableId || !targetColumnId || !rowIds?.length) {
      return NextResponse.json(
        { error: 'configId, tableId, targetColumnId, and rowIds are required' },
        { status: 400 }
      );
    }

    // Auto-cancel any existing active jobs for this column (fast - single update)
    await db.update(schema.enrichmentJobs)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.enrichmentJobs.targetColumnId, targetColumnId),
          or(
            eq(schema.enrichmentJobs.status, 'pending'),
            eq(schema.enrichmentJobs.status, 'running')
          )
        )
      );

    // Create new job
    const jobId = nanoid(12);
    const now = new Date();

    await db.insert(schema.enrichmentJobs).values({
      id: jobId,
      tableId,
      configId,
      targetColumnId,
      rowIds,
      currentIndex: 0,
      status: 'pending',
      processedCount: 0,
      errorCount: 0,
      totalCost: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Update all cell statuses in a SINGLE SQL query using jsonb_set
    // This is fast (one round trip) and avoids N individual updates
    // Note: targetColumnId is safe (comes from our column schema, not user input)
    await db.execute(sql.raw(`
      UPDATE "rows"
      SET data = jsonb_set(
        COALESCE(data, '{}'),
        ARRAY['${targetColumnId}'],
        COALESCE(data->'${targetColumnId}', '{}') || '{"status": "pending"}'::jsonb
      )
      WHERE id = ANY(ARRAY[${rowIds.map((id: string) => `'${id}'`).join(',')}])
    `));

    return NextResponse.json({
      jobId,
      message: 'Job created successfully',
      totalRows: rowIds.length,
    });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}

// GET /api/enrichment/jobs?columnId=xxx - Get job status for a column
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const columnId = searchParams.get('columnId');
  const jobId = searchParams.get('jobId');

  try {
    let jobs;

    if (jobId) {
      jobs = await db
        .select()
        .from(schema.enrichmentJobs)
        .where(eq(schema.enrichmentJobs.id, jobId));
    } else if (columnId) {
      // Only get active jobs for this column (faster query)
      jobs = await db
        .select()
        .from(schema.enrichmentJobs)
        .where(
          and(
            eq(schema.enrichmentJobs.targetColumnId, columnId),
            or(
              eq(schema.enrichmentJobs.status, 'pending'),
              eq(schema.enrichmentJobs.status, 'running')
            )
          )
        );
    } else {
      // Get all active jobs
      jobs = await db
        .select()
        .from(schema.enrichmentJobs)
        .where(
          or(
            eq(schema.enrichmentJobs.status, 'pending'),
            eq(schema.enrichmentJobs.status, 'running')
          )
        );
    }

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}

// DELETE /api/enrichment/jobs?jobId=xxx OR ?columnId=xxx - Cancel job(s)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const columnId = searchParams.get('columnId');

  if (!jobId && !columnId) {
    return NextResponse.json({ error: 'jobId or columnId is required' }, { status: 400 });
  }

  try {
    if (jobId) {
      // Cancel single job by ID
      await db.update(schema.enrichmentJobs)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(schema.enrichmentJobs.id, jobId));

      return NextResponse.json({ success: true, message: 'Job cancelled' });
    } else if (columnId) {
      // Cancel all active jobs for this column
      await db.update(schema.enrichmentJobs)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.enrichmentJobs.targetColumnId, columnId),
            or(
              eq(schema.enrichmentJobs.status, 'pending'),
              eq(schema.enrichmentJobs.status, 'running')
            )
          )
        );

      return NextResponse.json({ success: true, message: 'All jobs for column cancelled' });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    console.error('Error cancelling job:', error);
    return NextResponse.json({ error: 'Failed to cancel job' }, { status: 500 });
  }
}
