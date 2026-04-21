import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import type { CampaignStep, CampaignContext, CellValue } from '@/lib/db/schema';
import { searchPeople, searchCompanies } from '@/lib/clay-api';
import type { ClaySearchFilters, ClayCompanySearchFilters } from '@/lib/clay-api';

// Standard column sets for auto-creating sheets
const COMPANY_COLUMNS = ['Company Name', 'Domain', 'Size', 'Industry', 'Country', 'Location', 'LinkedIn URL', 'Description', 'Annual Revenue'];
const PEOPLE_COLUMNS = ['First Name', 'Last Name', 'Full Name', 'Job Title', 'Company Domain', 'Location', 'LinkedIn URL'];

type StepResult = { result: Record<string, unknown>; contextUpdate: Partial<CampaignContext> };

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
      const filters = (step.params.filters || {}) as ClayCompanySearchFilters;
      log(`Searching companies with filters: ${JSON.stringify(filters)}`);
      const result = await searchCompanies(filters, log);
      log(`Found ${result.totalCount} companies`);
      return {
        result: { totalCount: result.totalCount, mode: result.mode },
        contextUpdate: { searchResults: { ...context.searchResults, companies: result.companies } },
      };
    }

    case 'search_people': {
      const filters = (step.params.filters || {}) as ClaySearchFilters;
      const domains = step.params.domains as string[] | undefined;

      // If domainsFrom is specified, pull domains from a sheet column
      if (step.params.domainsFrom && !domains) {
        const ref = step.params.domainsFrom as string; // e.g. "sheet:Companies:Domain"
        const [, sheetName, colName] = ref.split(':');
        const sheet = context.sheets?.[sheetName];
        if (sheet) {
          const colId = sheet.columnIds[colName];
          if (colId) {
            const rows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sheet.tableId));
            const extractedDomains = rows
              .map(r => (r.data as Record<string, CellValue>)[colId]?.value)
              .filter((v): v is string => typeof v === 'string' && v.length > 0);
            (step.params as Record<string, unknown>).domains = extractedDomains;
            log(`Extracted ${extractedDomains.length} domains from ${sheetName}:${colName}`);
          }
        }
      }

      const finalDomains = (step.params.domains as string[]) || [];
      log(`Searching people (${finalDomains.length} domains, filters: ${JSON.stringify(filters)})`);
      const result = await searchPeople(finalDomains, filters, log);
      log(`Found ${result.totalCount} people`);
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
          if (filter.operator === 'is_empty' && (!val || String(val).trim() === '')) {
            idsToDelete.push(row.id);
            break;
          }
        }
      }

      if (idsToDelete.length > 0) {
        for (let i = 0; i < idsToDelete.length; i += 500) {
          const batch = idsToDelete.slice(i, i + 500);
          await db.delete(schema.rows).where(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (schema.rows.id as any).in(batch)
          );
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
          await db.delete(schema.rows).where(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (schema.rows.id as any).in(batch)
          );
        }
      }

      log(`Cleanup: removed ${idsToDelete.length} rows without email`);
      return { result: { removed: idsToDelete.length, remaining: rows.length - idsToDelete.length }, contextUpdate: {} };
    }

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

// Map a search result record to a column name
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecordToColumn(record: any, colName: string): string | null {
  const map: Record<string, string[]> = {
    'Company Name': ['name', 'company_name'],
    'Domain': ['domain', 'company_domain'],
    'Size': ['size'],
    'Industry': ['industry'],
    'Country': ['country'],
    'Location': ['location'],
    'LinkedIn URL': ['linkedin_url'],
    'Description': ['description'],
    'Annual Revenue': ['annual_revenue'],
    'First Name': ['first_name'],
    'Last Name': ['last_name'],
    'Full Name': ['full_name'],
    'Job Title': ['job_title'],
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
