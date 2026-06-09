import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// Encryption ON for this suite. The secrets functions read SECRETS_ENC_KEY at
// call time (inside the it() blocks, which run after this top-level line), so
// setting it here is sufficient even though imports are hoisted above it.
process.env.SECRETS_ENC_KEY = 'a'.repeat(64); // 32-byte hex

import {
  encryptValue,
  decryptValue,
  setSecret,
  getSecret,
  listSecretsStatus,
  revealSecrets,
  MANAGED_KEYS,
} from '@/lib/secrets';
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/settings/route';

// In-process, isolated :memory: SQLite (DATAFLOW_DB_PATH from vitest.config;
// TURSO_* unset so @/lib/db uses better-sqlite3). Middleware/auth don't run here.

async function callPUT(body: unknown) {
  const req = new NextRequest('http://localhost/api/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  const res = await settingsPUT(req);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  return { status: res.status, json };
}

describe('secrets: encryption', () => {
  it('round-trips AES-256-GCM', () => {
    const blob = encryptValue('hello-secret');
    expect(blob.startsWith('v1:gcm:')).toBe(true);
    expect(blob).not.toContain('hello-secret');
    expect(decryptValue(blob)).toBe('hello-secret');
  });

  it('preserves embedded trailing newline verbatim', () => {
    const blob = encryptValue('key-with-newline\n');
    expect(decryptValue(blob)).toBe('key-with-newline\n');
  });

  it('returns a plaintext (unprefixed) value verbatim', () => {
    expect(decryptValue('plain-value')).toBe('plain-value');
  });
});

describe('secrets: store + env fallback', () => {
  it('setSecret persists and getSecret reads it back (DB takes precedence)', async () => {
    process.env.NINJER_API_KEY = 'env-ninjer';
    await setSecret('NINJER_API_KEY', 'db-ninjer');
    expect(getSecret('NINJER_API_KEY')).toBe('db-ninjer');
  });

  it('falls back to process.env for a key with no DB row', () => {
    process.env.SPIDER_API_KEY = 'env-spider-fallback';
    expect(getSecret('SPIDER_API_KEY')).toBe('env-spider-fallback');
  });

  it('rejects an unknown key', async () => {
    await expect(setSecret('BOGUS_KEY', 'x')).rejects.toThrow(/unknown secret key/i);
  });

  it('listSecretsStatus masks values and reports source', async () => {
    await setSecret('WATTDATA_API_KEY', 'super-secret-1234');
    const statuses = await listSecretsStatus();
    const watt = statuses.find((s) => s.key === 'WATTDATA_API_KEY')!;
    expect(watt.configured).toBe(true);
    expect(watt.source).toBe('db');
    expect(watt.preview).toBe('••••1234');
    expect(watt.preview).not.toContain('super-secret');
    // every managed key has a status entry
    expect(statuses.length).toBe(MANAGED_KEYS.size);
  });

  it('revealSecrets returns the full plaintext', async () => {
    await setSecret('TRYKITT_API_KEY', 'full-trykitt-value');
    const all = await revealSecrets();
    expect(all.TRYKITT_API_KEY).toBe('full-trykitt-value');
  });
});

describe('settings API route', () => {
  it('GET returns the provider registry + a status per managed key', async () => {
    const res = await settingsGET();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(Array.isArray(json.providers)).toBe(true);
    expect(json.providers.some((p: { provider: string }) => p.provider === 'azure')).toBe(true);
    expect(json.statuses.length).toBe(MANAGED_KEYS.size);
  });

  it('PUT saves a known key and makes it immediately effective', async () => {
    const { status, json } = await callPUT({ AI_ARC_API_KEY: 'new-aiark-key' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(getSecret('AI_ARC_API_KEY')).toBe('new-aiark-key');
  });

  it('PUT rejects an unknown key with 400', async () => {
    const { status, json } = await callPUT({ NOPE: 'x' });
    expect(status).toBe(400);
    expect(json.unknownKeys).toContain('NOPE');
  });

  it('PUT rejects a non-string value with 400', async () => {
    const { status } = await callPUT({ SPIDER_API_KEY: 123 });
    expect(status).toBe(400);
  });
});
