// Clay People & Company Search API Client
// Reimplemented from https://github.com/neomhr/autoclay in TypeScript

// ─── Constants ──────────────────────────────────────────────────────────────

const CLAY_API_BASE = 'https://api.clay.com/v3';
const CLAY_APP_ORIGIN = 'https://app.clay.com';
const CLAY_APP_REFERER = 'https://app.clay.com/';
const CLAY_FRONTEND_VERSION = 'v20260226_193559Z_fc7e8d7d1f';
const ACTION_PACKAGE_ID = 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2';
const PEOPLE_PREVIEW_ACTION_KEY = 'find-lists-of-people-with-mixrank-source-preview';
const COMPANY_PREVIEW_ACTION_KEY = 'find-lists-of-companies-with-mixrank-source-preview';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 270000; // 4.5 min — fits within Vercel's 300s with room for fetch
const BULK_FETCH_BATCH_SIZE = 200;
const SESSION_TTL_MS = 23 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [1000, 2000, 4000];

const BASIC_FIELDS = [
  { name: 'First Name', dataType: 'text', formulaText: '{{source}}.first_name' },
  { name: 'Last Name', dataType: 'text', formulaText: '{{source}}.last_name' },
  { name: 'Full Name', dataType: 'text', formulaText: '{{source}}.name' },
  { name: 'Job Title', dataType: 'text', formulaText: '{{source}}.matched_experience.job_title || {{source}}.latest_experience_title' },
  { name: 'Location', dataType: 'text', formulaText: '{{source}}.location_name' },
  { name: 'Company Domain', dataType: 'url', formulaText: '{{source}}.domain' },
  { name: 'LinkedIn Profile', dataType: 'url', formulaText: '{{source}}.url', isDedupeField: true },
];

const FIELD_NAME_MAP: Record<string, string> = {
  'First Name': 'first_name',
  'Last Name': 'last_name',
  'Full Name': 'full_name',
  'Job Title': 'job_title',
  'Location': 'location',
  'Company Domain': 'company_domain',
  'LinkedIn Profile': 'linkedin_url',
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClaySearchFilters {
  // Job & Role
  job_title_keywords?: string[];
  job_title_exclude_keywords?: string[];
  job_title_mode?: 'smart' | 'contain' | 'exact';
  seniority_levels?: string[];
  job_functions?: string[];
  job_description_keywords?: string[];

  // Location
  countries_include?: string[];
  countries_exclude?: string[];
  states_include?: string[];
  states_exclude?: string[];
  cities_include?: string[];
  cities_exclude?: string[];
  regions_include?: string[];
  regions_exclude?: string[];
  search_raw_location?: boolean;

  // Company
  company_sizes?: string[];
  company_industries_include?: string[];
  company_industries_exclude?: string[];
  company_description_keywords?: string[];
  company_description_keywords_exclude?: string[];

  // Profile
  headline_keywords?: string[];
  about_keywords?: string[];
  profile_keywords?: string[];
  certification_keywords?: string[];
  school_names?: string[];
  languages?: string[];
  names?: string[];

  // Experience & Connections
  connection_count?: number | null;
  max_connection_count?: number | null;
  follower_count?: number | null;
  max_follower_count?: number | null;
  experience_count?: number | null;
  max_experience_count?: number | null;
  current_role_min_months?: number | null;
  current_role_max_months?: number | null;
  role_range_start_month?: number | null;
  role_range_end_month?: number | null;
  include_past_experiences?: boolean;

  // Results
  limit?: number | null;
  limit_per_company?: number | null;
}

export interface ClayPerson {
  first_name: string;
  last_name: string;
  full_name: string;
  job_title: string;
  location: string;
  company_domain: string;
  linkedin_url: string;
}

export interface ClaySearchResult {
  people: ClayPerson[];
  totalCount: number;
  mode: 'preview' | 'full';
}

// ─── Session Management ────────────────────────────────────────────────────

let cachedSession: { cookie: string; expiresAt: number } | null = null;

async function login(): Promise<string> {
  const email = process.env.CLAY_EMAIL;
  const password = process.env.CLAY_PASSWORD;
  if (!email || !password) {
    throw new Error('CLAY_EMAIL and CLAY_PASSWORD environment variables are required');
  }

  const response = await fetch(`${CLAY_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, source: null }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Clay login failed (${response.status}): ${body}`);
  }

  // Extract claysession from Set-Cookie header
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  let sessionCookie = '';

  for (const header of setCookieHeaders) {
    if (header.includes('claysession=')) {
      const parts = header.split(';');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('claysession=')) {
          sessionCookie = trimmed;
          break;
        }
      }
    }
  }

  // Fallback: check raw headers if getSetCookie not available
  if (!sessionCookie) {
    const rawSetCookie = response.headers.get('set-cookie') || '';
    if (rawSetCookie.includes('claysession=')) {
      const parts = rawSetCookie.split(';');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('claysession=')) {
          sessionCookie = trimmed;
          break;
        }
      }
    }
  }

  if (!sessionCookie) {
    throw new Error('Login succeeded but no claysession cookie in response');
  }

  // Try to extract workspace ID from response body
  const body = await response.json().catch(() => ({}));
  const redirect = body.redirect_to || '';
  if (redirect.includes('/workspaces/')) {
    const wsId = redirect.split('/workspaces/').pop()?.split('/')[0];
    if (wsId && !process.env.CLAY_WORKSPACE_ID) {
      console.log(`[clay-api] Auto-detected workspace ID: ${wsId}`);
    }
  }

  cachedSession = {
    cookie: sessionCookie,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  console.log('[clay-api] Login successful');
  return sessionCookie;
}

async function getSession(): Promise<string> {
  if (cachedSession && Date.now() < cachedSession.expiresAt) {
    return cachedSession.cookie;
  }
  return login();
}

function invalidateSession() {
  cachedSession = null;
}

// ─── HTTP Client ───────────────────────────────────────────────────────────

async function clayFetch(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const cookie = await getSession();
  const url = path.startsWith('http') ? path : `${CLAY_API_BASE}/${path}`;
  const method = options.method || (options.body ? 'POST' : 'GET');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookie,
          'Origin': CLAY_APP_ORIGIN,
          'Referer': CLAY_APP_REFERER,
          'x-clay-frontend-version': CLAY_FRONTEND_VERSION,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (response.status === 401 && attempt === 0) {
        invalidateSession();
        const newCookie = await login();
        // Retry with new cookie
        const retryResponse = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Cookie': newCookie,
            'Origin': CLAY_APP_ORIGIN,
            'Referer': CLAY_APP_REFERER,
            'x-clay-frontend-version': CLAY_FRONTEND_VERSION,
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
        if (!retryResponse.ok) {
          const errBody = await retryResponse.text().catch(() => '');
          throw new Error(`Clay API ${retryResponse.status}: ${errBody}`);
        }
        const text = await retryResponse.text();
        return text ? JSON.parse(text) : {};
      }

      if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF[attempt]));
        continue;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Clay API ${response.status}: ${errBody}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF[attempt]));
        continue;
      }
    }
  }

  throw lastError || new Error('Clay API request failed');
}

// ─── Search Pipeline ───────────────────────────────────────────────────────

// Clay's create-cpj-table requires comma-formatted sizes: "501-1,000" not "501-1000"
const CLAY_SIZE_FORMAT: Record<string, string> = {
  '501-1000': '501-1,000', '1001-5000': '1,001-5,000',
  '5001-10000': '5,001-10,000', '10001+': '10,001+',
};
function normalizeCompanySizes(sizes: string[]): string[] {
  return sizes.map(s => CLAY_SIZE_FORMAT[s] || s);
}

function buildInputs(domains: string[], filters: ClaySearchFilters): Record<string, unknown> {
  return {
    start_from_method: domains.length > 0 ? 'CsvOfCompanies' : 'query',
    company_identifier: domains,
    company_record_id: [],
    company_table_id: null,
    company_table_field_id: null,
    company_table_view_id: null,
    company_audience_segment_id: null,
    include_company_filter_bitmap: null,
    include_company_filter_identifier_count: 0,
    company_annual_revenues: [],
    limit: filters.limit ?? null,
    limit_per_company: filters.limit_per_company ?? null,
    job_functions: filters.job_functions ?? [],
    job_title_keywords: filters.job_title_keywords ?? [],
    job_title_exclude_keywords: filters.job_title_exclude_keywords ?? [],
    job_title_seniority_levels: filters.seniority_levels ?? [],
    job_title_mode: filters.job_title_mode ?? 'smart',
    job_title_exact_keyword_match: null,
    job_title_exact_match: null,
    locations: [],
    locations_exclude: [],
    location_countries_include: filters.countries_include ?? [],
    location_countries_exclude: filters.countries_exclude ?? [],
    location_states_include: filters.states_include ?? [],
    location_states_exclude: filters.states_exclude ?? [],
    location_cities_include: filters.cities_include ?? [],
    location_cities_exclude: filters.cities_exclude ?? [],
    location_regions_include: filters.regions_include ?? [],
    location_regions_exclude: filters.regions_exclude ?? [],
    search_raw_location: filters.search_raw_location ?? false,
    company_sizes: normalizeCompanySizes(filters.company_sizes ?? []),
    company_industries_include: filters.company_industries_include ?? [],
    company_industries_exclude: filters.company_industries_exclude ?? [],
    company_description_keywords: filters.company_description_keywords ?? [],
    company_description_keywords_exclude: filters.company_description_keywords_exclude ?? [],
    include_past_experiences: filters.include_past_experiences ?? false,
    headline_keywords: filters.headline_keywords ?? [],
    about_keywords: filters.about_keywords ?? [],
    profile_keywords: filters.profile_keywords ?? [],
    job_description_keywords: filters.job_description_keywords ?? [],
    certification_keywords: filters.certification_keywords ?? [],
    school_names: filters.school_names ?? [],
    languages: filters.languages ?? [],
    names: filters.names ?? [],
    connection_count: filters.connection_count ?? null,
    max_connection_count: filters.max_connection_count ?? null,
    follower_count: filters.follower_count ?? null,
    max_follower_count: filters.max_follower_count ?? null,
    experience_count: filters.experience_count ?? null,
    max_experience_count: filters.max_experience_count ?? null,
    current_role_min_months_since_start_date: filters.current_role_min_months ?? null,
    current_role_max_months_since_start_date: filters.current_role_max_months ?? null,
    exclude_entities_configuration: [],
    exclude_entities_bitmap: null,
    previous_entities_bitmap: null,
    exclude_entity_bitmap: null,
    exclude_people_identifiers_mixed: [],
    role_range_start_month: filters.role_range_start_month ?? null,
    role_range_end_month: filters.role_range_end_month ?? null,
    job_title_seniority_floor_level: null,
    job_title_seniority_levels_v2: [],
    job_title_seniority_match_mode: 'exact',
    result_count: true,
    name: '',
  };
}

function parsePreviewPerson(raw: Record<string, unknown>): ClayPerson {
  return {
    first_name: (raw.first_name as string) || '',
    last_name: (raw.last_name as string) || '',
    full_name: (raw.name as string) || '',
    job_title: (raw.latest_experience_title as string) || '',
    location: (raw.location_name as string) || '',
    company_domain: (raw.domain as string) || '',
    linkedin_url: (raw.url as string) || '',
  };
}

function getWorkspaceId(): string {
  const wsId = process.env.CLAY_WORKSPACE_ID;
  if (!wsId) throw new Error('CLAY_WORKSPACE_ID environment variable is required');
  return wsId;
}

async function previewSearch(
  domains: string[],
  filters: ClaySearchFilters,
  onProgress?: (msg: string) => void
): Promise<{ taskId: string; people: ClayPerson[] }> {
  const workspaceId = getWorkspaceId();
  const previewFilters = { ...filters, limit: Math.min(filters.limit ?? 50, 50) };

  onProgress?.('Running preview search...');

  const data = await clayFetch('actions/run-enrichment', {
    body: {
      workspaceId,
      enrichmentType: PEOPLE_PREVIEW_ACTION_KEY,
      options: { sync: true, returnTaskId: true, returnActionMetadata: true },
      inputs: buildInputs(domains, previewFilters),
    },
  }) as Record<string, unknown>;

  const taskId = (data.taskId as string) || '';
  const rawPeople = ((data.result as Record<string, unknown>)?.people as Record<string, unknown>[]) || [];
  const people = rawPeople.map(parsePreviewPerson);

  onProgress?.(`Preview complete — ${people.length} results`);
  return { taskId, people };
}

async function fullSearch(
  domains: string[],
  filters: ClaySearchFilters,
  onProgress?: (msg: string) => void
): Promise<ClayPerson[]> {
  const workspaceId = getWorkspaceId();

  // Step 1a: Create workbook
  onProgress?.('Step 1/6: Creating workbook...');
  const wbResp = await clayFetch('workbooks', {
    body: { workspaceId, name: 'People Search' },
  }) as Record<string, unknown>;
  const workbookId = wbResp.id as string;

  // Step 1b: Create conversation
  const convResp = await clayFetch(`${workspaceId}/ai-generation/chat-conversation`, {
    body: {
      conversationType: 'ai_onboarding',
      initialSourceState: {
        sourceType: 'people',
        sourceConfig: {
          type: 'people',
          inputs: buildInputs([], {} as ClaySearchFilters),
        },
      },
    },
  }) as Record<string, unknown>;
  const conversationId = convResp.conversationId as string;

  // Step 2: Preview for taskId
  onProgress?.('Step 2/6: Running preview for task ID...');
  const { taskId } = await previewSearch(domains, filters);

  // Step 3: Create CPJ table (updated payload format)
  onProgress?.('Step 3/6: Creating search table...');
  const tableResp = await clayFetch('sources/create-cpj-table', {
    body: {
      workspaceId,
      workbookName: 'People Search',
      workbookId,
      conversationId,
      assignedFieldId: 'f_people_search',
      cpjConfig: {
        type: 'people',
        typeSettings: {
          name: 'Find people',
          iconType: 'User',
          actionKey: 'find-lists-of-people-with-mixrank-source',
          actionPackageId: ACTION_PACKAGE_ID,
          previewTextPath: 'name',
          defaultPreviewText: 'Clay Profile',
          recordsPath: 'people',
          idPath: 'profile_id',
          scheduleConfig: { runSettings: 'once' },
          dedupeOnUniqueIds: true,
          hasEvaluatedInputs: true,
          inputs: buildInputs(domains, filters),
          previewActionKey: PEOPLE_PREVIEW_ACTION_KEY,
        },
        basicFields: BASIC_FIELDS,
        clientSettings: { tableType: 'people' },
        previewActionTaskId: taskId,
      },
    },
  }) as Record<string, unknown>;

  const tableId = tableResp.tableId as string;
  const sourceId = tableResp.sourceId as string;
  const viewId = (tableResp.viewId as string) ||
    ((tableResp as Record<string, unknown>).defaultViewId as string) || '';

  // Step 4: Poll for completion
  onProgress?.('Step 4/6: Waiting for results...');
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pollResp = await clayFetch(`sources/${sourceId}/runs?limit=1`) as Record<string, unknown>;
    const runs = (pollResp.runs as Array<Record<string, unknown>>) || [];
    if (runs.length > 0) {
      const status = runs[0].status as string;
      if (status === 'SUCCESS') {
        onProgress?.('Search completed successfully');
        break;
      }
      if (status === 'ERROR' || status === 'FAILED') {
        throw new Error(`Clay search failed: ${runs[0].message || status}`);
      }
      onProgress?.(`  Status: ${status}...`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (Date.now() >= deadline) {
    throw new Error('Clay search timed out after 120 seconds');
  }

  // Step 5: Fetch record IDs
  onProgress?.('Step 5/6: Fetching record IDs...');

  // Get the actual viewId from table if not returned in create response
  let finalViewId = viewId;
  if (!finalViewId) {
    const tableInfo = await clayFetch(`tables/${tableId}`) as Record<string, unknown>;
    const table = (tableInfo.table as Record<string, unknown>) || tableInfo;
    finalViewId = (table.defaultViewId as string) || '';
  }

  const idsResp = await clayFetch(`tables/${tableId}/views/${finalViewId}/records/ids`) as Record<string, unknown>;
  const recordIds = (idsResp.results as string[]) || [];

  // Step 6: Bulk fetch records
  onProgress?.(`Step 6/6: Fetching ${recordIds.length} records...`);

  // Get field mapping
  const tableInfo = await clayFetch(`tables/${tableId}`) as Record<string, unknown>;
  const tableData = (tableInfo.table as Record<string, unknown>) || tableInfo;
  const fields = (tableData.fields as Array<Record<string, unknown>>) || [];
  const fieldMapping: Record<string, string> = {};
  for (const f of fields) {
    const name = f.name as string;
    if (name && FIELD_NAME_MAP[name]) {
      fieldMapping[f.id as string] = FIELD_NAME_MAP[name];
    }
  }

  // Bulk fetch in batches
  const allRecords: Array<Record<string, unknown>> = [];
  for (let i = 0; i < recordIds.length; i += BULK_FETCH_BATCH_SIZE) {
    const batch = recordIds.slice(i, i + BULK_FETCH_BATCH_SIZE);
    const batchResp = await clayFetch(`tables/${tableId}/bulk-fetch-records`, {
      body: { recordIds: batch, includeExternalContentFieldIds: [] },
    }) as Record<string, unknown>;
    const results = (batchResp.results as Array<Record<string, unknown>>) || [];
    allRecords.push(...results);

    if (i + BULK_FETCH_BATCH_SIZE < recordIds.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Parse records into people
  const people: ClayPerson[] = [];
  for (const record of allRecords) {
    const cells = (record.cells as Record<string, Record<string, unknown>>) || {};
    const person: Record<string, string> = {};
    for (const [fieldId, colName] of Object.entries(fieldMapping)) {
      const cell = cells[fieldId];
      if (cell) {
        person[colName] = (cell.value as string) || '';
      }
    }
    people.push({
      first_name: person.first_name || '',
      last_name: person.last_name || '',
      full_name: person.full_name || '',
      job_title: person.job_title || '',
      location: person.location || '',
      company_domain: person.company_domain || '',
      linkedin_url: person.linkedin_url || '',
    });
  }

  // Cleanup: delete the Clay table
  try {
    await clayFetch(`tables/${tableId}`, { method: 'DELETE' });
  } catch {
    // Non-fatal
  }

  return people;
}

// ─── Main Export ───────────────────────────────────────────────────────────

export async function searchPeople(
  domains: string[],
  filters: ClaySearchFilters,
  onProgress?: (msg: string) => void
): Promise<ClaySearchResult> {
  const limit = filters.limit ?? null;
  const usePreview = limit !== null && limit <= 50;

  if (usePreview) {
    const { people } = await previewSearch(domains, filters, onProgress);
    return { people, totalCount: people.length, mode: 'preview' };
  }

  const people = await fullSearch(domains, filters, onProgress);
  return { people, totalCount: people.length, mode: 'full' };
}

// ─── Company Search ────────────────────────────────────────────────────────

export interface ClayCompanySearchFilters {
  industries?: string[];
  industries_exclude?: string[];
  sizes?: string[];
  country_names?: string[];
  country_names_exclude?: string[];
  locations?: string[];
  locations_exclude?: string[];
  description_keywords?: string[];
  description_keywords_exclude?: string[];
  annual_revenues?: string[];
  funding_amounts?: string[];
  types?: string[];
  derived_business_types?: string[];
  derived_industries?: string[];
  derived_revenue_streams?: string[];
  derived_subindustries?: string[];
  derived_subindustries_exclude?: string[];
  semantic_description?: string;
  technographics_main_categories?: string[];
  technographics_parent_categories?: string[];
  technographics_products?: string[];
  technographics_vendors?: string[];
  minimum_member_count?: number | null;
  maximum_member_count?: number | null;
  minimum_follower_count?: number | null;
  company_identifier?: string[];
  limit?: number | null;
}

export interface ClayCompany {
  name: string;
  type: string;
  size: string;
  industry: string;
  country: string;
  location: string;
  domain: string;
  linkedin_url: string;
  description: string;
  annual_revenue: string;
}

export interface ClayCompanySearchResult {
  companies: ClayCompany[];
  totalCount: number;
  mode: 'preview' | 'full';
}

function buildCompanyInputs(filters: ClayCompanySearchFilters): Record<string, unknown> {
  return {
    annual_revenues: filters.annual_revenues ?? [],
    company_identifier: filters.company_identifier ?? [],
    country_names: filters.country_names ?? [],
    country_names_exclude: filters.country_names_exclude ?? [],
    derived_business_types: filters.derived_business_types ?? [],
    derived_industries: filters.derived_industries ?? [],
    derived_revenue_streams: filters.derived_revenue_streams ?? [],
    derived_subindustries: filters.derived_subindustries ?? [],
    derived_subindustries_exclude: filters.derived_subindustries_exclude ?? [],
    description_keywords: filters.description_keywords ?? [],
    description_keywords_exclude: filters.description_keywords_exclude ?? [],
    domainFieldId: null,
    exclude_entities_configuration: [],
    exclude_entities_bitmap: null,
    previous_entities_bitmap: null,
    exclude_company_identifiers_mixed: [],
    funding_amounts: filters.funding_amounts ?? [],
    industries: filters.industries ?? [],
    industries_exclude: filters.industries_exclude ?? [],
    limit: filters.limit ?? 50,
    locations: filters.locations ?? [],
    locations_exclude: filters.locations_exclude ?? [],
    maximum_member_count: filters.maximum_member_count ?? null,
    minimum_follower_count: filters.minimum_follower_count ?? null,
    minimum_member_count: filters.minimum_member_count ?? null,
    name: '',
    radialKnnMinScore: null,
    has_resolved_domain: null,
    resolved_domain_is_live: null,
    resolved_domain_redirects: null,
    semantic_description: filters.semantic_description ?? '',
    sizes: filters.sizes ?? [],
    startFromCompanyType: 'company_identifier',
    tableId: null,
    technographics_main_categories: filters.technographics_main_categories ?? [],
    technographics_parent_categories: filters.technographics_parent_categories ?? [],
    technographics_products: filters.technographics_products ?? [],
    technographics_vendors: filters.technographics_vendors ?? [],
    types: filters.types ?? [],
    useRadialKnn: false,
    result_count: true,
  };
}

function parseCompanyPreview(raw: Record<string, unknown>): ClayCompany {
  return {
    name: (raw.name as string) || '',
    type: (raw.type as string) || '',
    size: (raw.size as string) || '',
    industry: (raw.industry as string) || '',
    country: (raw.country as string) || '',
    location: (raw.location as string) || '',
    domain: (raw.domain as string) || '',
    linkedin_url: (raw.linkedin_url as string) || '',
    description: ((raw.description as string) || '').slice(0, 500),
    annual_revenue: (raw.annual_revenue as string) || '',
  };
}

const COMPANY_BASIC_FIELDS = [
  { name: 'Company Name', dataType: 'text', formulaText: '{{source}}.name' },
  { name: 'Type', dataType: 'text', formulaText: '{{source}}.type' },
  { name: 'Size', dataType: 'text', formulaText: '{{source}}.size' },
  { name: 'Industry', dataType: 'text', formulaText: '{{source}}.industry' },
  { name: 'Country', dataType: 'text', formulaText: '{{source}}.country' },
  { name: 'Location', dataType: 'text', formulaText: '{{source}}.location' },
  { name: 'Domain', dataType: 'url', formulaText: '{{source}}.domain', isDedupeField: true },
  { name: 'LinkedIn URL', dataType: 'url', formulaText: '{{source}}.linkedin_url' },
  { name: 'Annual Revenue', dataType: 'text', formulaText: '{{source}}.annual_revenue' },
  { name: 'Description', dataType: 'text', formulaText: '{{source}}.description' },
];

const COMPANY_FIELD_NAME_MAP: Record<string, string> = {
  'Company Name': 'name',
  'Type': 'type',
  'Size': 'size',
  'Industry': 'industry',
  'Country': 'country',
  'Location': 'location',
  'Domain': 'domain',
  'LinkedIn URL': 'linkedin_url',
  'Annual Revenue': 'annual_revenue',
  'Description': 'description',
};

async function companyPreviewSearch(
  filters: ClayCompanySearchFilters,
  onProgress?: (msg: string) => void
): Promise<{ taskId: string; companies: ClayCompany[] }> {
  const workspaceId = getWorkspaceId();
  const previewFilters = { ...filters, limit: Math.min(filters.limit ?? 50, 50) };

  onProgress?.('Running company preview search...');

  const data = await clayFetch('actions/run-enrichment', {
    body: {
      workspaceId,
      enrichmentType: COMPANY_PREVIEW_ACTION_KEY,
      options: { sync: true, returnTaskId: true, returnActionMetadata: true },
      inputs: buildCompanyInputs(previewFilters),
    },
  }) as Record<string, unknown>;

  const taskId = (data.taskId as string) || '';
  const result = data.result as Record<string, unknown>;
  const rawCompanies = (result?.companies as Record<string, unknown>[]) || [];
  const companies = rawCompanies.map(parseCompanyPreview);

  onProgress?.(`Preview complete — ${companies.length} companies`);
  return { taskId, companies };
}

async function fullCompanySearch(
  filters: ClayCompanySearchFilters,
  onProgress?: (msg: string) => void
): Promise<ClayCompany[]> {
  const workspaceId = getWorkspaceId();

  // Step 1: Create workbook
  onProgress?.('Step 1/6: Creating workbook...');
  const wbResp = await clayFetch('workbooks', {
    body: { workspaceId, name: 'Company Search' },
  }) as Record<string, unknown>;
  const workbookId = wbResp.id as string;

  // Step 1b: Create conversation
  const convResp = await clayFetch(`${workspaceId}/ai-generation/chat-conversation`, {
    body: {
      conversationType: 'ai_onboarding',
      initialSourceState: {
        sourceType: 'companies',
        sourceConfig: { type: 'companies', inputs: buildCompanyInputs({}) },
      },
    },
  }) as Record<string, unknown>;
  const conversationId = convResp.conversationId as string;

  // Step 2: Preview for taskId
  onProgress?.('Step 2/6: Running preview for task ID...');
  const { taskId } = await companyPreviewSearch(filters);

  // Step 3: Create CPJ table
  onProgress?.('Step 3/6: Creating search table...');
  const tableResp = await clayFetch('sources/create-cpj-table', {
    body: {
      workspaceId,
      workbookName: 'Company Search',
      workbookId,
      conversationId,
      assignedFieldId: 'f_company_search',
      cpjConfig: {
        type: 'companies',
        typeSettings: {
          name: 'Find companies',
          iconType: 'Building',
          actionKey: 'find-lists-of-companies-with-mixrank-source',
          actionPackageId: ACTION_PACKAGE_ID,
          previewTextPath: 'name',
          defaultPreviewText: 'Company',
          recordsPath: 'companies',
          idPath: 'clay_company_id',
          scheduleConfig: { runSettings: 'once' },
          dedupeOnUniqueIds: true,
          hasEvaluatedInputs: true,
          inputs: buildCompanyInputs(filters),
          previewActionKey: COMPANY_PREVIEW_ACTION_KEY,
        },
        basicFields: COMPANY_BASIC_FIELDS,
        clientSettings: { tableType: 'company' },
        previewActionTaskId: taskId,
      },
    },
  }) as Record<string, unknown>;

  const tableId = tableResp.tableId as string;
  const sourceId = tableResp.sourceId as string;
  let viewId = (tableResp.viewId as string) || '';

  // Step 4: Poll
  onProgress?.('Step 4/6: Waiting for results...');
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pollResp = await clayFetch(`sources/${sourceId}/runs?limit=1`) as Record<string, unknown>;
    const runs = (pollResp.runs as Array<Record<string, unknown>>) || [];
    if (runs.length > 0) {
      const status = runs[0].status as string;
      if (status === 'SUCCESS') { onProgress?.('Search completed'); break; }
      if (status === 'ERROR' || status === 'FAILED') {
        throw new Error(`Clay search failed: ${runs[0].message || status}`);
      }
      onProgress?.(`  Status: ${status}...`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (Date.now() >= deadline) throw new Error('Clay search timed out');

  // Step 5: Fetch record IDs
  onProgress?.('Step 5/6: Fetching record IDs...');
  if (!viewId) {
    const ti = await clayFetch(`tables/${tableId}`) as Record<string, unknown>;
    const t = (ti.table as Record<string, unknown>) || ti;
    viewId = (t.defaultViewId as string) || '';
  }
  const idsResp = await clayFetch(`tables/${tableId}/views/${viewId}/records/ids`) as Record<string, unknown>;
  const recordIds = (idsResp.results as string[]) || [];

  // Step 6: Bulk fetch
  onProgress?.(`Step 6/6: Fetching ${recordIds.length} records...`);
  const ti = await clayFetch(`tables/${tableId}`) as Record<string, unknown>;
  const td = (ti.table as Record<string, unknown>) || ti;
  const fields = (td.fields as Array<Record<string, unknown>>) || [];
  const fieldMapping: Record<string, string> = {};
  for (const f of fields) {
    const name = f.name as string;
    if (name && COMPANY_FIELD_NAME_MAP[name]) fieldMapping[f.id as string] = COMPANY_FIELD_NAME_MAP[name];
  }

  const allRecords: Array<Record<string, unknown>> = [];
  for (let i = 0; i < recordIds.length; i += BULK_FETCH_BATCH_SIZE) {
    const batch = recordIds.slice(i, i + BULK_FETCH_BATCH_SIZE);
    const br = await clayFetch(`tables/${tableId}/bulk-fetch-records`, {
      body: { recordIds: batch, includeExternalContentFieldIds: [] },
    }) as Record<string, unknown>;
    allRecords.push(...((br.results as Array<Record<string, unknown>>) || []));
    if (i + BULK_FETCH_BATCH_SIZE < recordIds.length) await new Promise(r => setTimeout(r, 100));
  }

  const companies: ClayCompany[] = allRecords.map(record => {
    const cells = (record.cells as Record<string, Record<string, unknown>>) || {};
    const c: Record<string, string> = {};
    for (const [fid, col] of Object.entries(fieldMapping)) {
      const cell = cells[fid];
      if (cell) c[col] = (cell.value as string) || '';
    }
    return {
      name: c.name || '', type: c.type || '', size: c.size || '',
      industry: c.industry || '', country: c.country || '', location: c.location || '',
      domain: c.domain || '', linkedin_url: c.linkedin_url || '',
      description: (c.description || '').slice(0, 500), annual_revenue: c.annual_revenue || '',
    };
  });

  // Cleanup
  try { await clayFetch(`tables/${tableId}`, { method: 'DELETE' }); } catch { /* */ }

  return companies;
}

export async function searchCompanies(
  filters: ClayCompanySearchFilters,
  onProgress?: (msg: string) => void
): Promise<ClayCompanySearchResult> {
  const limit = filters.limit ?? null;
  const usePreview = limit !== null && limit <= 50;

  if (usePreview) {
    const { companies } = await companyPreviewSearch(filters, onProgress);
    return { companies, totalCount: companies.length, mode: 'preview' };
  }

  const companies = await fullCompanySearch(filters, onProgress);
  return { companies, totalCount: companies.length, mode: 'full' };
}
