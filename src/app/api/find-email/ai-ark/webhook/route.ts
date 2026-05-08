import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// AI Ark calls this URL after processing /people/email-finder. The URL itself
// carries the cell coordinates ({tableId, rowId, resultColId}) signed with an
// HMAC token, so we don't need a server-side job table.

function verifyToken(parts: string[], token: string): boolean {
  const secret = process.env.CRON_SECRET || '';
  const expected = createHmac('sha256', secret).update(parts.join(':')).digest('hex');
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
  } catch {
    return false;
  }
}

// AI Ark's webhook payload (verified live):
//   { trackId, state, statistics, data: [
//       { input:{...}, output: [{ address, status, found, ... }], refId, state }
//   ] }
// Email lives at data[].output[].address. Status comes from output[].status
// (e.g. VALID, INVALID, CATCH_ALL...). We pick the first valid address found.
function extractEmail(body: unknown): { email: string; status: string } {
  const root = (body && typeof body === 'object') ? (body as Record<string, unknown>) : {};

  // Walk data[].output[] — the documented AI Ark shape.
  const data = root.data;
  if (Array.isArray(data)) {
    for (const entry of data) {
      const e = (entry && typeof entry === 'object') ? (entry as Record<string, unknown>) : {};
      const output = e.output;
      if (Array.isArray(output)) {
        for (const o of output) {
          const oo = (o && typeof o === 'object') ? (o as Record<string, unknown>) : {};
          const addr = (oo.address as string) || (oo.email as string) || '';
          if (addr) {
            const status = (oo.status as string) || 'found';
            return { email: addr, status };
          }
        }
      }
    }
  }

  // Defensive fallbacks in case AI Ark changes the shape.
  const direct = (root.email as string) || (root.address as string) || (root.work_email as string) || '';
  if (direct) return { email: direct, status: (root.status as string) || 'found' };

  for (const key of ['results', 'items', 'emails', 'people', 'content']) {
    const arr = root[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = (arr[0] && typeof arr[0] === 'object') ? (arr[0] as Record<string, unknown>) : {};
      const email = (first.email as string) || (first.address as string) || '';
      if (email) return { email, status: (first.status as string) || 'found' };
    }
  }

  // Nothing found — return not_found and surface the API state for visibility.
  const state = (root.state as string) || '';
  return { email: '', status: state ? `not_found (${state.toLowerCase()})` : 'not_found' };
}

async function handleCallback(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tableId = params.get('tableId') || '';
  const rowId = params.get('rowId') || '';
  // Accept both the new resultColId and (briefly) the legacy emailColId for any
  // in-flight submissions made before deploy.
  const resultColId = params.get('resultColId') || params.get('emailColId') || '';
  const legacyStatusColId = params.get('statusColId') || '';
  const token = params.get('token') || '';

  if (!tableId || !rowId || !resultColId || !token) {
    return NextResponse.json({ error: 'missing query params' }, { status: 400 });
  }
  // New URL format: [tableId, rowId, resultColId].
  // Legacy URL format: [tableId, rowId, emailColId, statusColId].
  const ok =
    verifyToken([tableId, rowId, resultColId], token) ||
    (legacyStatusColId && verifyToken([tableId, rowId, resultColId, legacyStatusColId], token));
  if (!ok) {
    return NextResponse.json({ error: 'bad token' }, { status: 401 });
  }

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    // some webhook senders POST empty body; treat as not-found
  }
  console.log('[ai-ark webhook]', JSON.stringify({ rowId, payload }).slice(0, 1000));

  const { email, status } = extractEmail(payload);

  // Read current row, merge cells, write back. We always 200 to AI Ark even
  // if the row vanished — otherwise they'll retry.
  const [row] = await db.select().from(schema.rows).where(eq(schema.rows.id, rowId));
  if (!row) {
    console.warn(`[ai-ark webhook] row ${rowId} not found, ignoring`);
    return NextResponse.json({ ok: true });
  }

  const data = (row.data as Record<string, CellValue>) || {};
  // Preserve any prior enrichmentData (track_id, person_id) and merge.
  const prevCell = (data[resultColId] as CellValue | undefined) ?? { value: null };
  const prevEnrichment = (prevCell.enrichmentData as Record<string, string | number | null> | undefined) ?? {};

  const updated = {
    ...data,
    [resultColId]: {
      ...prevCell,
      value: email || null,
      status: 'complete' as const,
      enrichmentData: {
        ...prevEnrichment,
        email: email || null,
        status: status || (email ? 'found' : 'not_found'),
        provider: 'ai_ark',
      },
    },
  };

  try {
    await db.update(schema.rows).set({ data: updated }).where(eq(schema.rows.id, rowId));
  } catch (err) {
    console.error('[ai-ark webhook] db update failed:', err);
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  return handleCallback(request);
}

// Some webhook senders use PUT — handle defensively.
export async function PUT(request: NextRequest) {
  return handleCallback(request);
}

// Health check / browser visit
export async function GET() {
  return NextResponse.json({ ok: true, info: 'AI Ark email-finder webhook endpoint' });
}
