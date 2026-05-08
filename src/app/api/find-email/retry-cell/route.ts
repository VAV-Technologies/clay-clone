import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// POST /api/find-email/retry-cell — replay the find-email action for one row.
// Reads provider + column mapping from column.actionKind + column.actionConfig
// and forwards to the same provider route the panel uses.
//
// This is a thin shim: it doesn't replicate provider logic, it just calls the
// existing /api/find-email/{run|trykitt|ai-ark} for a single rowId.

function providerFromActionKind(actionKind: string): 'ninjer' | 'trykitt' | 'ai_ark' | null {
  if (actionKind === 'find_email_ninjer') return 'ninjer';
  if (actionKind === 'find_email_trykitt') return 'trykitt';
  if (actionKind === 'find_email_aiark') return 'ai_ark';
  return null;
}

function endpointFor(provider: 'ninjer' | 'trykitt' | 'ai_ark'): string {
  if (provider === 'trykitt') return '/api/find-email/trykitt';
  if (provider === 'ai_ark') return '/api/find-email/ai-ark';
  return '/api/find-email/run';
}

export async function POST(request: NextRequest) {
  try {
    const { rowId, columnId, tableId } = await request.json();
    if (!rowId || !columnId || !tableId) {
      return NextResponse.json({ error: 'rowId, columnId, tableId required' }, { status: 400 });
    }

    const [column] = await db.select().from(schema.columns).where(eq(schema.columns.id, columnId));
    if (!column || !column.actionKind) {
      return NextResponse.json({ error: 'Column has no actionKind' }, { status: 400 });
    }

    const provider = providerFromActionKind(column.actionKind);
    if (!provider) {
      return NextResponse.json({ error: `Unsupported actionKind: ${column.actionKind}` }, { status: 400 });
    }

    const config = (column.actionConfig as Record<string, unknown> | null) || {};
    const inputMode = config.inputMode as string | undefined;
    const fullNameColumnId = config.fullNameColumnId as string | undefined;
    const firstNameColumnId = config.firstNameColumnId as string | undefined;
    const lastNameColumnId = config.lastNameColumnId as string | undefined;
    const domainColumnId = config.domainColumnId as string | undefined;

    if (!inputMode || !domainColumnId) {
      return NextResponse.json({ error: 'Column actionConfig is missing required fields' }, { status: 400 });
    }

    // Mark cell as processing immediately for UI feedback.
    const [row] = await db.select().from(schema.rows).where(eq(schema.rows.id, rowId));
    if (!row) return NextResponse.json({ error: 'Row not found' }, { status: 404 });

    const data = (row.data as Record<string, CellValue>) || {};
    await db
      .update(schema.rows)
      .set({
        data: {
          ...data,
          [columnId]: { value: null, status: 'processing' as const },
        },
      })
      .where(eq(schema.rows.id, rowId));

    // Forward to the existing provider route. Use absolute URL so this works
    // server-side (Vercel + ACA both expose PUBLIC_BASE_URL). Forward the
    // incoming Authorization header — middleware will reject the loopback
    // call otherwise.
    const origin =
      process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ||
      request.nextUrl.origin;

    // Forward both header-based (API key) and cookie-based (browser) auth so
    // the loopback hits middleware with the same identity that called us.
    const auth = request.headers.get('authorization');
    const cookie = request.headers.get('cookie');
    const fwdHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) fwdHeaders.Authorization = auth;
    if (cookie) fwdHeaders.Cookie = cookie;

    const upstream = await fetch(`${origin}${endpointFor(provider)}`, {
      method: 'POST',
      headers: fwdHeaders,
      body: JSON.stringify({
        tableId,
        rowIds: [rowId],
        inputMode,
        fullNameColumnId,
        firstNameColumnId,
        lastNameColumnId,
        domainColumnId,
        resultColumnId: columnId,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return NextResponse.json({ success: false, error: err }, { status: upstream.status });
    }

    const result = await upstream.json();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[find-email/retry-cell] error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
