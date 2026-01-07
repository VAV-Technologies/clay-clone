import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

// GET /api/cron/complete-job?jobId=xxx - Force complete a stuck job
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  }

  try {
    await db.update(schema.enrichmentJobs)
      .set({
        status: 'complete',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(schema.enrichmentJobs.id, jobId));

    return NextResponse.json({ success: true, message: 'Job marked as complete' });
  } catch (error) {
    console.error('Error completing job:', error);
    return NextResponse.json({ error: 'Failed to complete job' }, { status: 500 });
  }
}
