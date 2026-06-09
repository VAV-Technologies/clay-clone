import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import { getColumnIdSet, invalidColumnIds, COLUMN_SCOPE_MESSAGE } from '@/lib/api-validation';
import { getSecret } from '@/lib/secrets';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// BetterEnrich "Find Work Email" runs its OWN multi-source waterfall and is
// asynchronous: POST /find-work-email submits a task and returns { id }; the
// result is fetched by polling GET /find-work-email?id=<id> until it flips from
// 202 (in progress) to 200 (done). We hide that behind a synchronous route
// (submit -> poll -> write cell) so the Find Email panel, retry-cell, and the
// campaign waterfall treat BetterEnrich exactly like the other sync providers
// (Ninjer / TryKitt) — no inbound webhook + HMAC infra needed.
//
// Auth: a RAW token in the `Authorization` header — NOT `Bearer <key>`.
// Confirmed against the live API: Bearer / x-api-key / api-key all return 401;
// `Authorization: <key>` returns 201. The header is isolated in one helper so
// the format is a one-line change if BetterEnrich ever changes it.

const BETTERENRICH_BASE_URL = 'https://app.betterenrich.com/api/v1';
const CONCURRENT_REQUESTS = 4; // well under BetterEnrich's 10 req/s (submit + polls combined)
const DELAY_BETWEEN_BATCHES_MS = 150;
const SUBMIT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 90000; // per-row cap waiting for the result to resolve

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function betterEnrichHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: apiKey, // raw token, no "Bearer " prefix
    'User-Agent': 'dataflow/1.0',
  };
}

function looksLikeEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

interface BetterEnrichResult {
  status: string; // 'found' | 'not_found' | 'error'
  email: string | null;
  verification: string | null; // data.status, e.g. 'valid'
  verifier: string | null; // data.verifier, e.g. 'Catch-all Verifier'
  esp: string | null; // data.ESP, e.g. 'Google Workspace'
}

const EMPTY_RESULT = (status: string): BetterEnrichResult => ({
  status,
  email: null,
  verification: null,
  verifier: null,
  esp: null,
});

async function callBetterEnrichAPI(
  fullName: string,
  domain: string,
  linkedinUrl: string,
  apiKey: string
): Promise<BetterEnrichResult> {
  const headers = betterEnrichHeaders(apiKey);

  // 1) Submit the enrichment task → { message: 'Success', id }.
  const submitController = new AbortController();
  const submitTimeout = setTimeout(() => submitController.abort(), SUBMIT_TIMEOUT_MS);
  let taskId: string;
  try {
    const body: Record<string, string> = { full_name: fullName, company_domain: domain };
    if (linkedinUrl) body.linkedinURL = linkedinUrl;

    const res = await fetch(`${BETTERENRICH_BASE_URL}/find-work-email`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: submitController.signal,
    });

    if (res.status === 401) throw new Error('Invalid BetterEnrich API key');
    if (res.status === 403) throw new Error('BetterEnrich: insufficient credits');
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`BetterEnrich submit error ${res.status}: ${t.slice(0, 200)}`);
    }

    const json = await res.json();
    taskId = json?.id;
    if (!taskId) throw new Error('BetterEnrich submit returned no task id');
  } catch (err) {
    if ((err as Error).name === 'AbortError') return EMPTY_RESULT('error');
    throw err;
  } finally {
    clearTimeout(submitTimeout);
  }

  // 2) Poll for the result. 202 = in progress, 200 = done.
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_MAX_MS) {
    await sleep(POLL_INTERVAL_MS);

    const pollController = new AbortController();
    const pollTimeout = setTimeout(() => pollController.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await fetch(
        `${BETTERENRICH_BASE_URL}/find-work-email?id=${encodeURIComponent(taskId)}`,
        { method: 'GET', headers, signal: pollController.signal }
      );

      if (res.status === 202) continue; // still processing
      if (res.status === 401) throw new Error('Invalid BetterEnrich API key');
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`BetterEnrich poll error ${res.status}: ${t.slice(0, 200)}`);
      }

      // Done. Shape: { id, data: { email, status, verifier, ESP }, status: 'success' }.
      const json = await res.json();
      const data = (json?.data ?? json ?? {}) as Record<string, unknown>;
      const rawEmail = (data.email ?? data.work_email) as unknown;
      const email = looksLikeEmail(rawEmail) ? rawEmail.trim() : null;

      return {
        status: email ? 'found' : 'not_found',
        email,
        verification: typeof data.status === 'string' ? data.status : null,
        verifier: typeof data.verifier === 'string' ? data.verifier : null,
        esp:
          typeof data.ESP === 'string'
            ? (data.ESP as string)
            : typeof data.esp === 'string'
              ? (data.esp as string)
              : null,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') continue; // transient poll timeout — keep trying
      throw err;
    } finally {
      clearTimeout(pollTimeout);
    }
  }

  // Ran out of time waiting for BetterEnrich to resolve the task.
  return EMPTY_RESULT('error');
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
      linkedinColumnId,
      resultColumnId,
    } = await request.json();

    if (!tableId || !rowIds?.length || !domainColumnId || !resultColumnId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Column-scope guard (QA finding C-017 family): result/domain/name/linkedin
    // columns must belong to this table before any provider work.
    const validIds = await getColumnIdSet(tableId);
    const referenced = [
      resultColumnId,
      domainColumnId,
      linkedinColumnId,
      ...(inputMode === 'full_name' ? [fullNameColumnId] : [firstNameColumnId, lastNameColumnId]),
    ].filter(Boolean) as string[];
    const badCols = invalidColumnIds(referenced, validIds);
    if (badCols.length > 0) {
      return NextResponse.json(
        { error: COLUMN_SCOPE_MESSAGE, invalidColumnIds: badCols, tableId },
        { status: 400 }
      );
    }

    const apiKey = getSecret('BETTERENRICH_API_KEY');
    if (!apiKey) {
      return NextResponse.json({ error: 'BETTERENRICH_API_KEY not configured' }, { status: 500 });
    }

    const rows = await db.select().from(schema.rows).where(inArray(schema.rows.id, rowIds));

    const results: Array<{
      rowId: string;
      success: boolean;
      email: string | null;
      status: string;
      enrichmentData?: Record<string, string | number | null>;
      metadata?: { timeTakenMs: number };
      error?: string;
    }> = [];
    let foundCount = 0;
    let errorCount = 0;

    const processRow = async (row: typeof rows[0], index: number) => {
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

      const linkedinUrl = linkedinColumnId
        ? data[linkedinColumnId]?.value?.toString().trim() || ''
        : '';

      if (!fullName || !domain) {
        const updatedData = {
          ...data,
          [resultColumnId]: {
            value: null,
            status: 'complete' as const,
            enrichmentData: {
              email: null,
              status: 'skipped',
              reason: 'missing name or domain',
              provider: 'betterenrich',
            },
          },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        return { rowId: row.id, success: true, email: null as string | null, status: 'skipped' };
      }

      domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

      try {
        console.log(`[betterenrich] Processing row ${index + 1}/${rows.length}: ${fullName} @ ${domain}`);
        const startMs = Date.now();
        const apiResult = await callBetterEnrichAPI(fullName, domain, linkedinUrl, apiKey);
        const timeTakenMs = Date.now() - startMs;
        console.log(`[betterenrich] Result: ${apiResult.status} ${apiResult.email || 'none'}`);

        const enrichmentData: Record<string, string | number | null> = {
          email: apiResult.email,
          status: apiResult.status,
          verification: apiResult.verification,
          verifier: apiResult.verifier,
          esp: apiResult.esp,
          provider: 'betterenrich',
        };

        const updatedData = {
          ...data,
          [resultColumnId]: {
            value: apiResult.email || null,
            status: 'complete' as const,
            enrichmentData,
            metadata: { timeTakenMs, totalCost: 0, inputTokens: 0, outputTokens: 0 },
          },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

        return {
          rowId: row.id,
          success: true,
          email: apiResult.email,
          status: apiResult.status,
          enrichmentData,
          metadata: { timeTakenMs },
        };
      } catch (err) {
        console.error(`[betterenrich] Error for row ${row.id}:`, err);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const updatedData = {
          ...data,
          [resultColumnId]: {
            value: null,
            status: 'error' as const,
            error: errorMsg,
            enrichmentData: {
              email: null,
              status: 'error',
              error: errorMsg,
              provider: 'betterenrich',
            },
          },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

        return { rowId: row.id, success: false, email: null as string | null, status: 'error', error: errorMsg };
      }
    };

    for (let i = 0; i < rows.length; i += CONCURRENT_REQUESTS) {
      const chunk = rows.slice(i, i + CONCURRENT_REQUESTS);
      const chunkResults = await Promise.all(chunk.map((row, j) => processRow(row, i + j)));

      for (const r of chunkResults) {
        if (r.email) foundCount++;
        if (!r.success) errorCount++;
        results.push(r);
      }

      if (i + CONCURRENT_REQUESTS < rows.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    return NextResponse.json({
      results,
      processedCount: rows.length,
      foundCount,
      errorCount,
    });
  } catch (error) {
    console.error('BetterEnrich find email error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find emails' },
      { status: 500 }
    );
  }
}
