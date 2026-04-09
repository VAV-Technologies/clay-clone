// Wattdata.ai V2 API Client
// Docs: https://wattdata.ai/docs/v2/api-integration
// Endpoint: https://api.wattdata.xyz/v2/mcp (JSON-RPC 2.0 + SSE response format)

// ─── Constants ──────────────────────────────────────────────────────────────

const WATTDATA_BASE = 'https://api.wattdata.xyz/v2/mcp';
const MIN_REQUEST_GAP_MS = 200;
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [1000, 2000, 4000];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WattdataSearchFilters {
  query: string; // natural language audience description
  location?: {
    city?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    unit?: 'km' | 'mi';
  };
  limit?: number;
}

export interface WattdataPerson {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email1: string;
  email2: string;
  email3: string;
  phone1: string;
  phone2: string;
  age_range: string;
  gender: string;
  location: string;
  country: string;
  company: string;
  title: string;
}

export interface WattdataSearchResult {
  items: WattdataPerson[];
  totalCount: number;
}

interface WattdataTrait {
  trait_hash: string;
  trait_id: string;
  domain: string;
  name: string;
  value: string;
  similarity_score: number;
  size: string;
  prevalence: number;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

let lastRequestTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await sleep(MIN_REQUEST_GAP_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

// ─── HTTP Client (JSON-RPC 2.0 + SSE parsing) ───────────────────────────────

let requestId = 0;

async function wattdataFetch(
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const apiKey = process.env.WATTDATA_API_KEY;
  if (!apiKey) {
    throw new Error('WATTDATA_API_KEY environment variable is required');
  }

  requestId += 1;
  const body = {
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await enforceRateLimit();

    try {
      const response = await fetch(WATTDATA_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.status === 429 && attempt < MAX_RETRIES - 1) {
        console.log(`[wattdata] Rate limited, retrying in ${RETRY_BACKOFF[attempt]}ms...`);
        await sleep(RETRY_BACKOFF[attempt]);
        continue;
      }

      if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
        console.log(`[wattdata] Server error ${response.status}, retrying...`);
        await sleep(RETRY_BACKOFF[attempt]);
        continue;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Wattdata API error ${response.status}: ${errBody.slice(0, 300)}`);
      }

      // Parse SSE response: "event: message\ndata: <json>\n\n"
      const text = await response.text();
      const dataLine = text.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) {
        throw new Error('Wattdata response missing data line');
      }
      const json = JSON.parse(dataLine.slice(6));

      if (json.error) {
        throw new Error(`Wattdata RPC error: ${json.error.message || JSON.stringify(json.error)}`);
      }

      // Result is in result.structuredContent (already-parsed JSON)
      const result = json.result?.structuredContent || json.result;
      return result as Record<string, unknown>;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1 && !(err as Error).message?.includes('Wattdata API error')) {
        await sleep(RETRY_BACKOFF[attempt]);
        continue;
      }
    }
  }

  throw lastError || new Error('Wattdata API request failed');
}

// ─── Tool wrappers ──────────────────────────────────────────────────────────

async function traitSearch(query: string, limit = 10): Promise<WattdataTrait[]> {
  const result = await wattdataFetch('trait_search', {
    entity_type: 'person',
    query,
    limit,
  });
  return ((result.results as WattdataTrait[]) || []);
}

interface EntityFindResult {
  total: number;
  returned_count: number;
  sample: Array<{
    entity_id: string;
    domains: {
      emails?: Array<{ email: string; quality_score?: string; opted_in?: string }>;
      phones?: Array<{ phone: string; quality_score?: string; phone_type?: string }>;
      names?: Array<{ first_name?: string; last_name?: string; full_name?: string }>;
      [key: string]: unknown;
    };
  }>;
  export?: { url: string; format: string; expires_at: string };
}

async function entityFind(
  expression: string,
  audienceLimit: number,
  location?: WattdataSearchFilters['location']
): Promise<EntityFindResult> {
  const args: Record<string, unknown> = {
    entity_type: 'person',
    expression,
    domains: ['email', 'name', 'phone', 'employment', 'demographic'],
    audience_limit: audienceLimit,
    max_identifiers: 3,
  };

  if (location && (location.latitude || location.city)) {
    args.location = location;
  }

  const result = await wattdataFetch('entity_find', args);
  return result as unknown as EntityFindResult;
}

// ─── Response parser ────────────────────────────────────────────────────────

function pickBestEmails(emails: Array<{ email: string; quality_score?: string }> = []): [string, string, string] {
  const sorted = [...emails].sort((a, b) => {
    const qa = parseInt(a.quality_score || '0', 10);
    const qb = parseInt(b.quality_score || '0', 10);
    return qb - qa;
  });
  return [sorted[0]?.email || '', sorted[1]?.email || '', sorted[2]?.email || ''];
}

function pickBestPhones(phones: Array<{ phone: string; quality_score?: string }> = []): [string, string] {
  const sorted = [...phones].sort((a, b) => {
    const qa = parseInt(a.quality_score || '0', 10);
    const qb = parseInt(b.quality_score || '0', 10);
    return qb - qa;
  });
  return [sorted[0]?.phone || '', sorted[1]?.phone || ''];
}

function parseWattdataPerson(raw: EntityFindResult['sample'][number]): WattdataPerson {
  const domains = raw.domains || {};
  const names = (domains.names as Array<Record<string, string>>) || [];
  const emails = (domains.emails as Array<{ email: string; quality_score?: string }>) || [];
  const phones = (domains.phones as Array<{ phone: string; quality_score?: string }>) || [];
  const employment = (domains.employment as Array<Record<string, string>>) || [];
  const demographic = (domains.demographic as Array<Record<string, string>>) || [];

  const primaryName = names[0] || {};
  const firstName = primaryName.first_name || '';
  const lastName = primaryName.last_name || '';
  const fullName = primaryName.full_name || `${firstName} ${lastName}`.trim();

  const [email1, email2, email3] = pickBestEmails(emails);
  const [phone1, phone2] = pickBestPhones(phones);

  const employ = employment[0] || {};
  const demo = demographic[0] || {};

  return {
    id: raw.entity_id || '',
    name: fullName,
    first_name: firstName,
    last_name: lastName,
    email1, email2, email3,
    phone1, phone2,
    age_range: demo.age_range || demo.age || '',
    gender: demo.gender || '',
    location: demo.city || demo.location || '',
    country: demo.country || '',
    company: employ.company_name || employ.company || '',
    title: employ.occupation_detail || employ.title || employ.occupation || '',
  };
}

// ─── Boolean expression builder ─────────────────────────────────────────────

function buildExpression(traits: WattdataTrait[], maxTraits = 5): string {
  const top = traits.slice(0, maxTraits);
  if (top.length === 0) return '';
  if (top.length === 1) return top[0].trait_hash;
  // AND together for narrower targeting
  return top.map(t => t.trait_hash).join(' AND ');
}

// ─── Exported preview/search functions ──────────────────────────────────────

export async function previewSearch(
  filters: WattdataSearchFilters,
  onProgress?: (msg: string) => void
): Promise<{ estimatedTotal: number; preview: WattdataPerson[]; expression: string; traits: WattdataTrait[] }> {
  onProgress?.('Searching for matching traits...');

  // Step 1: trait_search to find relevant traits
  const traits = await traitSearch(filters.query, 10);
  if (traits.length === 0) {
    return { estimatedTotal: 0, preview: [], expression: '', traits: [] };
  }

  onProgress?.(`Found ${traits.length} matching traits. Building audience...`);

  // Step 2: entity_find with small audience to get count + sample
  const expression = buildExpression(traits);
  const result = await entityFind(expression, 20, filters.location);

  const preview = (result.sample || []).map(parseWattdataPerson);

  onProgress?.(`Preview complete — ${preview.length} samples (estimated total: ${result.total})`);

  return {
    estimatedTotal: result.total || 0,
    preview,
    expression,
    traits,
  };
}

export async function fullSearch(
  filters: WattdataSearchFilters,
  limit: number,
  onProgress?: (msg: string) => void
): Promise<WattdataSearchResult> {
  onProgress?.('Discovering traits...');

  const traits = await traitSearch(filters.query, 10);
  if (traits.length === 0) {
    return { items: [], totalCount: 0 };
  }

  const expression = buildExpression(traits);
  onProgress?.(`Built expression with ${Math.min(traits.length, 5)} traits. Fetching audience...`);

  const result = await entityFind(expression, limit, filters.location);
  const items = (result.sample || []).map(parseWattdataPerson);

  onProgress?.(`Search complete — ${items.length} fetched (total available: ${result.total})`);

  return {
    items,
    totalCount: result.total || items.length,
  };
}

// ─── Config check ───────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  return !!process.env.WATTDATA_API_KEY;
}
