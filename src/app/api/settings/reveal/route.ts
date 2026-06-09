import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revealSecrets } from '@/lib/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEVICE_TOKEN_COOKIE = 'dataflow_device_token';

// POST /api/settings/reveal — return full plaintext values for the Settings UI.
// POST (not GET) so secrets never appear in URLs / access logs. Gated by the
// device cookie specifically (defensive layer on top of middleware): a Bearer-only
// API caller has no cookie and is refused — reveal is a human, browser-side action.
export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEVICE_TOKEN_COOKIE)?.value;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const values = await revealSecrets();
  return NextResponse.json({ values });
}
