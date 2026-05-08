import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import type { CampaignStep, CampaignContext, CellValue } from '@/lib/db/schema';
import { searchPeople as claySearchPeople, searchCompanies as claySearchCompanies } from '@/lib/clay-api';
import type { ClaySearchFilters, ClayCompanySearchFilters } from '@/lib/clay-api';
import { searchPeople as aiArkSearchPeople, searchCompanies as aiArkSearchCompanies } from '@/lib/aiarc-api';
import type { AiArcPeopleFilters, AiArcCompanyFilters } from '@/lib/aiarc-api';

// Standard column sets for auto-creating sheets
const COMPANY_COLUMNS = ['Company Name', 'Domain', 'Size', 'Industry', 'Country', 'Location', 'LinkedIn URL', 'Description', 'Annual Revenue'];
const PEOPLE_COLUMNS = ['First Name', 'Last Name', 'Full Name', 'Job Title', 'Company Domain', 'Location', 'LinkedIn URL'];

type StepResult = { result: Record<string, unknown>; contextUpdate: Partial<CampaignContext> };

// ─── Internal-fetch helpers (used by the new step types) ──────────────────────
//
// Same pattern as the existing find_emails / lookup / enrich cases below: thunk
// to one of our own /api/* routes with the bearer token. All three new agent
// step types (find_domains, find_emails_waterfall, clean_*) reuse this.

function internalBaseUrl(): string {
  return process.env.APP_URL || 'http://localhost:3000';
}

async function internalFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${internalBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DATAFLOW_API_KEY}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Internal ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function listEmptyRowIds(tableId: string, columnId: string): Promise<string[]> {
  const all = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
  return all
    .filter(r => {
      const v = (r.data as Record<string, CellValue>)[columnId]?.value;
      return v === undefined || v === null || String(v).trim() === '';
    })
    .map(r => r.id);
}

// A cell is "missing a usable domain" if it's empty OR the value doesn't look
// like a real company website (e.g. WhatsApp message URLs, social links,
// directory pages). Used by find_domains and the company-domain filter step
// to catch garbage data from upstream search providers.
function isUsableCompanyDomain(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  // Strip protocol, www, and any path so we're working with just the host.
  const host = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[\/?#]/)[0]
    .toLowerCase();
  if (!host) return false;
  if (!host.includes('.')) return false;
  if (/\s/.test(host)) return false;
  if (host.length > 253) return false;
  // Reject hosts that are messaging/social/directory shorteners — these
  // appear as "domains" in some Clay/AI Ark records but aren't real company
  // websites and never resolve to a real account in either provider.
  const NON_COMPANY_HOSTS = new Set([
    'wa.me', 't.me', 'fb.me', 'lnkd.in', 'bit.ly', 'tinyurl.com',
    'facebook.com', 'm.facebook.com', 'instagram.com', 'twitter.com', 'x.com',
    'linkedin.com', 'tiktok.com', 'youtube.com', 'youtu.be',
    'pinterest.com', 'snapchat.com',
    'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com',
    'crunchbase.com', 'glassdoor.com', 'zoominfo.com', 'apollo.io',
    'wikipedia.org', 'github.com', 'play.google.com', 'apps.apple.com',
  ]);
  if (NON_COMPANY_HOSTS.has(host)) return false;
  return true;
}

// Normalize a usable domain to its bare host form ("stripe.com"), suitable
// for AI Ark / Clay companyDomain filters and find-email lookups.
function normalizeDomainHost(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[\/?#]/)[0]
    .toLowerCase();
}

async function listMissingOrJunkDomainRowIds(tableId: string, columnId: string): Promise<string[]> {
  const all = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
  return all
    .filter(r => {
      const v = (r.data as Record<string, CellValue>)[columnId]?.value;
      return !isUsableCompanyDomain(v);
    })
    .map(r => r.id);
}

async function listAllRowIds(tableId: string): Promise<string[]> {
  const all = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
  return all.map(r => r.id);
}

async function ensureSheetColumn(
  sheet: { tableId: string; columnIds: Record<string, string> },
  name: string,
  type: 'text' | 'email' | 'url' = 'text',
  width = 150,
): Promise<string> {
  if (sheet.columnIds[name]) return sheet.columnIds[name];
  const existing = await db.select().from(schema.columns).where(eq(schema.columns.tableId, sheet.tableId));
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.order), 0);
  const id = generateId();
  await db.insert(schema.columns).values({
    id,
    tableId: sheet.tableId,
    name,
    type,
    width,
    order: maxOrder + 1,
  });
  sheet.columnIds[name] = id;
  return id;
}

interface CreatedConfig { id: string }

async function createEnrichmentConfig(opts: {
  name: string;
  prompt: string;
  inputColumns: string[];
  model?: string;
  outputColumns?: string[];
  temperature?: number;
  webSearchEnabled?: boolean;
}): Promise<CreatedConfig> {
  return internalFetch<CreatedConfig>('/api/enrichment', {
    method: 'POST',
    body: JSON.stringify({
      name: opts.name,
      model: opts.model || 'gpt-5-mini',
      prompt: opts.prompt,
      inputColumns: opts.inputColumns,
      outputColumns: opts.outputColumns || [],
      outputFormat: 'text',
      temperature: opts.temperature ?? 0.3,
      webSearchEnabled: !!opts.webSearchEnabled,
    }),
  });
}

async function runRealtimeEnrichment(
  configId: string,
  tableId: string,
  targetColumnId: string,
  rowIds: string[],
): Promise<unknown> {
  if (rowIds.length === 0) return { skipped: 'no rows' };
  return internalFetch('/api/enrichment/run', {
    method: 'POST',
    body: JSON.stringify({ configId, tableId, targetColumnId, rowIds }),
  });
}

async function deleteRowsByIds(rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  for (let i = 0; i < rowIds.length; i += 500) {
    const batch = rowIds.slice(i, i + 500);
    await db.delete(schema.rows).where(inArray(schema.rows.id, batch));
  }
}

export async function executeStep(
  step: CampaignStep,
  context: CampaignContext,
  campaignId: string
): Promise<StepResult> {
  const log = (msg: string) => console.log(`[campaign:${campaignId}] ${msg}`);

  switch (step.type) {
    case 'create_workbook': {
      const name = (step.params.name as string) || 'Campaign';
      const now = new Date();
      const id = generateId();
      await db.insert(schema.projects).values({ id, name, type: 'workbook', createdAt: now, updatedAt: now });
      log(`Created workbook: ${name} (${id})`);
      return { result: { workbookId: id }, contextUpdate: { workbookId: id } };
    }

    case 'search_companies': {
      // Source is stamped onto each search step by /api/agent/.../launch.
      // Default to clay for back-compat with the original /campaign skill,
      // which doesn't set this field.
      const source = (step.params.source as 'ai-ark' | 'clay' | undefined) || 'clay';

      if (source === 'ai-ark') {
        const filters = (step.params.filters || {}) as AiArcCompanyFilters;
        const limit = filters.limit ?? 1000;
        log(`[ai-ark] Searching companies, limit=${limit}, filters: ${JSON.stringify(filters)}`);
        const result = await aiArkSearchCompanies(filters, limit, log);
        log(`[ai-ark] Found ${result.totalCount} companies, returned ${result.items.length}`);
        return {
          result: { totalCount: result.totalCount, mode: 'ai-ark' },
          contextUpdate: { searchResults: { ...context.searchResults, companies: result.items as unknown[] } },
        };
      }

      // Clay path
      const filters = (step.params.filters || {}) as ClayCompanySearchFilters;
      log(`[clay] Searching companies with filters: ${JSON.stringify(filters)}`);
      const result = await claySearchCompanies(filters, log);
      log(`[clay] Found ${result.totalCount} companies`);
      return {
        result: { totalCount: result.totalCount, mode: result.mode },
        contextUpdate: { searchResults: { ...context.searchResults, companies: result.companies } },
      };
    }

    case 'search_people': {
      const source = (step.params.source as 'ai-ark' | 'clay' | undefined) || 'clay';

      // Resolve domainsFrom -> a list of domain strings, regardless of source.
      let extractedDomains: string[] = (step.params.domains as string[]) || [];
      if (step.params.domainsFrom && extractedDomains.length === 0) {
        const ref = step.params.domainsFrom as string; // e.g. "sheet:Companies:Domain"
        const [, sheetName, colName] = ref.split(':');
        const sheet = context.sheets?.[sheetName];
        if (sheet) {
          const colId = sheet.columnIds[colName];
          if (colId) {
            const rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sheet.tableId));
            const rawValues = rows
              .map(r => (r.data as Record<string, CellValue>)[colId]?.value)
              .filter((v): v is string => typeof v === 'string' && v.length > 0);
            // Validate + normalize: drop junk URLs (wa.me, social hosts,
            // etc.) and strip protocol/www/path so AI Ark / Clay see bare
            // hosts like "stripe.com". Also dedupe.
            const seen = new Set<string>();
            extractedDomains = [];
            const dropped: string[] = [];
            for (const v of rawValues) {
              if (!isUsableCompanyDomain(v)) {
                dropped.push(v);
                continue;
              }
              const host = normalizeDomainHost(v);
              if (host && !seen.has(host)) {
                seen.add(host);
                extractedDomains.push(host);
              }
            }
            log(
              `Extracted ${extractedDomains.length} usable domains from ${sheetName}:${colName} ` +
              `(${dropped.length} junk values dropped)`,
            );
            if (dropped.length > 0 && dropped.length <= 5) {
              log(`Sample dropped: ${dropped.join(', ')}`);
            }
          }
        }
        (step.params as Record<string, unknown>).domains = extractedDomains;
      }

      if (source === 'ai-ark') {
        const filters = { ...((step.params.filters || {}) as AiArcPeopleFilters) };
        if (extractedDomains.length > 0) {
          filters.companyDomain = extractedDomains;
        }
        const limit = filters.limit ?? 5000;
        log(`[ai-ark] Searching people, limit=${limit}, ${extractedDomains.length} domains, filters: ${JSON.stringify(filters)}`);
        const result = await aiArkSearchPeople(filters, limit, log);
        log(`[ai-ark] Found ${result.totalCount} people, returned ${result.items.length}`);
        return {
          result: { totalCount: result.totalCount, mode: 'ai-ark' },
          contextUpdate: { searchResults: { ...context.searchResults, people: result.items as unknown[] } },
        };
      }

      // Clay path
      const filters = (step.params.filters || {}) as ClaySearchFilters;
      log(`[clay] Searching people (${extractedDomains.length} domains, filters: ${JSON.stringify(filters)})`);
      const result = await claySearchPeople(extractedDomains, filters, log);
      log(`[clay] Found ${result.totalCount} people`);
      return {
        result: { totalCount: result.totalCount, mode: result.mode },
        contextUpdate: { searchResults: { ...context.searchResults, people: result.people } },
      };
    }

    case 'create_sheet': {
      const sheetName = (step.params.name as string) || 'Sheet';
      const columnNames = (step.params.columns as string[]) ||
        (context.searchResults?.companies ? COMPANY_COLUMNS : PEOPLE_COLUMNS);
      const workbookId = context.workbookId;
      if (!workbookId) throw new Error('No workbook created yet');

      const now = new Date();
      const tableId = generateId();
      await db.insert(schema.tables).values({ id: tableId, projectId: workbookId, name: sheetName, createdAt: now, updatedAt: now });

      const columnIds: Record<string, string> = {};
      for (let i = 0; i < columnNames.length; i++) {
        const colId = generateId();
        const colType = columnNames[i].toLowerCase().includes('linkedin') || columnNames[i].toLowerCase().includes('domain') ? 'url' : 'text';
        await db.insert(schema.columns).values({
          id: colId, tableId, name: columnNames[i], type: colType, order: i, width: 150,
        });
        columnIds[columnNames[i]] = colId;
      }

      const sheets = { ...context.sheets, [sheetName]: { tableId, columnIds } };
      log(`Created sheet: ${sheetName} (${tableId}) with ${columnNames.length} columns`);
      return { result: { tableId, columnCount: columnNames.length }, contextUpdate: { sheets } };
    }

    case 'import_rows': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found in context`);

      const source = (step.params.source as string) || 'previous_search';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let records: any[] = [];

      if (source === 'previous_search' || source === 'companies') {
        records = (context.searchResults?.companies || []) as Record<string, unknown>[];
      } else if (source === 'people') {
        records = (context.searchResults?.people || []) as Record<string, unknown>[];
      }

      if (records.length === 0) {
        log(`No records to import for ${sheetName}`);
        return { result: { rowCount: 0 }, contextUpdate: {} };
      }

      // Map records to row data using column IDs
      const now = new Date();
      const rowIds: string[] = [];
      const BATCH_SIZE = 500;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const rowsToInsert = batch.map(record => {
          const rowId = generateId();
          rowIds.push(rowId);
          const data: Record<string, CellValue> = {};

          // Map known fields to columns
          for (const [colName, colId] of Object.entries(sheet.columnIds)) {
            const value = mapRecordToColumn(record, colName);
            if (value !== undefined) {
              data[colId] = { value, status: 'complete' };
            }
          }
          return { id: rowId, tableId: sheet.tableId, data, createdAt: now };
        });

        await db.insert(schema.rows).values(rowsToInsert);
      }

      const existingRowIds = context.rowIds || {};
      log(`Imported ${rowIds.length} rows into ${sheetName}`);
      return {
        result: { rowCount: rowIds.length },
        contextUpdate: { rowIds: { ...existingRowIds, [sheetName]: rowIds } },
      };
    }

    case 'filter_rows': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

      const removeFilters = (step.params.remove || []) as Array<{ column: string; operator: string }>;
      const allRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sheet.tableId));

      const idsToDelete: string[] = [];
      for (const row of allRows) {
        const data = row.data as Record<string, CellValue>;
        for (const filter of removeFilters) {
          const colId = sheet.columnIds[filter.column];
          if (!colId) continue;
          const val = data[colId]?.value;
          // is_empty on a Domain-like column also catches junk values (e.g.
          // WhatsApp/social URLs that some search providers return as
          // "domain"). Without this, find_domains has nothing to backfill
          // and the people search downstream sees garbage in companyDomain.
          const isDomainCol = /domain/i.test(filter.column);
          const isEmptyOrJunk =
            filter.operator === 'is_empty' &&
            ((!val || String(val).trim() === '') ||
              (isDomainCol && !isUsableCompanyDomain(val)));
          if (isEmptyOrJunk) {
            idsToDelete.push(row.id);
            break;
          }
        }
      }

      if (idsToDelete.length > 0) {
        for (let i = 0; i < idsToDelete.length; i += 500) {
          const batch = idsToDelete.slice(i, i + 500);
          await db.delete(schema.rows).where(inArray(schema.rows.id, batch));
        }
      }

      log(`Filtered ${sheetName}: removed ${idsToDelete.length} rows (${allRows.length - idsToDelete.length} remaining)`);
      return { result: { removed: idsToDelete.length, remaining: allRows.length - idsToDelete.length }, contextUpdate: {} };
    }

    case 'find_emails': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

      const nameCol = (step.params.nameColumn as string) || 'Full Name';
      const domainCol = (step.params.domainColumn as string) || 'Company Domain';

      // Create Email + Email Status columns if not exist
      if (!sheet.columnIds['Email']) {
        const emailColId = generateId();
        const maxOrder = Object.keys(sheet.columnIds).length;
        await db.insert(schema.columns).values({ id: emailColId, tableId: sheet.tableId, name: 'Email', type: 'email', order: maxOrder, width: 200 });
        sheet.columnIds['Email'] = emailColId;
      }
      if (!sheet.columnIds['Email Status']) {
        const statusColId = generateId();
        const maxOrder = Object.keys(sheet.columnIds).length;
        await db.insert(schema.columns).values({ id: statusColId, tableId: sheet.tableId, name: 'Email Status', type: 'text', order: maxOrder, width: 120 });
        sheet.columnIds['Email Status'] = statusColId;
      }

      // Get all row IDs for this sheet
      const rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sheet.tableId));
      const rowIds = rows.map(r => r.id);

      // Call the find-email endpoint internally via fetch
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const apiKey = process.env.DATAFLOW_API_KEY;

      const response = await fetch(`${baseUrl}/api/find-email/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          tableId: sheet.tableId,
          rowIds,
          inputMode: 'full_name',
          fullNameColumnId: sheet.columnIds[nameCol],
          domainColumnId: sheet.columnIds[domainCol],
          emailColumnId: sheet.columnIds['Email'],
          emailStatusColumnId: sheet.columnIds['Email Status'],
        }),
      });

      const result = await response.json();
      log(`Find email result: ${JSON.stringify(result)}`);

      // Update context with new column IDs
      const sheets = { ...context.sheets, [sheetName]: sheet };
      return { result, contextUpdate: { sheets } };
    }

    case 'lookup': {
      const targetSheet = (step.params.targetSheet as string) || '';
      const sourceSheet = (step.params.sourceSheet as string) || '';
      const inputColumn = step.params.inputColumn as string;
      const matchColumn = step.params.matchColumn as string;
      const returnColumn = step.params.returnColumn as string;
      const newColumnName = (step.params.newColumnName as string) || returnColumn;

      const target = context.sheets?.[targetSheet];
      const source = context.sheets?.[sourceSheet];
      if (!target || !source) throw new Error(`Sheets not found: target=${targetSheet}, source=${sourceSheet}`);

      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const apiKey = process.env.DATAFLOW_API_KEY;

      const response = await fetch(`${baseUrl}/api/lookup/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          tableId: target.tableId,
          sourceTableId: source.tableId,
          inputColumnId: target.columnIds[inputColumn],
          matchColumnId: source.columnIds[matchColumn],
          returnColumnId: source.columnIds[returnColumn],
          newColumnName,
        }),
      });

      const result = await response.json();
      log(`Lookup result: ${JSON.stringify(result)}`);
      return { result, contextUpdate: {} };
    }

    case 'enrich': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const apiKey = process.env.DATAFLOW_API_KEY;

      // Create enrichment config
      const configResponse = await fetch(`${baseUrl}/api/enrichment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(step.params.config),
      });
      const config = await configResponse.json();

      // Get row IDs
      const rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sheet.tableId));
      const rowIds = rows.map(r => r.id);

      // Run enrichment
      const runResponse = await fetch(`${baseUrl}/api/enrichment/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          configId: config.id,
          tableId: sheet.tableId,
          targetColumnId: sheet.columnIds[step.params.targetColumn as string] || generateId(),
          rowIds,
        }),
      });

      const result = await runResponse.json();
      log(`Enrichment result: ${JSON.stringify(result)}`);
      return { result, contextUpdate: {} };
    }

    case 'cleanup': {
      // Same as filter_rows but specifically for removing empty email rows
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

      const emailColId = sheet.columnIds['Email'];
      if (!emailColId) {
        log('No Email column found, skipping cleanup');
        return { result: { removed: 0 }, contextUpdate: {} };
      }

      const rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sheet.tableId));
      const idsToDelete = rows
        .filter(r => {
          const val = (r.data as Record<string, CellValue>)[emailColId]?.value;
          return !val || String(val).trim() === '';
        })
        .map(r => r.id);

      if (idsToDelete.length > 0) {
        for (let i = 0; i < idsToDelete.length; i += 500) {
          const batch = idsToDelete.slice(i, i + 500);
          await db.delete(schema.rows).where(inArray(schema.rows.id, batch));
        }
      }

      log(`Cleanup: removed ${idsToDelete.length} rows without email`);
      return { result: { removed: idsToDelete.length, remaining: rows.length - idsToDelete.length }, contextUpdate: {} };
    }

    case 'find_domains': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
      const domainColName = (step.params.domainColumn as string) || 'Domain';
      const nameColName = (step.params.nameColumn as string) || 'Company Name';
      const domainColId = sheet.columnIds[domainColName];
      const nameColId = sheet.columnIds[nameColName];
      if (!domainColId) throw new Error(`Domain column "${domainColName}" not found`);
      if (!nameColId) throw new Error(`Name column "${nameColName}" not found`);

      // Catch BOTH truly-empty cells AND garbage values (WhatsApp links,
      // social URLs, etc. that some search providers return as "domain").
      const emptyRowIds = await listMissingOrJunkDomainRowIds(sheet.tableId, domainColId);
      if (emptyRowIds.length === 0) {
        log(`find_domains: no rows missing a usable domain — skip`);
        return { result: { backfilled: 0, attempted: 0 }, contextUpdate: {} };
      }
      log(`find_domains: ${emptyRowIds.length} rows missing/junk domain — backfilling via web search`);

      const config = await createEnrichmentConfig({
        name: `Domain Finder (${sheetName})`,
        model: 'gpt-5-mini',
        prompt:
          `Find the official primary website domain for the company "{{${nameColName}}}". ` +
          `Return ONLY the bare domain (e.g. "stripe.com"), no protocol, no www, no path. ` +
          `Do NOT return aggregator pages, social media (LinkedIn, Facebook, Twitter, Instagram), ` +
          `blog hosts (Medium, Substack), directory listings (Crunchbase, ZoomInfo, Glassdoor), or PDFs — ` +
          `only the company's direct, owned website. ` +
          `If you cannot find a confident answer, return an empty string.`,
        inputColumns: [nameColId],
        temperature: 0.1,
        webSearchEnabled: true,
      });
      await runRealtimeEnrichment(config.id, sheet.tableId, domainColId, emptyRowIds);

      const stillEmpty = await listMissingOrJunkDomainRowIds(sheet.tableId, domainColId);
      const backfilled = emptyRowIds.length - stillEmpty.length;
      log(`find_domains: backfilled ${backfilled}/${emptyRowIds.length} (${stillEmpty.length} still missing/junk)`);

      if (step.params.failIfMissing === true && stillEmpty.length > 0) {
        throw new Error(`Domain backfill incomplete: ${stillEmpty.length} rows still missing a usable domain`);
      }
      return {
        result: { attempted: emptyRowIds.length, backfilled, stillEmpty: stillEmpty.length },
        contextUpdate: {},
      };
    }

    case 'qualify_titles': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
      const intent = (step.params.intent as string) || 'fits the campaign target persona';
      const titleColName = (step.params.titleColumn as string) || 'Job Title';
      const threshold = (step.params.unqualifiedThreshold as number) ?? 0.3;
      const titleColId = sheet.columnIds[titleColName];
      if (!titleColId) throw new Error(`Title column "${titleColName}" not found`);

      const allRowIds = await listAllRowIds(sheet.tableId);
      if (allRowIds.length === 0) return { result: { skipped: 'no rows' }, contextUpdate: {} };

      const sampleSize = Math.min(50, Math.max(1, Math.ceil(allRowIds.length * 0.08)));
      const shuffled = allRowIds.slice().sort(() => Math.random() - 0.5);
      const sampleIds = shuffled.slice(0, sampleSize);

      const qualifyColId = await ensureSheetColumn(sheet, 'Title Qualified', 'text', 120);

      const config = await createEnrichmentConfig({
        name: `Title Qualifier (${sheetName})`,
        model: 'gpt-5-mini',
        prompt:
          `A campaign is targeting people who: ${intent}. ` +
          `Given this person's job title: "{{${titleColName}}}", does this person fit that target? ` +
          `Output ONLY one of: "yes", "no", or "unsure". No other text.`,
        inputColumns: [titleColId],
        temperature: 0.1,
      });
      await runRealtimeEnrichment(config.id, sheet.tableId, qualifyColId, sampleIds);

      const sampledRows = await db.select().from(schema.rows).where(inArray(schema.rows.id, sampleIds));
      const noCount = sampledRows.filter(r => {
        const v = String((r.data as Record<string, CellValue>)[qualifyColId]?.value || '').toLowerCase().trim();
        return v === 'no';
      }).length;
      const unqualifiedRate = sampledRows.length > 0 ? noCount / sampledRows.length : 0;
      log(`qualify_titles: sampled ${sampledRows.length}, ${noCount} unqualified (${(unqualifiedRate * 100).toFixed(1)}%)`);

      if (unqualifiedRate < threshold) {
        return {
          result: { sampled: sampledRows.length, unqualifiedRate, action: 'below threshold — no further action' },
          contextUpdate: { sheets: { ...context.sheets, [sheetName]: sheet } },
        };
      }

      const remaining = allRowIds.filter(id => !sampleIds.includes(id));
      if (remaining.length > 0) {
        await runRealtimeEnrichment(config.id, sheet.tableId, qualifyColId, remaining);
      }

      const allScored = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sheet.tableId));
      const toDelete = allScored
        .filter(r => {
          const v = String((r.data as Record<string, CellValue>)[qualifyColId]?.value || '').toLowerCase().trim();
          return v === 'no';
        })
        .map(r => r.id);
      await deleteRowsByIds(toDelete);
      log(`qualify_titles: removed ${toDelete.length} unqualified rows`);

      return {
        result: {
          sampled: sampledRows.length,
          unqualifiedRate,
          scored: allRowIds.length,
          removed: toDelete.length,
          remaining: allRowIds.length - toDelete.length,
        },
        contextUpdate: { sheets: { ...context.sheets, [sheetName]: sheet } },
      };
    }

    case 'find_emails_waterfall': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
      const nameCol = (step.params.nameColumn as string) || 'Full Name';
      const domainCol = (step.params.domainColumn as string) || 'Company Domain';
      const removeEmpty = step.params.removeEmpty !== false;

      const emailColId = await ensureSheetColumn(sheet, 'Email', 'email', 200);
      const statusColId = await ensureSheetColumn(sheet, 'Email Status', 'text', 120);
      const nameColId = sheet.columnIds[nameCol];
      const domainColId = sheet.columnIds[domainCol];
      if (!nameColId) throw new Error(`Name column "${nameCol}" not found`);
      if (!domainColId) throw new Error(`Domain column "${domainCol}" not found`);

      const allRowIds = await listAllRowIds(sheet.tableId);
      if (allRowIds.length === 0) return { result: { skipped: 'no rows' }, contextUpdate: {} };

      const baseBody = {
        tableId: sheet.tableId,
        inputMode: 'full_name',
        fullNameColumnId: nameColId,
        domainColumnId: domainColId,
        emailColumnId: emailColId,
        emailStatusColumnId: statusColId,
      };

      // Pass 1: AI Ark (async submit; fills cells via webhook over ~60-90s)
      log(`find_emails_waterfall: AI Ark on ${allRowIds.length} rows`);
      try {
        await internalFetch('/api/find-email/ai-ark', {
          method: 'POST',
          body: JSON.stringify({ ...baseBody, rowIds: allRowIds }),
        });
      } catch (err) {
        log(`AI Ark submission warning (continuing): ${(err as Error).message}`);
      }

      // Wait for webhooks to settle — poll the cells until none are 'processing'.
      // Cap at 4 minutes so the cron's 5-min budget still has slack for Ninjer + TryKitt.
      const maxWaitMs = 240_000;
      const pollMs = 15_000;
      const startedAt = Date.now();
      while (Date.now() - startedAt < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, pollMs));
        const rowsChunk = await db.select().from(schema.rows).where(inArray(schema.rows.id, allRowIds));
        const stillProcessing = rowsChunk.filter(r => {
          const cell = (r.data as Record<string, CellValue>)[emailColId];
          return cell?.status === 'processing';
        }).length;
        log(`find_emails_waterfall: AI Ark poll — ${stillProcessing} cells still processing`);
        if (stillProcessing === 0) break;
      }

      // Pass 2: Ninjer for rows still empty
      const stillEmpty1 = await listEmptyRowIds(sheet.tableId, emailColId);
      log(`find_emails_waterfall: Ninjer on ${stillEmpty1.length} remaining`);
      if (stillEmpty1.length > 0) {
        try {
          await internalFetch('/api/find-email/run', {
            method: 'POST',
            body: JSON.stringify({ ...baseBody, rowIds: stillEmpty1 }),
          });
        } catch (err) {
          log(`Ninjer warning (continuing): ${(err as Error).message}`);
        }
      }

      // Pass 3: TryKitt for rows still empty
      const stillEmpty2 = await listEmptyRowIds(sheet.tableId, emailColId);
      log(`find_emails_waterfall: TryKitt on ${stillEmpty2.length} remaining`);
      if (stillEmpty2.length > 0) {
        try {
          await internalFetch('/api/find-email/trykitt', {
            method: 'POST',
            body: JSON.stringify({ ...baseBody, rowIds: stillEmpty2 }),
          });
        } catch (err) {
          log(`TryKitt warning (continuing): ${(err as Error).message}`);
        }
      }

      // Final cleanup
      const finalEmpty = await listEmptyRowIds(sheet.tableId, emailColId);
      let dropped = 0;
      if (removeEmpty && finalEmpty.length > 0) {
        await deleteRowsByIds(finalEmpty);
        dropped = finalEmpty.length;
        log(`find_emails_waterfall: dropped ${dropped} rows still without email`);
      }

      return {
        result: {
          attempted: allRowIds.length,
          aiArkPass: allRowIds.length - stillEmpty1.length,
          ninjerPass: stillEmpty1.length - stillEmpty2.length,
          trykittPass: stillEmpty2.length - finalEmpty.length,
          droppedEmpty: dropped,
          finalCount: allRowIds.length - dropped,
        },
        contextUpdate: { sheets: { ...context.sheets, [sheetName]: sheet } },
      };
    }

    case 'clean_company_name': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
      const inputColName = (step.params.inputColumn as string) || 'Company Domain';
      const outputColName = (step.params.outputColumn as string) || 'Sending Company Name';
      const inputColId = sheet.columnIds[inputColName];
      if (!inputColId) throw new Error(`Input column "${inputColName}" not found`);

      const outColId = await ensureSheetColumn(sheet, outputColName, 'text', 180);
      const allRowIds = await listAllRowIds(sheet.tableId);
      if (allRowIds.length === 0) return { result: { skipped: 'no rows' }, contextUpdate: {} };

      const config = await createEnrichmentConfig({
        name: `Sending Company Name (${sheetName})`,
        model: 'gpt-5-mini',
        prompt:
          `You are cleaning a company name for use in a cold email greeting. ` +
          `Given the company's domain or full name "{{${inputColName}}}", output a short send-friendly version that real humans use in conversation.\n\n` +
          `Rules:\n` +
          `- If the company is well-known by a common abbreviation (e.g. "International Business Machines" -> "IBM"; "Hewlett-Packard" -> "HP"), use the abbreviation. ONLY use abbreviations confirmed to be in widespread real-world use. Never invent abbreviations.\n` +
          `- Strip legal/corporate suffixes ("Inc.", "Incorporated", "LLC", "Ltd", "Pte Ltd", "GmbH", "Pty", "Pvt", "Group", "Holdings", "Corp", "Corporation", "Co.") UNLESS the suffix is part of the spoken name (e.g. "Berkshire Hathaway" stays "Berkshire Hathaway").\n` +
          `- For multi-word names with a clear dominant token, prefer the dominant token (e.g. "Wagner Group Incorporated" -> "Wagner").\n` +
          `- If the input is a domain (e.g. "stripe.com"), derive the brand name ("Stripe").\n` +
          `- Never invent a name. If unsure, return the input cleaned of suffixes only.\n` +
          `- Output: a single short string. No quotes, no explanation, no punctuation beyond what's normally part of the name.`,
        inputColumns: [inputColId],
        temperature: 0.1,
      });
      await runRealtimeEnrichment(config.id, sheet.tableId, outColId, allRowIds);
      log(`clean_company_name: cleaned ${allRowIds.length} -> "${outputColName}"`);
      return {
        result: { processed: allRowIds.length, outputColumn: outputColName },
        contextUpdate: { sheets: { ...context.sheets, [sheetName]: sheet } },
      };
    }

    case 'clean_person_name': {
      const sheetName = (step.params.sheet as string) || Object.keys(context.sheets || {}).pop() || '';
      const sheet = context.sheets?.[sheetName];
      if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
      const fullNameColName = (step.params.fullNameColumn as string) || 'Full Name';
      const firstNameColName = (step.params.firstNameColumn as string) || 'First Name';
      const outputColName = (step.params.outputColumn as string) || 'Sending Name';
      const fullNameColId = sheet.columnIds[fullNameColName];
      const firstNameColId = sheet.columnIds[firstNameColName];

      const inputColId = fullNameColId || firstNameColId;
      const inputColName = fullNameColId ? fullNameColName : firstNameColName;
      if (!inputColId) {
        throw new Error(`No name column found ("${fullNameColName}" or "${firstNameColName}")`);
      }

      const outColId = await ensureSheetColumn(sheet, outputColName, 'text', 150);
      const allRowIds = await listAllRowIds(sheet.tableId);
      if (allRowIds.length === 0) return { result: { skipped: 'no rows' }, contextUpdate: {} };

      const config = await createEnrichmentConfig({
        name: `Sending Name (${sheetName})`,
        model: 'gpt-5-mini',
        prompt:
          `You are cleaning a person's name for use in an email greeting line. ` +
          `Given this name as it appears in our data: "{{${inputColName}}}", output their first name (or preferred short form) suitable for "Hi {name},".\n\n` +
          `Rules:\n` +
          `- Strip honorifics: "Mr.", "Mrs.", "Ms.", "Miss", "Dr.", "Prof.", "Sir", "Madam", "Mx.".\n` +
          `- Strip post-nominals: "MBA", "PhD", "MD", "CFA", "Esq.", "Jr.", "Sr.", "II", "III", "IV", "CPA".\n` +
          `- Strip leading/trailing punctuation that is not part of the name.\n` +
          `- If the input is just a title ("Mr.") or empty, return an empty string.\n` +
          `- Prefer the FIRST given name. "Robert James Smith" -> "Robert".\n` +
          `- Allow common diminutives ONLY if the data shows one (e.g. "Bob Smith" -> "Bob"; do NOT convert "Robert Smith" -> "Bob").\n` +
          `- Output: a single first-name string. No quotes, no explanation, no surname.`,
        inputColumns: [inputColId],
        temperature: 0.1,
      });
      await runRealtimeEnrichment(config.id, sheet.tableId, outColId, allRowIds);
      log(`clean_person_name: cleaned ${allRowIds.length} -> "${outputColName}"`);
      return {
        result: { processed: allRowIds.length, outputColumn: outputColName },
        contextUpdate: { sheets: { ...context.sheets, [sheetName]: sheet } },
      };
    }

    case 'materialize_send_ready': {
      const sourceSheetName = (step.params.sourceSheet as string) || 'People';
      const targetSheetName = (step.params.targetSheet as string) || 'Send-Ready';
      const sourceSheet = context.sheets?.[sourceSheetName];
      if (!sourceSheet) throw new Error(`Source sheet "${sourceSheetName}" not found`);
      if (!context.workbookId) throw new Error('No workbook in context');

      const columnMap = (step.params.columnMap as Record<string, string>) || {
        'Sending Name': 'Sending Name',
        'Sending Company Name': 'Sending Company Name',
        Domain: 'Company Domain',
        Email: 'Email',
      };

      const missing: string[] = [];
      for (const srcCol of Object.values(columnMap)) {
        if (!sourceSheet.columnIds[srcCol]) missing.push(srcCol);
      }
      if (missing.length > 0) {
        throw new Error(`Source sheet "${sourceSheetName}" missing required columns: ${missing.join(', ')}`);
      }

      const now = new Date();
      const targetTableId = generateId();
      await db.insert(schema.tables).values({
        id: targetTableId,
        projectId: context.workbookId,
        name: targetSheetName,
        createdAt: now,
        updatedAt: now,
      });

      const targetColOrder = ['Sending Name', 'Sending Company Name', 'Domain', 'Email'];
      const targetColumnIds: Record<string, string> = {};
      for (let i = 0; i < targetColOrder.length; i++) {
        const colName = targetColOrder[i];
        const colId = generateId();
        const colType: 'text' | 'email' | 'url' =
          colName === 'Email' ? 'email' : colName === 'Domain' ? 'url' : 'text';
        await db.insert(schema.columns).values({
          id: colId,
          tableId: targetTableId,
          name: colName,
          type: colType,
          width: colName === 'Email' ? 220 : 180,
          order: i,
        });
        targetColumnIds[colName] = colId;
      }

      const sourceRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sourceSheet.tableId));
      let copiedCount = 0;
      const BATCH = 500;
      for (let i = 0; i < sourceRows.length; i += BATCH) {
        const batch = sourceRows.slice(i, i + BATCH);
        const toInsert = batch.map(srcRow => {
          const srcData = srcRow.data as Record<string, CellValue>;
          const data: Record<string, CellValue> = {};
          for (const [destCol, srcCol] of Object.entries(columnMap)) {
            const destColId = targetColumnIds[destCol];
            const srcColId = sourceSheet.columnIds[srcCol];
            const value = srcData[srcColId]?.value;
            if (value !== undefined && value !== null && String(value).trim() !== '') {
              data[destColId] = { value, status: 'complete' };
            }
          }
          copiedCount++;
          return { id: generateId(), tableId: targetTableId, data, createdAt: now };
        });
        if (toInsert.length > 0) await db.insert(schema.rows).values(toInsert);
      }

      log(`materialize_send_ready: created sheet "${targetSheetName}" (${targetTableId}) with ${copiedCount} rows`);
      const updatedSheets = {
        ...context.sheets,
        [targetSheetName]: { tableId: targetTableId, columnIds: targetColumnIds },
      };
      return {
        result: { tableId: targetTableId, rowCount: copiedCount, sheetName: targetSheetName },
        contextUpdate: { sheets: updatedSheets },
      };
    }

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

// Map a search result record to a column name. Each column lists the
// candidate keys we look at in priority order — covers Clay's shape AND
// AI Ark's shape so import_rows works regardless of `plan.source`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecordToColumn(record: any, colName: string): string | null {
  const map: Record<string, string[]> = {
    // Companies — Clay uses {name, domain, size, country, location, ...};
    // AI Ark uses {name, domain, staff_range, headquarter_state, headquarter_city, ...}
    'Company Name': ['name', 'company_name'],
    'Domain': ['domain', 'company_domain', 'website'],
    'Size': ['size', 'staff_range'],
    'Industry': ['industry', 'company_industry'],
    'Country': ['country', 'headquarter_state'],
    'Location': ['location', 'headquarter_city'],
    'LinkedIn URL': ['linkedin_url'],
    'Description': ['description'],
    'Annual Revenue': ['annual_revenue', 'funding_total'],
    // People — Clay {first_name, last_name, full_name, job_title};
    // AI Ark {first_name, last_name, full_name, title}
    'First Name': ['first_name'],
    'Last Name': ['last_name'],
    'Full Name': ['full_name'],
    'Job Title': ['title', 'job_title', 'headline'],
    'Company Domain': ['company_domain', 'domain'],
  };

  const keys = map[colName] || [colName.toLowerCase().replace(/\s+/g, '_')];
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return String(record[key]);
    }
  }
  return null;
}
