import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

export const maxDuration = 300;

const TRYKITT_BASE_URL = 'https://api.trykitt.ai';
const CONCURRENT_REQUESTS = 2;
const DELAY_BETWEEN_BATCHES_MS = 100;
const TIMEOUT_MS = 90000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callTryKittAPI(
  fullName: string,
  domain: string,
  apiKey: string
): Promise<{
  status: string;
  email: string | null;
  confidence: number | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${TRYKITT_BASE_URL}/job/find_email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'User-Agent': 'dataflow/1.0',
      },
      body: JSON.stringify({
        fullName,
        domain,
        realtime: true,
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new Error('Invalid TryKitt API key');
    }
    if (response.status === 402) {
      throw new Error('TryKitt rate limit or insufficient credits');
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`TryKitt API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // Parse TryKitt response format. TryKitt returns the literal string
    // "no-results-found" (and similar sentinels) in the email field when
    // they can't find one — don't pass that through as if it were an
    // address. Anything that isn't shaped like a real email is treated
    // as "not found".
    const result = data.result || data;
    const rawEmail = result.email;
    const looksLikeEmail =
      typeof rawEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim());
    const email = looksLikeEmail ? rawEmail.trim() : null;
    const confidence = result.confidence || null;

    const status = email ? 'found' : 'not_found';

    return { status, email, confidence };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { status: 'error', email: null, confidence: null };
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function formatStatus(status: string, confidence: number | null): string {
  if (confidence !== null && confidence > 0) {
    return `${status} (${Math.round(confidence * 100)}%)`;
  }
  return status;
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

    const apiKey = process.env.TRYKITT_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TRYKITT_API_KEY not configured' }, { status: 500 });
    }

    const rows = await db
      .select()
      .from(schema.rows)
      .where(inArray(schema.rows.id, rowIds));

    const results: Array<{ rowId: string; success: boolean; email: string | null; status: string }> = [];
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

      if (!fullName || !domain) {
        const updatedData = {
          ...data,
          [emailColumnId]: { value: '', status: 'complete' as const },
          [emailStatusColumnId]: { value: 'skipped', status: 'complete' as const },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        return { rowId: row.id, success: true, email: null as string | null, status: 'skipped' };
      }

      domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

      try {
        console.log(`[trykitt] Processing row ${index + 1}/${rows.length}: ${fullName} @ ${domain}`);
        const apiResult = await callTryKittAPI(fullName, domain, apiKey);
        console.log(`[trykitt] Result: ${apiResult.status} ${apiResult.email || 'none'}`);

        const emailValue = apiResult.email || '';
        const statusValue = formatStatus(apiResult.status, apiResult.confidence);

        const updatedData = {
          ...data,
          [emailColumnId]: { value: emailValue, status: 'complete' as const },
          [emailStatusColumnId]: { value: statusValue, status: 'complete' as const },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

        return { rowId: row.id, success: true, email: apiResult.email, status: apiResult.status };
      } catch (err) {
        console.error(`[trykitt] Error for row ${row.id}:`, err);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const updatedData = {
          ...data,
          [emailColumnId]: { value: '', status: 'error' as const, error: errorMsg },
          [emailStatusColumnId]: { value: 'error', status: 'error' as const, error: errorMsg },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));

        return { rowId: row.id, success: false, email: null as string | null, status: 'error' };
      }
    };

    for (let i = 0; i < rows.length; i += CONCURRENT_REQUESTS) {
      const chunk = rows.slice(i, i + CONCURRENT_REQUESTS);
      const chunkResults = await Promise.all(
        chunk.map((row, j) => processRow(row, i + j))
      );

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
    console.error('TryKitt find email error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find emails' },
      { status: 500 }
    );
  }
}
