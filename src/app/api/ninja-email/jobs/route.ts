import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { nanoid } from 'nanoid';
import { eq, and, inArray, desc } from 'drizzle-orm';

/**
 * GET /api/ninja-email/jobs
 * Get jobs by tableId or columnId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tableId = searchParams.get('tableId');
    const columnId = searchParams.get('columnId');

    if (!tableId && !columnId) {
      return NextResponse.json(
        { error: 'tableId or columnId is required' },
        { status: 400 }
      );
    }

    let jobs;
    if (columnId) {
      jobs = await db
        .select()
        .from(schema.ninjaEmailJobs)
        .where(eq(schema.ninjaEmailJobs.targetColumnId, columnId))
        .orderBy(desc(schema.ninjaEmailJobs.createdAt));
    } else {
      jobs = await db
        .select()
        .from(schema.ninjaEmailJobs)
        .where(eq(schema.ninjaEmailJobs.tableId, tableId!))
        .orderBy(desc(schema.ninjaEmailJobs.createdAt));
    }

    // Format for client
    const formattedJobs = jobs.map(job => ({
      id: job.id,
      status: job.status,
      totalRows: job.rowIds.length,
      processedCount: job.processedCount,
      foundCount: job.foundCount,
      notFoundCount: job.notFoundCount,
      errorCount: job.errorCount,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
    }));

    return NextResponse.json({ jobs: formattedJobs });

  } catch (error) {
    console.error('Error fetching ninja email jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ninja-email/jobs
 * Create a new ninja email finder job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tableId,
      rowIds,
      inputMode,
      fullNameColumnId,
      firstNameColumnId,
      lastNameColumnId,
      domainColumnId,
      outputColumnName,
    } = body;

    // Use env variable for API key
    const ninjaApiKey = process.env.MAILNINJA_API_KEY;
    if (!ninjaApiKey) {
      return NextResponse.json(
        { error: 'MailNinja API key not configured on server' },
        { status: 500 }
      );
    }

    // Validate required fields
    if (!tableId || !rowIds || !Array.isArray(rowIds) || rowIds.length === 0) {
      return NextResponse.json(
        { error: 'tableId and rowIds are required' },
        { status: 400 }
      );
    }

    if (!inputMode || !domainColumnId) {
      return NextResponse.json(
        { error: 'inputMode and domainColumnId are required' },
        { status: 400 }
      );
    }

    if (inputMode === 'fullName' && !fullNameColumnId) {
      return NextResponse.json(
        { error: 'fullNameColumnId is required for fullName mode' },
        { status: 400 }
      );
    }

    if (inputMode === 'firstLast' && (!firstNameColumnId || !lastNameColumnId)) {
      return NextResponse.json(
        { error: 'firstNameColumnId and lastNameColumnId are required for firstLast mode' },
        { status: 400 }
      );
    }

    // Create or get output column
    const existingColumns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    let targetColumn = existingColumns.find(
      col => col.name.toLowerCase() === outputColumnName.toLowerCase()
    );

    if (!targetColumn) {
      const maxOrder = existingColumns.length > 0
        ? Math.max(...existingColumns.map(c => c.order))
        : 0;

      const newColumn: schema.NewColumn = {
        id: nanoid(12),
        tableId,
        name: outputColumnName,
        type: 'text' as const,
        order: maxOrder + 1,
        width: 200,
        enrichmentConfigId: null,
        formulaConfigId: null,
      };

      await db.insert(schema.columns).values(newColumn);
      targetColumn = newColumn as schema.Column;
    }

    // Create the job
    const jobId = nanoid(12);
    const now = new Date();

    const newJob: schema.NewNinjaEmailJob = {
      id: jobId,
      tableId,
      targetColumnId: targetColumn!.id,
      inputMode: inputMode as 'fullName' | 'firstLast',
      fullNameColumnId: inputMode === 'fullName' ? fullNameColumnId : null,
      firstNameColumnId: inputMode === 'firstLast' ? firstNameColumnId : null,
      lastNameColumnId: inputMode === 'firstLast' ? lastNameColumnId : null,
      domainColumnId,
      apiKey: null, // API key from env variable only
      rowIds,
      currentIndex: 0,
      status: 'pending',
      processedCount: 0,
      foundCount: 0,
      notFoundCount: 0,
      errorCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.ninjaEmailJobs).values(newJob);

    // Mark cells as pending
    const rowsToUpdate = await db
      .select()
      .from(schema.rows)
      .where(
        and(
          eq(schema.rows.tableId, tableId),
          inArray(schema.rows.id, rowIds)
        )
      );

    for (const row of rowsToUpdate) {
      const newData = { ...row.data };
      newData[targetColumn!.id] = {
        value: null,
        status: 'pending' as const,
      };

      await db
        .update(schema.rows)
        .set({ data: newData })
        .where(eq(schema.rows.id, row.id));
    }

    return NextResponse.json({
      jobId,
      totalRows: rowIds.length,
      columnId: targetColumn!.id,
      columnName: targetColumn!.name,
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating ninja email job:', error);
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ninja-email/jobs
 * Cancel jobs
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const columnId = searchParams.get('columnId');

    if (!jobId && !columnId) {
      return NextResponse.json(
        { error: 'jobId or columnId is required' },
        { status: 400 }
      );
    }

    if (jobId) {
      await db
        .update(schema.ninjaEmailJobs)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(schema.ninjaEmailJobs.id, jobId));
    } else {
      await db
        .update(schema.ninjaEmailJobs)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(
          and(
            eq(schema.ninjaEmailJobs.targetColumnId, columnId!),
            inArray(schema.ninjaEmailJobs.status, ['pending', 'running'])
          )
        );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error cancelling ninja email job:', error);
    return NextResponse.json(
      { error: 'Failed to cancel job' },
      { status: 500 }
    );
  }
}
