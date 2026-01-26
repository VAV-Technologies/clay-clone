import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

// POST /api/admin/batch-mark-complete?jobId=XXX
// Force-marks a job as complete (for jobs that processed but failed to update status)
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  try {
    // Get the job from database
    const [job] = await db
      .select()
      .from(schema.batchEnrichmentJobs)
      .where(eq(schema.batchEnrichmentJobs.id, jobId));

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Update job status to complete
    await db
      .update(schema.batchEnrichmentJobs)
      .set({
        status: 'complete',
        completedAt: new Date(),
        updatedAt: new Date(),
        // Reset any NaN values
        totalCost: job.totalCost && !isNaN(job.totalCost) ? job.totalCost : 0,
        totalInputTokens: job.totalInputTokens && !isNaN(job.totalInputTokens) ? job.totalInputTokens : 0,
        totalOutputTokens: job.totalOutputTokens && !isNaN(job.totalOutputTokens) ? job.totalOutputTokens : 0,
      })
      .where(eq(schema.batchEnrichmentJobs.id, job.id));

    return NextResponse.json({
      success: true,
      jobId: job.id,
      previousStatus: job.status,
      newStatus: 'complete',
    });

  } catch (error) {
    console.error('Error in batch-mark-complete:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to mark batch job as complete' },
      { status: 500 }
    );
  }
}
