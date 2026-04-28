import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import { searchPersonByNameAndDomain, submitEmailFinder } from '@/lib/aiarc-api';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// AI Ark email-finder is async: it accepts a job submission and POSTs results
// back to a webhook URL minutes later. We encode {tableId, rowId, emailColId,
// statusColId} into the webhook URL itself plus an HMAC token, so the webhook
// handler can write to the right cell without a job table.

function signWebhookPayload(parts: string[]): string {
  const secret = process.env.CRON_SECRET || '';
  return createHmac('sha256', secret).update(parts.join(':')).digest('hex');
}

function buildWebhookUrl(
  origin: string,
  tableId: string,
  rowId: string,
  emailColId: string,
  statusColId: string
): string {
  const token = signWebhookPayload([tableId, rowId, emailColId, statusColId]);
  const params = new URLSearchParams({
    tableId,
    rowId,
    emailColId,
    statusColId,
    token,
  });
  return `${origin}/api/find-email/ai-ark/webhook?${params.toString()}`;
}

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

export async function POST(request: NextRequest) {
  try {
    const {
      tableId,
      rowIds,
      inputMode,
      fullNameColumnId,
      firstNameColumnId,
      lastNameColumnId,
      domainColumnId,
      emailColumnId,
      emailStatusColumnId,
    } = await request.json();

    if (!tableId || !rowIds?.length || !domainColumnId || !emailColumnId || !emailStatusColumnId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!process.env.AI_ARC_API_KEY) {
      return NextResponse.json({ error: 'AI_ARC_API_KEY not configured' }, { status: 500 });
    }
    if (!process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'CRON_SECRET not configured (used to sign webhook URLs)' }, { status: 500 });
    }

    const origin = request.nextUrl.origin;
    if (!origin.startsWith('https://')) {
      console.warn(`[ai-ark] Origin "${origin}" is not HTTPS — AI Ark webhooks will not reach localhost.`);
    }

    const rows = await db
      .select()
      .from(schema.rows)
      .where(inArray(schema.rows.id, rowIds));

    const results: Array<{ rowId: string; success: boolean; email: string | null; status: string }> = [];

    // Process rows sequentially. The AI Ark helpers in src/lib/aiarc-api.ts
    // already enforce per-request and per-minute rate limits, so we don't add
    // our own concurrency layer.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const data = row.data as Record<string, CellValue>;

      let domain = data[domainColumnId]?.value?.toString().trim() || '';
      let fullName = '';

      if (inputMode === 'full_name') {
        fullName = data[fullNameColumnId]?.value?.toString().trim() || '';
      } else {
        const firstName = data[firstNameColumnId]?.value?.toString().trim() || '';
        const lastName = data[lastNameColumnId]?.value?.toString().trim() || '';
        fullName = `${firstName} ${lastName}`.trim();
      }

      if (!fullName || !domain) {
        const updatedData = {
          ...data,
          [emailColumnId]: { value: '', status: 'complete' as const },
          [emailStatusColumnId]: { value: 'skipped', status: 'complete' as const },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        results.push({ rowId: row.id, success: true, email: null, status: 'skipped' });
        continue;
      }

      domain = cleanDomain(domain);

      try {
        console.log(`[ai-ark] Row ${i + 1}/${rows.length}: searching ${fullName} @ ${domain}`);
        const match = await searchPersonByNameAndDomain(fullName, domain);

        if (!match) {
          const updatedData = {
            ...data,
            [emailColumnId]: { value: '', status: 'complete' as const },
            [emailStatusColumnId]: { value: 'not_found', status: 'complete' as const },
          };
          await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
          results.push({ rowId: row.id, success: true, email: null, status: 'not_found' });
          continue;
        }

        const webhook = buildWebhookUrl(origin, tableId, row.id, emailColumnId, emailStatusColumnId);
        await submitEmailFinder(webhook, match.trackId, [match.personId]);

        const updatedData = {
          ...data,
          [emailColumnId]: { value: '', status: 'processing' as const },
          [emailStatusColumnId]: { value: 'submitted', status: 'processing' as const },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

        results.push({ rowId: row.id, success: true, email: null, status: 'submitted' });
      } catch (err) {
        console.error(`[ai-ark] Row ${row.id} failed:`, err);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const updatedData = {
          ...data,
          [emailColumnId]: { value: '', status: 'error' as const, error: errorMsg },
          [emailStatusColumnId]: { value: 'error', status: 'error' as const, error: errorMsg },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        results.push({ rowId: row.id, success: false, email: null, status: 'error' });
      }
    }

    const submitted = results.filter((r) => r.status === 'submitted').length;
    const notFound = results.filter((r) => r.status === 'not_found').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errors = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({
      results,
      processedCount: rows.length,
      foundCount: 0, // True found count is unknown until webhook fires
      submittedCount: submitted,
      notFoundCount: notFound,
      skippedCount: skipped,
      errorCount: errors,
      async: true,
      message: submitted > 0
        ? `${submitted} email(s) submitted to AI Ark — results arrive in 1-2 minutes via webhook.`
        : 'No emails submitted.',
    });
  } catch (error) {
    console.error('[ai-ark] Find email error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to submit AI Ark email finder' },
      { status: 500 }
    );
  }
}
