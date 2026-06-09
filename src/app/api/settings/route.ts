import { NextRequest, NextResponse } from 'next/server';
import { PROVIDERS, MANAGED_KEYS, listSecretsStatus, setSecrets } from '@/lib/secrets';

// crypto (AES) + better-sqlite3 (dev) ⇒ must run on the Node.js runtime.
// Protected by src/middleware.ts (device cookie or Bearer key) — no extra auth here.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/settings — provider registry + masked status per managed key.
export async function GET() {
  const statuses = await listSecretsStatus();
  return NextResponse.json({ providers: PROVIDERS, statuses });
}

// Save one or more keys. Body: { [ENV_NAME]: value }. Unknown keys are rejected.
async function save(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object of { ENV_NAME: value }' }, { status: 400 });
  }

  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No keys provided' }, { status: 400 });
  }

  const unknownKeys = entries.map(([k]) => k).filter((k) => !MANAGED_KEYS.has(k));
  if (unknownKeys.length) {
    return NextResponse.json({ error: 'Unknown secret key(s)', unknownKeys }, { status: 400 });
  }

  const record: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof v !== 'string') {
      return NextResponse.json({ error: `Value for ${k} must be a string` }, { status: 400 });
    }
    record[k] = v; // stored verbatim (preserve any trailing whitespace/newlines)
  }

  try {
    await setSecrets(record);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const statuses = await listSecretsStatus();
  return NextResponse.json({ ok: true, statuses });
}

export async function PUT(request: NextRequest) {
  return save(request);
}

export async function POST(request: NextRequest) {
  return save(request);
}
