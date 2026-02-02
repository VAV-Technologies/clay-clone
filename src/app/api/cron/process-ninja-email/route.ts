import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import {
  cleanFullName,
  combineNames,
  cleanDomain,
  getVerificationToken,
  findEmail,
  delay,
  RATE_LIMIT_DELAY,
} from '@/lib/ninja-email';

// Vercel function config
export const maxDuration = 60;

const BATCH_SIZE = 50; // Process 50 rows per cron run (rate limited)
const STALE_JOB_MINUTES = 30;
const MAX_EXECUTION_MS = 55000;

// GET /api/cron/process-ninja-email - Called by Vercel cron
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get API key
    const apiKey = process.env.MAILNINJA_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        message: 'MAILNINJA_API_KEY not configured',
        processed: 0,
      });
    }

    // Get API token
    let token: string;
    try {
      token = await getVerificationToken(apiKey);
    } catch (error) {
      console.error('Failed to get ninja API token:', error);
      return NextResponse.json({
        message: 'Failed to get API token',
        error: (error as Error).message,
      }, { status: 500 });
    }

    let totalProcessed = 0;
    let totalFound = 0;
    let totalNotFound = 0;
    let totalErrors = 0;

    // Keep processing until we're close to timeout
    while (Date.now() - startTime < MAX_EXECUTION_MS) {
      // Find active jobs (pending or running)
      const activeJobs = await db
        .select()
        .from(schema.ninjaEmailJobs)
        .where(
          or(
            eq(schema.ninjaEmailJobs.status, 'pending'),
            eq(schema.ninjaEmailJobs.status, 'running')
          )
        )
        .limit(1);

      if (activeJobs.length === 0) {
        return NextResponse.json({
          message: 'No active jobs',
          processed: totalProcessed,
          found: totalFound,
          notFound: totalNotFound,
          errors: totalErrors,
          timeMs: Date.now() - startTime,
        });
      }

      const job = activeJobs[0];

      // Check for stale jobs
      const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
      const minutesSinceUpdate = (Date.now() - updatedAt) / 1000 / 60;

      if (minutesSinceUpdate > STALE_JOB_MINUTES && job.currentIndex > 0) {
        console.log(`Ninja job ${job.id} is stale (${minutesSinceUpdate.toFixed(1)} min), marking complete`);

        // Clean up any cells still at 'processing' status
        const staleCells = await db
          .select()
          .from(schema.rows)
          .where(inArray(schema.rows.id, job.rowIds));

        await Promise.all(staleCells.map(row => {
          const cellValue = (row.data as Record<string, CellValue>)[job.targetColumnId];
          if (cellValue?.status === 'processing') {
            const updatedData = {
              ...(row.data as Record<string, CellValue>),
              [job.targetColumnId]: {
                ...cellValue,
                status: 'error' as const,
                error: 'Processing timed out. Please retry.',
              },
            };
            return db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
          }
          return Promise.resolve();
        }));

        await db.update(schema.ninjaEmailJobs)
          .set({
            status: 'complete',
            updatedAt: new Date(),
            completedAt: new Date(),
          })
          .where(eq(schema.ninjaEmailJobs.id, job.id));
        continue;
      }

      // Check if we have enough time for another batch
      if (Date.now() - startTime > MAX_EXECUTION_MS - 15000) {
        break; // Not enough time for another batch (need ~15s for 50 rows at 170ms each)
      }

      const result = await processJobBatch(job, token);
      totalProcessed += result.processed;
      totalFound += result.found;
      totalNotFound += result.notFound;
      totalErrors += result.errors;

      // If no rows processed, job might be complete
      if (result.processed === 0) {
        break;
      }
    }

    return NextResponse.json({
      message: `Processed ${totalProcessed} rows`,
      processed: totalProcessed,
      found: totalFound,
      notFound: totalNotFound,
      errors: totalErrors,
      timeMs: Date.now() - startTime,
    });

  } catch (error) {
    console.error('Ninja email cron error:', error);
    return NextResponse.json({ error: 'Cron processing failed' }, { status: 500 });
  }
}

async function processJobBatch(
  job: typeof schema.ninjaEmailJobs.$inferSelect,
  token: string
): Promise<{ processed: number; found: number; notFound: number; errors: number }> {
  const { id: jobId, tableId, targetColumnId, rowIds, currentIndex } = job;

  // Check if job is complete
  if (currentIndex >= rowIds.length) {
    await db.update(schema.ninjaEmailJobs)
      .set({
        status: 'complete',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(schema.ninjaEmailJobs.id, jobId));
    return { processed: 0, found: 0, notFound: 0, errors: 0 };
  }

  // Mark as running
  await db.update(schema.ninjaEmailJobs)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(schema.ninjaEmailJobs.id, jobId));

  // Get columns
  const columns = await db
    .select()
    .from(schema.columns)
    .where(eq(schema.columns.tableId, tableId));

  const columnMap = new Map(columns.map(col => [col.id, col]));

  // Get batch of row IDs
  const batchRowIds = rowIds.slice(currentIndex, currentIndex + BATCH_SIZE);

  // Get actual rows
  const rows = await db
    .select()
    .from(schema.rows)
    .where(inArray(schema.rows.id, batchRowIds));

  if (rows.length === 0) {
    await db.update(schema.ninjaEmailJobs)
      .set({
        status: 'complete',
        currentIndex: rowIds.length,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(schema.ninjaEmailJobs.id, jobId));
    return { processed: 0, found: 0, notFound: 0, errors: 0 };
  }

  // Mark cells as processing
  await Promise.all(rows.map(row => {
    const currentCellValue = (row.data as Record<string, CellValue>)[targetColumnId] || {};
    const updatedData = {
      ...(row.data as Record<string, CellValue>),
      [targetColumnId]: {
        ...currentCellValue,
        status: 'processing' as const,
      },
    };
    return db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
  }));

  let found = 0;
  let notFound = 0;
  let errors = 0;

  // Process rows sequentially (rate limited)
  for (const row of rows) {
    try {
      // Extract name based on input mode
      let name: string;
      if (job.inputMode === 'fullName' && job.fullNameColumnId) {
        const fullNameValue = row.data[job.fullNameColumnId]?.value;
        name = cleanFullName(String(fullNameValue || ''));
      } else if (job.inputMode === 'firstLast' && job.firstNameColumnId && job.lastNameColumnId) {
        const firstName = row.data[job.firstNameColumnId]?.value;
        const lastName = row.data[job.lastNameColumnId]?.value;
        name = combineNames(String(firstName || ''), String(lastName || ''));
      } else {
        name = '';
      }

      // Extract domain
      const domainValue = row.data[job.domainColumnId]?.value;
      const domain = cleanDomain(String(domainValue || ''));

      let cellUpdate: CellValue;

      if (!name || !domain) {
        // Invalid input
        cellUpdate = {
          value: null,
          status: 'complete' as const,
          error: !name ? 'Invalid or empty name' : 'Invalid or empty domain',
          enrichmentData: { name, domain },
        };
        notFound++;
      } else {
        // Call API
        const result = await findEmail(name, domain, token);

        if (result.success && result.email) {
          cellUpdate = {
            value: result.email,
            status: 'complete' as const,
            enrichmentData: {
              email: result.email,
              verificationStatus: result.status || 'unknown',
              confidence: result.confidence || 'unknown',
              name,
              domain,
            },
          };
          found++;
        } else {
          cellUpdate = {
            value: 'Not Found',
            status: 'complete' as const,
            enrichmentData: {
              name,
              domain,
              error: result.error || 'No valid email found',
            },
          };
          notFound++;
        }
      }

      // Update row
      const updatedData: Record<string, CellValue> = {
        ...(row.data as Record<string, CellValue>),
        [targetColumnId]: cellUpdate,
      };
      await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

      // Rate limit delay
      await delay(RATE_LIMIT_DELAY);

    } catch (error) {
      console.error(`Error processing ninja row ${row.id}:`, error);
      errors++;

      const updatedData: Record<string, CellValue> = {
        ...(row.data as Record<string, CellValue>),
        [targetColumnId]: {
          value: null,
          status: 'error' as const,
          error: (error as Error).message,
        },
      };
      await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
    }
  }

  // Update job progress
  const newIndex = currentIndex + batchRowIds.length;
  const isComplete = newIndex >= rowIds.length;

  await db.update(schema.ninjaEmailJobs)
    .set({
      currentIndex: newIndex,
      processedCount: job.processedCount + batchRowIds.length,
      foundCount: job.foundCount + found,
      notFoundCount: job.notFoundCount + notFound,
      errorCount: job.errorCount + errors,
      status: isComplete ? 'complete' : 'running',
      updatedAt: new Date(),
      completedAt: isComplete ? new Date() : null,
    })
    .where(eq(schema.ninjaEmailJobs.id, jobId));

  return { processed: batchRowIds.length, found, notFound, errors };
}
