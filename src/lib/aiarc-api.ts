// AI Ark People & Company Search API Client
// Docs: https://docs.ai-ark.com/

// ─── Constants ──────────────────────────────────────────────────────────────

const AI_ARC_BASE = 'https://api.ai-ark.com/api/developer-portal/v1';
const MAX_PAGE_SIZE = 100;
const MIN_REQUEST_GAP_MS = 210; // 5 req/s = 200ms + 10ms buffer
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [1000, 2000, 4000];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AiArcPeopleFilters {
  // Contact-level (person)
  fullName?: string;
  linkedinUrl?: string;
  contactLocation?: string[];
  seniority?: string[];
  departments?: string[];
  skills?: string[];
  certifications?: string[];
  schoolNames?: string[];
  languages?: string[];
  titleKeywords?: string[];
  titleMode?: 'SMART' | 'WORD' | 'EXACT';

  // Account-level (company context)
  companyDomain?: string[];
  companyName?: string[];
  industries?: string[];
  industriesExclude?: string[];
  employeeSize?: { start: number; end: number }[];
  accountLocation?: string[];
  technology?: string[];
  revenue?: { start: number; end: number }[];

  // Results
  limit?: number;
}

export interface AiArcCompanyFilters {
  lookalikeDomains?: string[];
  domain?: string[];
  name?: string[];
  industries?: string[];
  industriesExclude?: string[];
  employeeSize?: { start: number; end: number }[];
  location?: string[];
  technology?: string[];
  fundingType?: string[];
  fundingTotalMin?: number;
  fundingTotalMax?: number;
  revenueMin?: number;
  revenueMax?: number;
  foundedYearMin?: number;
  foundedYearMax?: number;
  keywords?: string[];

  // Results
  limit?: number;
}

export interface AiArcPerson {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  headline: string;
  title: string;
  linkedin_url: string;
  twitter_url: string;
  country: string;
  city: string;
  location: string;
  company_name: string;
  company_domain: string;
  company_industry: string;
  seniority: string;
  skills: string;
  open_to_work: boolean;
}

export interface AiArcCompany {
  id: string;
  name: string;
  legal_name: string;
  description: string;
  industry: string;
  website: string;
  domain: string;
  linkedin_url: string;
  staff_total: number;
  staff_range: string;
  founded_year: number;
  funding_type: string;
  funding_total: string;
  headquarter_city: string;
  headquarter_state: string;
  technologies: string;
  email: string;
  phone: string;
}

export interface AiArcSearchResult<T> {
  items: T[];
  totalCount: number;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────
// AI Ark limits: 5 req/s, 300 req/min, 18,000 req/hour
// We enforce both per-request gap (210ms) AND a sliding window for 300/min

let lastRequestTime = 0;
const requestTimestamps: number[] = []; // Sliding window for per-minute tracking
const MAX_PER_MINUTE = 280; // Stay under 300 with buffer
const MINUTE_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();

  // Per-request gap: 210ms minimum between calls
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await sleep(MIN_REQUEST_GAP_MS - elapsed);
  }

  // Per-minute window: if we've hit 280 calls in the last 60s, wait
  const cutoff = Date.now() - MINUTE_MS;
  // Remove timestamps older than 1 minute
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= MAX_PER_MINUTE) {
    // Wait until the oldest request in the window expires
    const waitMs = requestTimestamps[0] + MINUTE_MS - Date.now() + 100; // +100ms buffer
    if (waitMs > 0) {
      console.log(`[aiarc] Rate limit: ${requestTimestamps.length} calls in last 60s, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }
  }

  lastRequestTime = Date.now();
  requestTimestamps.push(Date.now());
}

// ─── HTTP Client ────────────────────────────────────────────────────────────

async function aiArcFetch(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const apiKey = process.env.AI_ARC_API_KEY;
  if (!apiKey) {
    throw new Error('AI_ARC_API_KEY environment variable is required');
  }

  const url = `${AI_ARC_BASE}${path}`;
  const method = options.method || (options.body ? 'POST' : 'GET');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Enforce rate limits (per-request gap + per-minute window)
    await enforceRateLimit();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-TOKEN': apiKey,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      // Rate limited — retry with backoff
      if (response.status === 429 && attempt < MAX_RETRIES - 1) {
        console.log(`[aiarc] Rate limited, retrying in ${RETRY_BACKOFF[attempt]}ms...`);
        await sleep(RETRY_BACKOFF[attempt]);
        continue;
      }

      // Server error — retry with backoff
      if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
        console.log(`[aiarc] Server error ${response.status}, retrying...`);
        await sleep(RETRY_BACKOFF[attempt]);
        continue;
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = (errBody as Record<string, string>).error
          || (errBody as Record<string, string>).message
          || `AI Ark API error: ${response.status}`;
        throw new Error(msg);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1 && !(err as Error).message?.includes('AI Ark API error')) {
        await sleep(RETRY_BACKOFF[attempt]);
        continue;
      }
    }
  }

  throw lastError || new Error('AI Ark API request failed');
}

// ─── Title Post-Filter ──────────────────────────────────────────────────────
// AI Ark's WORD mode splits multi-word titles into individual words, causing
// false positives (e.g., "Director" from "Board of Directors"). This function
// does case-insensitive phrase matching after fetching to remove noise.

function titleMatchesAny(title: string, keywords: string[]): boolean {
  if (!title || !keywords.length) return true; // No filter = pass all
  const t = title.toLowerCase();
  return keywords.some(kw => t.includes(kw.toLowerCase()));
}

// ─── Filter Builders ────────────────────────────────────────────────────────

function buildPeopleBody(
  filters: AiArcPeopleFilters,
  page: number,
  size: number
): Record<string, unknown> {
  const body: Record<string, unknown> = { page, size };

  // Account-level filters (company context)
  const account: Record<string, unknown> = {};

  if (filters.companyDomain?.length) {
    account.domain = { any: { include: filters.companyDomain } };
  }
  if (filters.companyName?.length) {
    account.name = { any: { include: { mode: 'SMART', content: filters.companyName } } };
  }
  if (filters.industries?.length || filters.industriesExclude?.length) {
    const ind: Record<string, unknown> = { any: {} };
    if (filters.industries?.length) {
      (ind.any as Record<string, unknown>).include = { mode: 'SMART', content: filters.industries };
    }
    if (filters.industriesExclude?.length) {
      (ind.any as Record<string, unknown>).exclude = { mode: 'WORD', content: filters.industriesExclude };
    }
    account.industries = ind;
  }
  if (filters.employeeSize?.length) {
    account.employeeSize = { type: 'RANGE', range: filters.employeeSize };
  }
  if (filters.accountLocation?.length) {
    account.location = { any: { include: filters.accountLocation } };
  }
  if (filters.technology?.length) {
    account.technologies = { any: { include: { mode: 'SMART', content: filters.technology } } };
  }
  if (filters.revenue?.length) {
    account.revenue = { type: 'RANGE', range: filters.revenue };
  }

  if (Object.keys(account).length > 0) {
    body.account = account;
  }

  // Contact-level filters (person)
  const contact: Record<string, unknown> = {};

  if (filters.fullName) {
    contact.fullName = { any: { include: { mode: 'SMART', content: [filters.fullName] } } };
  }
  if (filters.linkedinUrl) {
    contact.linkedin = { any: { include: [filters.linkedinUrl] } };
  }
  if (filters.contactLocation?.length) {
    contact.location = { any: { include: filters.contactLocation } };
  }
  if (filters.seniority?.length) {
    contact.seniority = { any: { include: filters.seniority } };
  }
  if (filters.departments?.length) {
    contact.departmentAndFunction = { any: { include: filters.departments } };
  }
  if (filters.skills?.length) {
    contact.skill = { any: { include: { mode: 'SMART', content: filters.skills } } };
  }
  if (filters.certifications?.length) {
    contact.certification = { any: { include: { mode: 'SMART', content: filters.certifications } } };
  }
  if (filters.schoolNames?.length) {
    contact.education = { school: { any: { include: filters.schoolNames } } };
  }
  if (filters.languages?.length) {
    contact.language = { any: { include: { mode: 'SMART', content: filters.languages } } };
  }
  if (filters.titleKeywords?.length) {
    const mode = filters.titleMode || 'WORD';
    contact.experience = {
      current: {
        title: { any: { include: { mode, content: filters.titleKeywords } } },
      },
    };
  }

  if (Object.keys(contact).length > 0) {
    body.contact = contact;
  }

  return body;
}

function buildCompanyBody(
  filters: AiArcCompanyFilters,
  page: number,
  size: number
): Record<string, unknown> {
  const body: Record<string, unknown> = { page, size };

  if (filters.lookalikeDomains?.length) {
    body.lookalikeDomains = filters.lookalikeDomains.slice(0, 5); // max 5
  }

  const account: Record<string, unknown> = {};

  if (filters.domain?.length) {
    account.domain = { any: { include: filters.domain } };
  }
  if (filters.name?.length) {
    account.name = { any: { include: { mode: 'SMART', content: filters.name } } };
  }
  if (filters.industries?.length || filters.industriesExclude?.length) {
    const ind: Record<string, unknown> = { any: {} };
    if (filters.industries?.length) {
      (ind.any as Record<string, unknown>).include = { mode: 'SMART', content: filters.industries };
    }
    if (filters.industriesExclude?.length) {
      (ind.any as Record<string, unknown>).exclude = { mode: 'WORD', content: filters.industriesExclude };
    }
    account.industries = ind;
  }
  if (filters.employeeSize?.length) {
    account.employeeSize = { type: 'RANGE', range: filters.employeeSize };
  }
  if (filters.location?.length) {
    account.location = { any: { include: filters.location } };
  }
  if (filters.technology?.length) {
    account.technologies = { any: { include: { mode: 'SMART', content: filters.technology } } };
  }
  if (filters.keywords?.length) {
    account.keyword = { any: { include: { content: filters.keywords } } };
  }
  if (filters.fundingType?.length) {
    account.funding = { type: filters.fundingType };
  }
  if (filters.fundingTotalMin != null || filters.fundingTotalMax != null) {
    const existing = (account.funding as Record<string, unknown>) || {};
    existing.totalAmount = {
      start: filters.fundingTotalMin ?? 0,
      end: filters.fundingTotalMax ?? 999999999999,
    };
    account.funding = existing;
  }
  if (filters.revenueMin != null || filters.revenueMax != null) {
    account.revenue = {
      type: 'RANGE',
      range: [{ start: filters.revenueMin ?? 0, end: filters.revenueMax ?? 999999999999 }],
    };
  }
  if (filters.foundedYearMin != null || filters.foundedYearMax != null) {
    account.foundedYear = {
      type: 'RANGE',
      range: { start: filters.foundedYearMin ?? 1800, end: filters.foundedYearMax ?? 2030 },
    };
  }

  if (Object.keys(account).length > 0) {
    body.account = account;
  }

  return body;
}

// ─── Response Parsers ───────────────────────────────────────────────────────

function parseAiArcPerson(raw: Record<string, unknown>): AiArcPerson {
  const profile = (raw.profile as Record<string, unknown>) || {};
  const link = (raw.link as Record<string, unknown>) || {};
  const loc = (raw.location as Record<string, unknown>) || {};
  const company = (raw.company as Record<string, unknown>) || {};
  const companySummary = (company.summary as Record<string, unknown>) || {};
  const companyLink = (company.link as Record<string, unknown>) || {};
  const dept = (raw.department as Record<string, unknown>) || {};
  const badges = (raw.member_badges as Record<string, unknown>) || {};
  const skills = (raw.skills as string[]) || [];

  return {
    id: (raw.id as string) || '',
    first_name: (profile.first_name as string) || '',
    last_name: (profile.last_name as string) || '',
    full_name: (profile.full_name as string) || '',
    headline: (profile.headline as string) || '',
    title: (profile.title as string) || '',
    linkedin_url: (link.linkedin as string) || '',
    twitter_url: (link.twitter as string) || '',
    country: (loc.country as string) || '',
    city: (loc.city as string) || '',
    location: (loc.default as string) || (loc.short as string) || '',
    company_name: (companySummary.name as string) || '',
    company_domain: (companyLink.domain as string) || '',
    company_industry: (companySummary.industry as string) || (raw.industry as string) || '',
    seniority: (dept.seniority as string) || '',
    skills: skills.slice(0, 10).join(', '),
    open_to_work: !!(badges.open_to_work),
  };
}

function parseAiArcCompany(raw: Record<string, unknown>): AiArcCompany {
  const summary = (raw.summary as Record<string, unknown>) || {};
  const link = (raw.link as Record<string, unknown>) || {};
  const contact = (raw.contact as Record<string, unknown>) || {};
  const phone = (contact.phone as Record<string, unknown>) || {};
  const financial = (raw.financial as Record<string, unknown>) || {};
  const funding = (financial.funding as Record<string, unknown>) || {};
  const location = (raw.location as Record<string, unknown>) || {};
  const hq = (location.headquarter as Record<string, unknown>) || {};
  const staff = (summary.staff as Record<string, unknown>) || {};
  const staffRange = (staff.range as Record<string, unknown>) || {};
  const techs = (raw.technologies as string[]) || [];

  const totalAmount = funding.total_amount as number | undefined;

  return {
    id: (raw.id as string) || '',
    name: (summary.name as string) || '',
    legal_name: (summary.legal_name as string) || '',
    description: ((summary.description as string) || '').slice(0, 500),
    industry: (summary.industry as string) || '',
    website: (link.website as string) || '',
    domain: (link.domain as string) || '',
    linkedin_url: (link.linkedin as string) || '',
    staff_total: (staff.total as number) || 0,
    staff_range: staffRange.start && staffRange.end
      ? `${staffRange.start}-${staffRange.end}`
      : '',
    founded_year: (summary.founded_year as number) || 0,
    funding_type: (funding.type as string) || '',
    funding_total: totalAmount ? `$${(totalAmount / 1e6).toFixed(1)}M` : '',
    headquarter_city: (hq.city as string) || '',
    headquarter_state: (hq.state as string) || '',
    technologies: techs.slice(0, 15).join(', '),
    email: (contact.email as string) || '',
    phone: (phone.sanitized as string) || (phone.raw as string) || '',
  };
}

// ─── Preview Functions ──────────────────────────────────────────────────────

export async function previewPeopleSearch(
  filters: AiArcPeopleFilters,
  onProgress?: (msg: string) => void
): Promise<{ estimatedTotal: number; preview: AiArcPerson[] }> {
  const titles = filters.titleKeywords || [];

  // Multi-title: run individual previews, deduplicate samples, sum estimates
  if (titles.length > 1) {
    onProgress?.(`Running preview for ${titles.length} title keywords...`);

    const seen = new Set<string>();
    const allPreviews: AiArcPerson[] = [];
    let maxSingleTotal = 0;

    for (const title of titles) {
      const singleFilters = { ...filters, titleKeywords: [title] };
      const body = buildPeopleBody(singleFilters, 0, 20);
      const data = await aiArcFetch('/people', { body }) as Record<string, unknown>;

      const content = (data.content as Record<string, unknown>[]) || [];
      const titleTotal = (data.totalElements as number) || 0;
      if (titleTotal > maxSingleTotal) maxSingleTotal = titleTotal;

      for (const raw of content) {
        const person = parseAiArcPerson(raw);
        if (person.id && !seen.has(person.id)) {
          seen.add(person.id);
          allPreviews.push(person);
        }
      }
    }

    // Estimate: use the largest single-title count as the baseline
    // (actual deduplicated total will be determined during full search)
    onProgress?.(`Preview complete — ${allPreviews.length} unique samples (largest title group: ~${maxSingleTotal.toLocaleString()})`);
    return { estimatedTotal: maxSingleTotal, preview: allPreviews.slice(0, 20) };
  }

  // Single title or no title filter
  onProgress?.('Running preview search...');

  const body = buildPeopleBody(filters, 0, 20);
  const data = await aiArcFetch('/people', { body }) as Record<string, unknown>;

  const content = (data.content as Record<string, unknown>[]) || [];
  const totalElements = (data.totalElements as number) || 0;
  const preview = content.map(parseAiArcPerson);

  onProgress?.(`Preview complete — ${preview.length} results (estimated total: ${totalElements})`);
  return { estimatedTotal: totalElements, preview };
}

export async function previewCompanySearch(
  filters: AiArcCompanyFilters,
  onProgress?: (msg: string) => void
): Promise<{ estimatedTotal: number; preview: AiArcCompany[] }> {
  onProgress?.('Running preview search...');

  const body = buildCompanyBody(filters, 0, 20);
  const data = await aiArcFetch('/companies', { body }) as Record<string, unknown>;

  const content = (data.content as Record<string, unknown>[]) || [];
  const totalElements = (data.totalElements as number) || 0;
  const preview = content.map(parseAiArcCompany);

  onProgress?.(`Preview complete — ${preview.length} results (estimated total: ${totalElements})`);
  return { estimatedTotal: totalElements, preview };
}

// ─── Full Search (Paginated) ────────────────────────────────────────────────

export async function searchPeople(
  filters: AiArcPeopleFilters,
  limit: number,
  onProgress?: (msg: string) => void
): Promise<AiArcSearchResult<AiArcPerson>> {
  // Multi-title dedup: if multiple title keywords, search each separately
  // and deduplicate by person ID to avoid inflated results and duplicate credits
  const titles = filters.titleKeywords || [];
  if (titles.length > 1) {
    return searchPeopleMultiTitle(filters, limit, onProgress);
  }

  return searchPeopleSingle(filters, limit, onProgress);
}

async function searchPeopleMultiTitle(
  filters: AiArcPeopleFilters,
  limit: number,
  onProgress?: (msg: string) => void
): Promise<AiArcSearchResult<AiArcPerson>> {
  const titles = filters.titleKeywords || [];
  const seen = new Set<string>();
  const results: AiArcPerson[] = [];
  let apiTotal = 0;

  onProgress?.(`Searching ${titles.length} title keywords with deduplication + post-filter...`);

  for (let t = 0; t < titles.length; t++) {
    if (results.length >= limit) break;

    const title = titles[t];
    const singleFilters = { ...filters, titleKeywords: [title] };

    onProgress?.(`[${t + 1}/${titles.length}] Searching "${title}"... (${results.length} matched so far)`);

    // Fetch all pages for this title (over-fetch to account for post-filter loss)
    const pageSize = MAX_PAGE_SIZE;
    const body = buildPeopleBody(singleFilters, 0, pageSize);
    const firstPage = await aiArcFetch('/people', { body }) as Record<string, unknown>;

    const titleTotal = (firstPage.totalElements as number) || 0;
    const totalPages = (firstPage.totalPages as number) || 1;
    apiTotal += titleTotal;

    const firstContent = ((firstPage.content as Record<string, unknown>[]) || []).map(parseAiArcPerson);

    // Deduplicate + post-filter by title phrase match
    for (const person of firstContent) {
      if (person.id && !seen.has(person.id) && titleMatchesAny(person.title, titles)) {
        seen.add(person.id);
        results.push(person);
      } else if (person.id) {
        seen.add(person.id); // Still track ID to avoid re-checking in later titles
      }
    }

    // Paginate through all pages for this title
    for (let page = 1; page < totalPages; page++) {
      if (results.length >= limit) break;

      const pageBody = buildPeopleBody(singleFilters, page, pageSize);
      const pageData = await aiArcFetch('/people', { body: pageBody }) as Record<string, unknown>;
      const content = ((pageData.content as Record<string, unknown>[]) || []).map(parseAiArcPerson);

      for (const person of content) {
        if (person.id && !seen.has(person.id) && titleMatchesAny(person.title, titles)) {
          seen.add(person.id);
          results.push(person);
        } else if (person.id) {
          seen.add(person.id);
        }
      }

      if (content.length < pageSize) break;

      if (page % 10 === 0) {
        onProgress?.(`  "${title}" page ${page + 1}/${totalPages}... (${results.length} matched)`);
      }
    }

    onProgress?.(`  "${title}": ${titleTotal} API results, ${results.length} matched after filter`);
  }

  onProgress?.(`Search complete — ${results.length} results (filtered from ${seen.size} API results)`);
  return { items: results.slice(0, limit), totalCount: results.length };
}

async function searchPeopleSingle(
  filters: AiArcPeopleFilters,
  limit: number,
  onProgress?: (msg: string) => void
): Promise<AiArcSearchResult<AiArcPerson>> {
  onProgress?.('Starting people search...');
  const titleKws = filters.titleKeywords || [];
  const hasPostFilter = titleKws.length > 0;

  const pageSize = Math.min(limit, MAX_PAGE_SIZE);
  const body = buildPeopleBody(filters, 0, pageSize);
  const firstPage = await aiArcFetch('/people', { body }) as Record<string, unknown>;

  const totalElements = (firstPage.totalElements as number) || 0;
  const totalPages = (firstPage.totalPages as number) || 1;
  let firstContent = ((firstPage.content as Record<string, unknown>[]) || []).map(parseAiArcPerson);

  if (hasPostFilter) {
    firstContent = firstContent.filter(p => titleMatchesAny(p.title, titleKws));
  }

  onProgress?.(`Found ${totalElements} API results. Fetching page 1/${totalPages}... (${firstContent.length} matched)`);

  const allItems = [...firstContent];
  // Fetch all pages when post-filtering (we need to over-fetch)
  const pagesNeeded = hasPostFilter ? totalPages : Math.min(Math.ceil(limit / pageSize), totalPages);

  for (let page = 1; page < pagesNeeded; page++) {
    if (allItems.length >= limit) break;

    const pageBody = buildPeopleBody(filters, page, pageSize);
    const pageData = await aiArcFetch('/people', { body: pageBody }) as Record<string, unknown>;
    let content = ((pageData.content as Record<string, unknown>[]) || []).map(parseAiArcPerson);

    if (hasPostFilter) {
      content = content.filter(p => titleMatchesAny(p.title, titleKws));
    }
    allItems.push(...content);

    if (((pageData.content as unknown[]) || []).length < pageSize) break;

    if (page % 10 === 0) {
      onProgress?.(`Fetching page ${page + 1}/${pagesNeeded}... (${allItems.length} matched)`);
    }
  }

  onProgress?.(`Search complete — ${allItems.length} results${hasPostFilter ? ' after title filter' : ''}`);
  return { items: allItems.slice(0, limit), totalCount: hasPostFilter ? allItems.length : totalElements };
}

export async function searchCompanies(
  filters: AiArcCompanyFilters,
  limit: number,
  onProgress?: (msg: string) => void
): Promise<AiArcSearchResult<AiArcCompany>> {
  onProgress?.('Starting company search...');

  const pageSize = Math.min(limit, MAX_PAGE_SIZE);
  const body = buildCompanyBody(filters, 0, pageSize);
  const firstPage = await aiArcFetch('/companies', { body }) as Record<string, unknown>;

  const totalElements = (firstPage.totalElements as number) || 0;
  const totalPages = (firstPage.totalPages as number) || 1;
  const firstContent = ((firstPage.content as Record<string, unknown>[]) || []).map(parseAiArcCompany);

  onProgress?.(`Found ${totalElements} total companies. Fetching page 1/${Math.min(Math.ceil(limit / pageSize), totalPages)}...`);

  if (firstContent.length >= limit || totalPages <= 1) {
    return { items: firstContent.slice(0, limit), totalCount: totalElements };
  }

  const allItems = [...firstContent];
  const pagesNeeded = Math.min(Math.ceil(limit / pageSize), totalPages);

  for (let page = 1; page < pagesNeeded; page++) {
    onProgress?.(`Fetching page ${page + 1}/${pagesNeeded}... (${allItems.length} so far)`);

    const pageBody = buildCompanyBody(filters, page, pageSize);
    const pageData = await aiArcFetch('/companies', { body: pageBody }) as Record<string, unknown>;
    const content = ((pageData.content as Record<string, unknown>[]) || []).map(parseAiArcCompany);
    allItems.push(...content);

    if (content.length < pageSize) break;
    if (allItems.length >= limit) break;
  }

  onProgress?.(`Search complete — ${allItems.length} companies fetched`);
  return { items: allItems.slice(0, limit), totalCount: totalElements };
}

// ─── Credits ────────────────────────────────────────────────────────────────

export async function fetchCredits(): Promise<unknown> {
  return aiArcFetch('/payments/credits');
}

// ─── Config Check ───────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  return !!process.env.AI_ARC_API_KEY;
}
