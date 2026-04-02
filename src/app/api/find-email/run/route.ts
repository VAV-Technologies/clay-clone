import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

export const maxDuration = 300;

const NINJER_BASE_URL = 'https://api-production-9cde.up.railway.app';
const CONCURRENT_REQUESTS = 2; // 2 API keys processed in parallel = ~20 req/s
const DELAY_BETWEEN_BATCHES_MS = 100; // 100ms floor between concurrent batches
const TIMEOUT_MS = 90000; // Worst case: 50 variations can take up to 90s

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callNinjerAPI(
  body: Record<string, string>,
  apiKey: string
): Promise<{
  status: string;
  email: string | null;
  confidence: string | null;
  message: string | null;
  variations_tested: number;
  total_variations: number;
  time_ms: number;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${NINJER_BASE_URL}/find-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function formatStatus(status: string, confidence: string | null): string {
  if (confidence) {
    return `${status} (${confidence})`;
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

    const apiKey = process.env.NINJER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'NINJER_API_KEY not configured' }, { status: 500 });
    }

    // Fetch rows
    const rows = await db
      .select()
      .from(schema.rows)
      .where(inArray(schema.rows.id, rowIds));

    const results: Array<{ rowId: string; success: boolean; email: string | null; status: string }> = [];
    let foundCount = 0;
    let errorCount = 0;

    // Process a single row and return the result
    const processRow = async (row: typeof rows[0], index: number) => {
      const data = row.data as Record<string, CellValue>;

      let domain = data[domainColumnId]?.value?.toString().trim() || '';
      let fullName = '';
      let firstName = '';
      let lastName = '';

      if (inputMode === 'full_name') {
        fullName = data[fullNameColumnId]?.value?.toString().trim() || '';
      } else {
        firstName = data[firstNameColumnId]?.value?.toString().trim() || '';
        lastName = data[lastNameColumnId]?.value?.toString().trim() || '';
      }

      const hasName = inputMode === 'full_name' ? !!fullName : !!(firstName && lastName);
      if (!hasName || !domain) {
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
        console.log(`[find-email] Processing row ${index + 1}/${rows.length}: ${inputMode === 'full_name' ? fullName : `${firstName} ${lastName}`} @ ${domain}`);
        const body: Record<string, string> = { domain };
        if (inputMode === 'full_name') {
          body.full_name = fullName;
        } else {
          body.first_name = firstName;
          body.last_name = lastName;
        }

        const apiResult = await callNinjerAPI(body, apiKey);
        console.log(`[find-email] Result: ${apiResult.status} ${apiResult.email || 'none'} (${apiResult.time_ms}ms)`);

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
        console.error(`[find-email] Error for row ${row.id}:`, err);
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

    // Process rows in concurrent chunks of CONCURRENT_REQUESTS with 100ms delay between chunks
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

      // 100ms delay between concurrent chunks
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
    console.error('Find email error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to find emails' },
      { status: 500 }
    );
  }
}
