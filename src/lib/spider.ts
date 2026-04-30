// Spider.Cloud client — web search + URL scrape for AI enrichment tool calls.
// Docs: https://spider.cloud/docs/overview
// Pricing: $1 / 10,000 credits ⇒ $0.0001 / credit. Failed requests cost 0.

const SPIDER_BASE_URL = 'https://api.spider.cloud';
const COST_PER_CREDIT_USD = 0.0001;

interface SpiderCosts {
  total?: number;
  total_cost?: number;
  ai_cost?: number;
  bytes_transferred_cost?: number;
  compute_cost?: number;
  // Spider's exact field names vary; we sum any numeric leaf into a single cost.
  [k: string]: unknown;
}

function isSpiderConfigured(): boolean {
  return !!process.env.SPIDER_API_KEY;
}

function spiderHeaders(): Record<string, string> {
  const key = process.env.SPIDER_API_KEY;
  if (!key) {
    throw new Error('SPIDER_API_KEY is not set. Add it to .env.local and Vercel env.');
  }
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

// Best-effort cost extraction from a Spider response. Spider returns various
// "costs" / "metadata.costs" shapes; we sum every numeric leaf, then fall back
// to a flat per-call estimate when none are present.
function extractCostUsd(data: unknown, fallbackResultCount = 1): number {
  const costs = (data as { costs?: SpiderCosts; metadata?: { costs?: SpiderCosts } })?.costs
    ?? (data as { metadata?: { costs?: SpiderCosts } })?.metadata?.costs;

  if (costs && typeof costs === 'object') {
    let credits = 0;
    for (const v of Object.values(costs as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) credits += v;
    }
    if (credits > 0) return credits * COST_PER_CREDIT_USD;
  }

  // Fallback: ~1 credit per result returned (search) or 1 credit per scrape.
  return Math.max(1, fallbackResultCount) * COST_PER_CREDIT_USD;
}

async function spiderPost<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${SPIDER_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: spiderHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Spider ${path} ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface SpiderSearchResult {
  url?: string;
  title?: string;
  description?: string;
  content?: string;
  // Spider returns additional keys we pass through verbatim.
  [k: string]: unknown;
}

export interface SpiderSearchResponse {
  results: SpiderSearchResult[];
  costUsd: number;
  raw: unknown;
}

export async function spiderSearch(opts: {
  query: string;
  limit?: number;
  fetchContent?: boolean;
  country?: string;
  language?: string;
}): Promise<SpiderSearchResponse> {
  const { query, limit = 5, fetchContent = false, country, language } = opts;

  const body: Record<string, unknown> = {
    search: query,
    search_limit: Math.max(1, Math.min(10, limit)),
    fetch_page_content: !!fetchContent,
  };
  if (country) body.country = country;
  if (language) body.language = language;

  const data = await spiderPost<Record<string, unknown>>('/search', body);

  // Spider's /search response uses `content` for the SERP array. Older docs
  // showed `results`. Some shapes also return a flat array. Cover all three.
  const content = (data as { content?: unknown }).content;
  const resultsField = (data as { results?: unknown }).results;
  const results: SpiderSearchResult[] = Array.isArray(content)
    ? (content as SpiderSearchResult[])
    : Array.isArray(resultsField)
      ? (resultsField as SpiderSearchResult[])
      : Array.isArray(data)
        ? (data as unknown as SpiderSearchResult[])
        : [];

  const costUsd = extractCostUsd(data, results.length);

  console.log(`[spider] search "${query.slice(0, 80)}" -> ${results.length} results, $${costUsd.toFixed(5)}`);

  return { results, costUsd, raw: data };
}

export interface SpiderScrapeResponse {
  content: string;
  costUsd: number;
  raw: unknown;
}

export async function spiderScrape(opts: {
  url: string;
  returnFormat?: 'markdown' | 'text' | 'html' | 'raw';
}): Promise<SpiderScrapeResponse> {
  const { url, returnFormat = 'markdown' } = opts;

  const body = {
    url,
    return_format: returnFormat,
  };

  const data = await spiderPost<unknown>('/scrape', body);

  // Try a few common shapes Spider returns for /scrape responses.
  let content = '';
  if (typeof data === 'string') {
    content = data;
  } else if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as { content?: string; markdown?: string; text?: string };
    content = first.content || first.markdown || first.text || JSON.stringify(first);
  } else if (data && typeof data === 'object') {
    const o = data as { content?: string; markdown?: string; text?: string; result?: string };
    content = o.content || o.markdown || o.text || o.result || JSON.stringify(data);
  }

  const costUsd = extractCostUsd(data, 1);
  console.log(`[spider] scrape ${url} -> ${content.length} chars, $${costUsd.toFixed(5)}`);

  return { content, costUsd, raw: data };
}

export { isSpiderConfigured };
