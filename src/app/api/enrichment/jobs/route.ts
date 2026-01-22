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

    // Update all cell statuses in a SINGLE SQL query using SQLite json_set
    // This is fast (one round trip) and avoids N individual updates
    // Note: targetColumnId is safe (comes from our column schema, not user input)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).run(sql`
      UPDATE "rows"
      SET data = json_set(
        COALESCE(data, '{}'),
        '$.' || ${targetColumnId},
        json_set(
          COALESCE(json_extract(data, '$.' || ${targetColumnId}), '{}'),
          '$.status',
          'pending'
        )
      )
      WHERE id IN ${rowIds}
    `);

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

// DELETE /api/enrichment/jobs?jobId=xxx OR ?columnId=xxx OR ?all=true OR ?resetStuck=true - Cancel job(s)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const columnId = searchParams.get('columnId');
  const cancelAll = searchParams.get('all') === 'true';
  const resetStuck = searchParams.get('resetStuck') === 'true';

  if (!jobId && !columnId && !cancelAll && !resetStuck) {
    return NextResponse.json({ error: 'jobId, columnId, all=true, or resetStuck=true is required' }, { status: 400 });
  }

  // Reset stuck cell statuses from cancelled jobs
  if (resetStuck) {
    try {
      // Get all cancelled jobs to reset their cell statuses
      const cancelledJobs = await db.select()
        .from(schema.enrichmentJobs)
        .where(eq(schema.enrichmentJobs.status, 'cancelled'));

      let cellsReset = 0;
      for (const job of cancelledJobs) {
        if (job.rowIds && job.targetColumnId) {
          const rowIds = typeof job.rowIds === 'string' ? JSON.parse(job.rowIds) : job.rowIds;
          for (const rowId of rowIds) {
            const row = await db.select().from(schema.rows).where(eq(schema.rows.id, rowId)).limit(1);
            if (row[0]) {
              const data = typeof row[0].data === 'string' ? JSON.parse(row[0].data) : row[0].data;
              if (data[job.targetColumnId] && (data[job.targetColumnId].status === 'processing' || data[job.targetColumnId].status === 'pending')) {
                delete data[job.targetColumnId].status;
                await db.update(schema.rows)
                  .set({ data: JSON.stringify(data) })
                  .where(eq(schema.rows.id, rowId));
                cellsReset++;
              }
            }
          }
        }
      }

      return NextResponse.json({ success: true, message: `Reset ${cellsReset} stuck cells`, cellsReset });
    } catch (error) {
      console.error('Error resetting stuck cells:', error);
      return NextResponse.json({ error: 'Failed to reset stuck cells' }, { status: 500 });
    }
  }

  // Cancel ALL active jobs and reset stuck cell statuses
  if (cancelAll) {
    try {
      // First get all active jobs so we can reset their cell statuses
      const activeJobs = await db.select()
        .from(schema.enrichmentJobs)
        .where(
          or(
            eq(schema.enrichmentJobs.status, 'pending'),
            eq(schema.enrichmentJobs.status, 'running')
          )
        );

      // Cancel the jobs
      await db.update(schema.enrichmentJobs)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(
          or(
            eq(schema.enrichmentJobs.status, 'pending'),
            eq(schema.enrichmentJobs.status, 'running')
          )
        );

      // Reset cell statuses for all affected rows
      for (const job of activeJobs) {
        if (job.rowIds && job.targetColumnId) {
          const rowIds = typeof job.rowIds === 'string' ? JSON.parse(job.rowIds) : job.rowIds;
          // Reset each cell's status to null (not run)
          for (const rowId of rowIds) {
            const row = await db.select().from(schema.rows).where(eq(schema.rows.id, rowId)).limit(1);
            if (row[0]) {
              const data = typeof row[0].data === 'string' ? JSON.parse(row[0].data) : row[0].data;
              if (data[job.targetColumnId]) {
                delete data[job.targetColumnId].status;
                await db.update(schema.rows)
                  .set({ data: JSON.stringify(data) })
                  .where(eq(schema.rows.id, rowId));
              }
            }
          }
        }
      }

      return NextResponse.json({ success: true, message: 'All active jobs cancelled and cell statuses reset', jobsReset: activeJobs.length });
    } catch (error) {
      console.error('Error cancelling all jobs:', error);
      return NextResponse.json({ error: 'Failed to cancel jobs' }, { status: 500 });
    }
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
