// Centralized provider-secret store.
//
// Provider API keys / credentials live in the `app_secrets` DB table and are
// fronted by an in-memory cache with a process.env FALLBACK. The fallback is the
// whole safety story: a provider key can never STOP resolving — on a cold start,
// an empty table, or a DB outage, getSecret() returns the original env value.
//
// Values are encrypted at rest with AES-256-GCM when SECRETS_ENC_KEY is set;
// otherwise they are stored plaintext (same exposure as the env vars) so the
// feature works before the master key is provisioned.
//
// The Settings page (src/app/settings) never imports this module directly — it
// goes through /api/settings, which calls listSecretsStatus/setSecrets/revealSecrets.
// Provider libs (clay-api, aiarc-api, …) call the SYNC getSecret('ENV_NAME').

import crypto from 'crypto';
import { db, schema, ensureSecretsTable } from './db';
import type { NewAppSecret } from './db/schema';

// ── Provider registry — single source of truth for seeding, the API, and the UI ─

export interface SecretFieldDef {
  env: string; // env var name == app_secrets.key
  label: string; // UI label for the field
  secret?: boolean; // render as a masked password input + mask in status
  placeholder?: string;
}

export interface ProviderDef {
  provider: string; // stable id, also used by change listeners (see onSecretChange)
  label: string; // UI heading
  note?: string; // small helper text under the heading
  fields: SecretFieldDef[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    provider: 'clay',
    label: 'Clay',
    note: 'Login credentials (not an API key). Used for people & company search.',
    fields: [
      { env: 'CLAY_EMAIL', label: 'Email', secret: false, placeholder: 'you@company.com' },
      { env: 'CLAY_PASSWORD', label: 'Password', secret: true },
      { env: 'CLAY_WORKSPACE_ID', label: 'Workspace ID', secret: false },
    ],
  },
  {
    provider: 'aiark',
    label: 'AI Ark',
    note: 'One key — used for people/company search AND email-finder.',
    fields: [{ env: 'AI_ARC_API_KEY', label: 'API Key', secret: true }],
  },
  {
    provider: 'wattdata',
    label: 'Wattdata',
    note: 'Audience search.',
    fields: [{ env: 'WATTDATA_API_KEY', label: 'API Key', secret: true }],
  },
  {
    provider: 'ninjer',
    label: 'Ninjer',
    note: 'Email finder.',
    fields: [{ env: 'NINJER_API_KEY', label: 'API Key', secret: true }],
  },
  {
    provider: 'trykitt',
    label: 'Trykitt',
    note: 'Email finder.',
    fields: [{ env: 'TRYKITT_API_KEY', label: 'API Key', secret: true }],
  },
  {
    provider: 'spider',
    label: 'Spider.Cloud',
    note: 'Web search + scrape for AI enrichment.',
    fields: [{ env: 'SPIDER_API_KEY', label: 'API Key', secret: true }],
  },
  {
    provider: 'azure',
    label: 'Azure OpenAI',
    note: 'Powers all AI enrichment & formula columns. The nano fields are an optional separate resource for gpt-5-nano.',
    fields: [
      { env: 'AZURE_OPENAI_API_KEY', label: 'API Key', secret: true },
      { env: 'AZURE_OPENAI_ENDPOINT', label: 'Endpoint', secret: false, placeholder: 'https://<resource>.openai.azure.com' },
      { env: 'AZURE_GPT5_NANO_API_KEY', label: 'GPT-5-nano API Key', secret: true },
      { env: 'AZURE_GPT5_NANO_ENDPOINT', label: 'GPT-5-nano Endpoint', secret: false },
    ],
  },
];

export const MANAGED_KEYS: ReadonlySet<string> = new Set(
  PROVIDERS.flatMap((p) => p.fields.map((f) => f.env)),
);

const KEY_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  PROVIDERS.flatMap((p) => p.fields.map((f) => [f.env, p.provider])),
);

// ── Encryption (AES-256-GCM) with plaintext fallback ─────────────────────────

const ENC_PREFIX = 'v1:gcm:';

function getEncKey(): Buffer | null {
  // Trim — a stray newline from how the env var was provisioned must not fail the
  // hex/base64 check and silently drop us to plaintext. (Provider VALUES are never
  // trimmed; only this master key is.)
  const raw = process.env.SECRETS_ENC_KEY?.trim();
  if (!raw) return null;
  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) buf = b;
    } catch {
      /* not base64 */
    }
  }
  if (!buf || buf.length !== 32) {
    console.warn('[secrets] SECRETS_ENC_KEY set but not 32 bytes (hex or base64) — storing PLAINTEXT');
    return null;
  }
  return buf;
}

export function encryptValue(plain: string): string {
  const key = getEncKey();
  if (!key) return plain; // plaintext fallback
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Returns the plaintext, or undefined if a value is encrypted but undecryptable
// (missing/wrong key) — callers then fall back to env. Plaintext rows (no prefix)
// are returned verbatim.
export function decryptValue(stored: string): string | undefined {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = getEncKey();
  if (!key) {
    console.error('[secrets] encrypted value present but SECRETS_ENC_KEY unavailable — falling back to env');
    return undefined;
  }
  try {
    // base64 never contains ':', so a fixed split is unambiguous.
    const [, , ivB64, tagB64, ctB64] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[secrets] decrypt failed:', (e as Error).message);
    return undefined;
  }
}

// ── In-memory cache + SYNC accessor (the only function call-sites use) ───────

const cache = new Map<string, string>();
let lastHydrated = 0;
const HYDRATE_TTL_MS = 60_000;

export function getSecret(name: string): string | undefined {
  // Opportunistic, non-blocking refresh so edits made on another replica
  // propagate within the TTL. Never awaited here — call-sites stay synchronous.
  if (Date.now() - lastHydrated > HYDRATE_TTL_MS) void hydrateSecrets();
  const v = cache.get(name);
  if (v !== undefined) return v;
  return process.env[name];
}

// ── Hydration (dedup concurrent loads; allow a fresh load after each completes) ─

let inFlight: Promise<void> | null = null;

export function hydrateSecrets(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await ensureSecretsTable();
      const rows = await db.select().from(schema.appSecrets);
      // Rebuild wholesale (no await between clear+set → no observable empty window)
      // so a deleted row correctly reverts to its env fallback.
      const next = new Map<string, string>();
      for (const r of rows) {
        const plain = decryptValue(r.value);
        if (plain !== undefined) next.set(r.key, plain);
      }
      cache.clear();
      for (const [k, v] of next) cache.set(k, v);
      lastHydrated = Date.now();
    } catch (e) {
      // Swallow: getSecret falls back to env. Logged for diagnosis.
      console.error('[secrets] hydrate failed (env fallback active):', (e as Error).message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// ── Seeding from env (so the Settings page is never blank on first boot) ─────

let seedPromise: Promise<void> | null = null;

export function seedSecretsFromEnv(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    await ensureSecretsTable();
    const existing = new Set(
      (await db.select({ key: schema.appSecrets.key }).from(schema.appSecrets)).map((r) => r.key),
    );
    const now = Date.now();
    const toInsert: NewAppSecret[] = [];
    for (const key of MANAGED_KEYS) {
      if (existing.has(key)) continue; // never overwrite a user edit
      const envVal = process.env[key];
      if (envVal == null || envVal === '') continue; // skip absent keys (stay 'unset')
      toInsert.push({ key, value: encryptValue(envVal), updatedAt: now }); // verbatim — preserve any trailing \n
    }
    if (toInsert.length) {
      await db.insert(schema.appSecrets).values(toInsert).onConflictDoNothing();
      console.log(`[secrets] seeded ${toInsert.length} key(s) from env: ${toInsert.map((t) => t.key).join(', ')}`);
    }
  })();
  seedPromise.catch(() => {
    seedPromise = null; // allow retry on next boot/call
  });
  return seedPromise;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function setSecret(name: string, value: string): Promise<void> {
  if (!MANAGED_KEYS.has(name)) throw new Error(`Unknown secret key: ${name}`);
  await ensureSecretsTable();
  const now = Date.now();
  const enc = encryptValue(value);
  await db
    .insert(schema.appSecrets)
    .values({ key: name, value: enc, updatedAt: now })
    .onConflictDoUpdate({ target: schema.appSecrets.key, set: { value: enc, updatedAt: now } });
  cache.set(name, value); // reflect immediately on this replica
  fireOnChange(name);
}

export async function setSecrets(record: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(record)) {
    await setSecret(k, v);
  }
}

// ── Status + reveal (for the API) ─────────────────────────────────────────────

export interface SecretStatus {
  key: string;
  configured: boolean;
  source: 'db' | 'env' | 'unset';
  preview: string | null; // masked, e.g. '••••a1b2'
}

function maskValue(v: string): string {
  const t = v.replace(/\n$/, '');
  if (t.length <= 4) return '••••';
  return '••••' + t.slice(-4);
}

export async function listSecretsStatus(): Promise<SecretStatus[]> {
  await hydrateSecrets();
  const out: SecretStatus[] = [];
  for (const key of MANAGED_KEYS) {
    const inDb = cache.has(key);
    const v = inDb ? cache.get(key)! : process.env[key];
    const configured = !!v && v.length > 0;
    out.push({
      key,
      configured,
      source: inDb ? 'db' : process.env[key] ? 'env' : 'unset',
      preview: configured ? maskValue(v!) : null,
    });
  }
  return out;
}

export async function revealSecrets(): Promise<Record<string, string>> {
  await hydrateSecrets();
  const out: Record<string, string> = {};
  for (const key of MANAGED_KEYS) {
    const v = cache.has(key) ? cache.get(key)! : process.env[key];
    if (v != null) out[key] = v;
  }
  return out;
}

// ── Change listeners (let stateful providers reset their own caches) ─────────

type ChangeListener = (key: string, provider: string) => void;
const listeners: ChangeListener[] = [];

export function onSecretChange(fn: ChangeListener): void {
  listeners.push(fn);
}

function fireOnChange(key: string): void {
  const provider = KEY_TO_PROVIDER[key];
  for (const fn of listeners) {
    try {
      fn(key, provider);
    } catch (e) {
      console.error('[secrets] change listener error:', e);
    }
  }
}

// ── Boot: warm the cache + seed from env (fire-and-forget) ───────────────────
// getSecret() is safe before this resolves — it falls back to process.env.
void (async () => {
  try {
    await ensureSecretsTable();
    await seedSecretsFromEnv();
    await hydrateSecrets();
  } catch (e) {
    console.error('[secrets] boot init failed (env fallback remains active):', (e as Error).message);
  }
})();
