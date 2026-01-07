import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, and, or } from 'drizzle-orm';
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

    // Auto-cancel any existing active jobs for this column (instead of blocking)
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

    // Mark all target cells as 'processing' in the database
    const rows = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.tableId, tableId));

    const rowIdSet = new Set(rowIds);
    for (const row of rows) {
      if (rowIdSet.has(row.id)) {
        const updatedData = {
          ...(row.data as Record<string, unknown>),
          [targetColumnId]: {
            value: null,
            status: 'processing' as const,
          },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
      }
    }

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

  const STALE_JOB_MINUTES = 10;

  try {
    let jobs;

    if (jobId) {
      jobs = await db
        .select()
        .from(schema.enrichmentJobs)
        .where(eq(schema.enrichmentJobs.id, jobId));
    } else if (columnId) {
      jobs = await db
        .select()
        .from(schema.enrichmentJobs)
        .where(eq(schema.enrichmentJobs.targetColumnId, columnId));
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

    // Auto-complete stale jobs (not updated in 10+ minutes)
    const now = Date.now();
    for (const job of jobs) {
      if (job.status === 'pending' || job.status === 'running') {
        const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
        const minutesSinceUpdate = (now - updatedAt) / 1000 / 60;

        if (minutesSinceUpdate > STALE_JOB_MINUTES) {
          await db.update(schema.enrichmentJobs)
            .set({
              status: 'complete',
              updatedAt: new Date(),
              completedAt: new Date(),
            })
            .where(eq(schema.enrichmentJobs.id, job.id));
          job.status = 'complete';
        }
      }
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
