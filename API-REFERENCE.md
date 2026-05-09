# DataFlow API Reference

**Base URL:** `https://dataflow-pi.vercel.app`
**Auth:** `Authorization: Bearer {DATAFLOW_API_KEY}`

---

## Authentication

All API requests require a Bearer token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://dataflow-pi.vercel.app/api/projects
```

---

## AI Agent Workflow Guide

Step-by-step playbooks for end-to-end campaign execution. Each workflow shows exactly which endpoints to call, in what order, with what data.

### Workflow 1: "Find companies in [location] with [criteria] and get [role] emails"

**Example:** "Build a list of companies in Jakarta with 50+ employees and get me each of their CMOs' emails"

| Step | Action | Endpoint | Key Details |
|------|--------|----------|-------------|
| 1 | Create workbook | `POST /api/projects` | `{"name":"Campaign Name","type":"workbook"}` → save `id` as workbookId |
| 2 | Search companies | `POST /api/add-data/search` | `{"searchType":"companies","filters":{"country_names":["Indonesia"],"locations":["Jakarta"],"minimum_member_count":50,"limit":1000}}` |
| 3 | Create Sheet 1: Companies | `POST /api/tables` | `{"projectId":"WORKBOOK_ID","name":"Companies"}` → save tableId |
| 4 | Add columns | `POST /api/columns` (x N) | Create: Company Name, Domain, Size, Industry, Location, LinkedIn. Save all column IDs |
| 5 | Import company data | `POST /api/rows` | Map search results to column IDs: `{"tableId":"...","rows":[{"COL_ID":{"value":"data"}}]}` |
| 6 | Remove companies without domains | `GET /api/rows?filters=[...]` then `DELETE /api/rows` | Filter: `[{"columnId":"DOMAIN_COL","operator":"is_empty"}]`, delete those rows |
| 7 | Search people (CMOs) | `POST /api/add-data/search` | `{"searchType":"people","domains":["domain1.com",...],"filters":{"job_title_keywords":["CMO","Chief Marketing Officer"],"job_title_mode":"smart","seniority_levels":["c-suite","vp"],"limit_per_company":3}}` |
| 8 | Create Sheet 2: People | `POST /api/tables` | `{"projectId":"WORKBOOK_ID","name":"CMOs"}` |
| 9 | Add columns + import people | `POST /api/columns` + `POST /api/rows` | Columns: Full Name, First Name, Last Name, Job Title, Company Domain, Location, LinkedIn |
| 10 | Lookup company info | `POST /api/lookup/run` | Pull Industry, Size from Companies sheet into People sheet by matching Domain columns |
| 11 | Find emails | `POST /api/find-email/run` | `{"tableId":"PEOPLE_TABLE","rowIds":[...],"inputMode":"full_name","fullNameColumnId":"...","domainColumnId":"..."}` |
| 12 | Clean up | `GET /api/rows?filters=[...]` + `DELETE /api/rows` | Remove rows where Email is empty |
| 13 | (Optional) AI personalization | `POST /api/enrichment/setup-and-run` | Generate personalized intro lines using `{{Full Name}}`, `{{Job Title}}` template vars. ONE call creates the config, the linked enrichment column, and runs it — see §6.1 |
| 14 | Export | `GET /api/export/csv?tableId=...` | Download as CSV or read as JSON via `GET /api/rows` |

### Workflow 2: "Find [role] people in [location] and get their emails"

**Example:** "Find marketing managers in Singapore and get their emails"

Direct people search — no company step needed.

| Step | Action | Endpoint | Key Details |
|------|--------|----------|-------------|
| 1 | Create workbook | `POST /api/projects` | `{"name":"Singapore Marketing Managers","type":"workbook"}` |
| 2 | Search people directly | `POST /api/add-data/search` | Omit `domains` field entirely for cross-company search. `{"searchType":"people","filters":{"job_title_keywords":["Marketing Manager","Head of Marketing"],"job_title_mode":"smart","seniority_levels":["manager","director"],"countries_include":["Singapore"],"limit":500}}` |
| 3 | Create sheet + columns + import | `POST /api/tables` + `POST /api/columns` + `POST /api/rows` | Columns: Full Name, First Name, Last Name, Job Title, Company Domain, Location, LinkedIn. Save column IDs + row IDs |
| 4 | Find emails | `POST /api/find-email/run` | `{"tableId":"...","rowIds":[...],"inputMode":"full_name","fullNameColumnId":"...","domainColumnId":"..."}` |
| 5 | Clean up + export | `GET /api/rows?filters=[...]` + `DELETE /api/rows` + `GET /api/export/csv` | Remove empty email rows, export CSV |

### Workflow 3: "Find companies matching [criteria]"

**Example:** "Find SaaS companies in Germany with 200+ employees"

Company search only — no people, no emails.

| Step | Action | Endpoint | Key Details |
|------|--------|----------|-------------|
| 1 | Create workbook | `POST /api/projects` | `{"name":"German SaaS Companies","type":"workbook"}` |
| 2 | Search companies | `POST /api/add-data/search` | `{"searchType":"companies","filters":{"country_names":["Germany"],"industries":["Software Development"],"semantic_description":"SaaS software as a service","minimum_member_count":200,"limit":1000}}` |
| 3 | Create sheet + columns + import | `POST /api/tables` + `POST /api/columns` + `POST /api/rows` | Columns: Company Name, Domain, Size, Industry, Location, LinkedIn, Description, Revenue |
| 4 | (Optional) AI enrich | `POST /api/enrichment/setup-and-run` | Research competitors, tech stack, recent news, funding. ONE call — see §6.1. Set `webSearchEnabled: true` for current/news data |

### Workflow 4: "I have a list — enrich it and find emails"

**Example:** "Here's my CRM export, fill in missing info and find emails"

| Step | Action | Endpoint | Key Details |
|------|--------|----------|-------------|
| 1 | Create workbook + sheet | `POST /api/projects` + `POST /api/tables` | |
| 2 | Import existing data | `POST /api/import/csv` or `POST /api/rows` | CSV import auto-creates columns from headers |
| 3 | AI enrich missing fields | `POST /api/enrichment/setup-and-run` | Use `onlyEmpty: true` to skip rows with existing data. ONE call — see §6.1 |
| 4 | Find emails for rows missing them | `GET /api/rows?filters=[...]` + `POST /api/find-email/run` | Filter for empty email first, then run finder on those row IDs only |
| 5 | Export | `GET /api/export/csv?tableId=...` | |

### Workflow 5: "Cross-reference list A with list B"

**Example:** "Match these companies with these contacts by domain"

| Step | Action | Endpoint | Key Details |
|------|--------|----------|-------------|
| 1 | Import both datasets | `POST /api/tables` + `POST /api/import/csv` (x2) | Two sheets in the same workbook, each with their own data |
| 2 | Lookup to connect | `POST /api/lookup/run` (x N) | Run once per field to pull. Match by shared key (domain, email, name). Case-insensitive |

### Workflow 6: "Clean and transform my data"

**Example:** "Extract domains from emails, combine first+last name, tag by company size"

| Step | Action | Endpoint | Formula |
|------|--------|----------|---------|
| 1 | Extract domain from email | `POST /api/formula/run` | `{{Email}}?.split("@")[1] \|\| ""` |
| 2 | Combine first + last name | `POST /api/formula/run` | `[{{First Name}}, {{Last Name}}].filter(Boolean).join(" ")` |
| 3 | Clean URLs (strip protocol) | `POST /api/formula/run` | `({{Website}} \|\| "").replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*/,"")` |
| 4 | Conditional tagging | `POST /api/formula/run` | `Number({{Employees}}) > 500 ? "Enterprise" : Number({{Employees}}) > 50 ? "Mid-Market" : "SMB"` |
| 5 | AI-generated formula | `POST /api/formula/generate` | `{"description":"what you want","columns":[{"name":"Col","type":"text","sampleValue":"example"}]}` |

---

## Best Practices & Agent Optimization

### 1. Routing: Which workflow to use

| User says | Use workflow |
|-----------|-------------|
| Companies + people + emails ("Find SaaS companies in Berlin and get their CTOs' emails") | **Workflow 1** (full pipeline) |
| People + emails, no company criteria ("Find marketing managers in Singapore") | **Workflow 2** (people-direct) |
| Companies only ("List fintech companies in London with 100+ employees") | **Workflow 3** (companies only) |
| Has their own data ("Here's my spreadsheet, enrich it") | **Workflow 4** (enrich existing) |
| Two datasets to connect ("Match these companies with these contacts") | **Workflow 5** (cross-reference) |
| Transform/clean data ("Extract domains from emails") | **Workflow 6** (formula) |

Many requests combine workflows. "Find companies in Jakarta, get their CMOs, find emails, write personalized intros" = Workflow 1 + AI enrichment at the end.

### 2. Search Strategy

- **Company search — start specific, then broaden.** Country + industry + size first. If too few results, remove industry or use `semantic_description` (AI-powered fuzzy matching).
- **People search — always include `seniority_levels`.** Without it, you get everyone from interns to CEOs. "Decision-makers" = `["c-suite","vp","director"]`. "Managers" = `["manager","senior"]`. "Everyone" = omit the filter.
- **Job titles — use multiple variations.** "CMO" should search `["Chief Marketing Officer","CMO","VP Marketing","Head of Marketing"]`. Set `job_title_mode: "smart"` for fuzzy matching.
- **People at companies — pass domains, not company names.** The `domains` array scopes search to specific companies. Without it = cross-company search.
- **`limit_per_company` prevents domination.** If one company has 500 engineers and another has 5, set `limit_per_company: 10` to balance.
- **Company sizes use comma format.** Always `"501-1,000"` not `"501-1000"`. Valid: `"1"`, `"2-10"`, `"11-50"`, `"51-200"`, `"201-500"`, `"501-1,000"`, `"1,001-5,000"`, `"5,001-10,000"`, `"10,001+"`.
- **For "50+ employees", use `minimum_member_count: 50`** instead of listing every size range.

### 3. Data Quality

- **Re-fetch column IDs for each sheet.** Column IDs do not transfer between sheets. When working across multiple sheets in the same workbook (e.g. Segment 1 / Segment 2 / Segment 3), call `GET /api/columns?tableId=...` *per sheet* and use that sheet's IDs in filter, lookup, find-email, and enrichment requests. Reusing a column ID from a different sheet now returns `400 invalidColumnIds` (was: silently matched every row).
- **Always filter out rows with empty domains before Find Email.** Email finding requires a domain. Rows without one always fail.
- **Clean domains before use.** Must be bare: `stripe.com` not `https://www.stripe.com/about`. Use Formula to strip protocol/www/paths.
- **Deduplicate before expensive operations.** Check for duplicate domains/names before running Find Email or AI Enrichment.
- **After email finding, always clean up.** Filter `is_empty` on Email column and delete those rows.
- **Validate data at each stage.** After company search: check domain coverage. After people search: verify results for most domains. After email finding: check foundCount vs processedCount.

### 4. Tool Selection

| Tool | Use when | Do NOT use when |
|------|----------|-----------------|
| **Add Data (Clay)** | Finding new companies or people | You already have the data |
| **Find Email** | You have name + company domain | No domain available |
| **Lookup** | Connecting data between sheets via shared key | Need to search for new data |
| **AI Enrichment** | Generating new insights (research, personalization). **Use `POST /api/enrichment/setup-and-run` (§6.1)** — single canonical call. | Data exists somewhere — try Lookup or Clay first |
| **AI Enrichment + Web Search** | Set `webSearchEnabled: true` on `setup-and-run` when the prompt needs **live web data** (current news, websites, recent events, anything past the model's training cutoff). Model is forced to call `search_web` before answering. | Pure transformations or reasoning over the row — the extra Spider cost is wasted |
| **Batch Enrichment** | 1000+ rows of AI enrichment (cheaper, 1-24hr). Requires an **existing** config — create one first via `setup-and-run` on a sample row, then `POST /api/enrichment/batch` with that `configId`. | Under 1000 rows — use real-time. **Not compatible with web search** — returns 400 if `webSearchEnabled: true` |
| **Formula** | Data transformations (split, combine, clean) | Need external data or AI reasoning |
| **Filters** | Narrowing rows: empty cells, value matching | Need to modify data — use PATCH |

### 5. Operation Order

1. **Always:** workbook → sheet → columns → rows (each step needs the ID from the previous)
2. **Search BEFORE creating sheets.** Run Clay search first, then create columns based on returned fields.
3. **Import data BEFORE running Find Email or Enrichment.** These operate on row IDs — rows must exist.
4. **Lookup requires both sheets to have data.** Import source sheet fully first.
5. **Clean data BETWEEN steps.** Remove bad rows after company import (no domain), after people import (no name), after email finding (no email).
6. **AI Enrichment and Formula can run at any time** after rows exist.

### 6. Performance & Timing

| Operation | Speed | Notes |
|-----------|-------|-------|
| Company/People search | 30s-5min | 100-1000 results in 30s-2min. 10k+ in ~4-5min. Max 25,000 |
| Find Email | ~12/sec | 2 concurrent, 100ms delay. 100 rows ≈ 8s. 500 ≈ 40s. 5000 ≈ 7min |
| Real-time Enrichment | 50-200/min | gpt-5-nano ~200/min, gpt-5-mini ~100/min, gpt-4o ~50/min |
| Batch Enrichment | 1-24 hours | 50% cheaper than real-time. Use for 1000+ rows |
| Formula | Instant | 10,000 rows in <2 seconds |
| Lookup | Instant | In-memory hash map. 100,000 lookups in <1 second |

**Monitoring:** For operations >100 rows, poll `GET /api/jobs/status` every 10-30s. Cell-level detail via `GET /api/columns/{id}/progress`.

### 7. Cost Optimization

- **Use Formula instead of AI when possible.** Extract domains, combine names, clean URLs = free.
- **Use gpt-5-nano for simple extractions.** Cheapest model. gpt-5-mini for moderate reasoning. gpt-4o only for complex research.
- **Use Batch Enrichment for large jobs.** 50% cheaper. `POST /api/enrichment/batch` for 1000+ rows.
- **Filter before enriching.** Remove irrelevant rows BEFORE AI enrichment. Every row costs tokens.
- **Use `onlyEmpty: true` when re-running.** Skips rows with existing data.
- **Monitor costs in real-time.** `GET /api/jobs/status` returns `cost.totalSoFar` and `cost.estimatedTotal`. Cancel expensive jobs: `DELETE /api/enrichment/jobs?jobId=...`

### 8. Naming Conventions

- **Workbooks:** Describe the campaign. "Jakarta CMO Campaign", "Series A SaaS Companies Q2"
- **Sheets:** Describe the data type. "Companies", "People", "CMOs", "Enriched Leads"
- **Columns:** Clear and specific. "Company Name" not "name". "Company Domain" not "domain"
- **Standard company columns:** Company Name, Domain, Size, Industry, Country, Location, LinkedIn URL, Description, Annual Revenue
- **Standard people columns:** First Name, Last Name, Full Name, Job Title, Company Domain, Location, LinkedIn URL, Email, Email Status

### 9. Error Handling

| Problem | Solution |
|---------|----------|
| `400 invalidColumnIds` on `GET /api/rows` | Filter or `sortBy` referenced a column ID from a different sheet. Refetch `GET /api/columns?tableId={this-sheet}` and use IDs from there. |
| Search returns 0 results | Broaden filters. Remove most restrictive filter. Try `semantic_description` instead |
| Email finder low success (<50%) | Common for small/local companies. Try AI enrichment to find emails from LinkedIn |
| AI enrichment errors | Check `GET /api/columns/{id}/progress` for error samples. Common: vague prompt, column typo. Retry: `POST /api/enrichment/retry-cell` |
| Lookup many unmatched rows | Check matching column format. "www.stripe.com" vs "stripe.com" — clean domains with Formula first |
| Job appears stuck | Check `GET /api/jobs/status`. No progress for 5+ min → cancel and restart |
| 500 errors | Check `GET /api/stats` for storage (9GB max). Delete old data if near capacity |

### Data Flow Patterns

```
FULL PIPELINE (Workflow 1):
Workbook
  +-- Sheet: Companies
  |     Clay search → Import → Filter (remove no-domain)
  +-- Sheet: People
        Clay search (at domains) → Import
        ← Lookup (company data from Sheet 1)
        → Find Email → Filter (remove no-email)
        → AI Enrich (optional) → Export

PEOPLE DIRECT (Workflow 2):
Workbook
  +-- Sheet: People
        Clay search (no domains) → Import
        → Find Email → Filter → Export

COMPANIES ONLY (Workflow 3):
Workbook
  +-- Sheet: Companies
        Clay search → Import → (Optional: AI Enrich) → Export

ENRICH EXISTING (Workflow 4):
Workbook
  +-- Sheet: Imported Data
        CSV Import / API Import
        → AI Enrich (fill gaps)
        → Find Email (missing emails)
        → Export

CROSS-REFERENCE (Workflow 5):
Workbook
  +-- Sheet A: Dataset 1
  +-- Sheet B: Dataset 2
        ← Lookup (pull fields from Sheet A by shared key)

DATA CLEANING (Workflow 6):
Any Sheet:
  Formula: extract, combine, clean, convert, tag
```

---

## 1. Folders & Workbooks

### List All Projects
```
GET /api/projects
```
Returns all folders and workbooks in a tree structure with their sheets.

**Response:** Array of projects with `children[]` and `tables[]` nested.

### Create Folder or Workbook
```
POST /api/projects
```
```json
{
  "name": "My Folder",
  "type": "folder",
  "parentId": null
}
```
Types: `folder`, `workbook`, `table`

### Get Project Details
```
GET /api/projects/{id}
```
Returns project with its `tables[]` (sheets).

### Update Project
```
PATCH /api/projects/{id}
```
```json
{"name": "New Name", "parentId": "folder-id-or-null"}
```

### Delete Project
```
DELETE /api/projects/{id}
```
Cascading delete — removes all child projects and tables.

---

## 2. Sheets (Tables)

### List Sheets in Workbook
```
GET /api/tables?projectId={workbookId}
```

### Create Sheet
```
POST /api/tables
```
```json
{
  "projectId": "workbook-id",
  "name": "Companies"
}
```

### Get Sheet with Columns
```
GET /api/tables/{id}
```
Returns table metadata + ordered `columns[]`.

### Update Sheet
```
PATCH /api/tables/{id}
```
```json
{"name": "New Name", "projectId": "move-to-workbook-id"}
```

### Delete Sheet
```
DELETE /api/tables/{id}
```
Cascading — deletes columns, rows, enrichment jobs.

---

## 3. Columns

> **Column IDs are scoped per-table.** Two sheets with identically named columns ("Domain", "Company Name") have *different* column IDs. Always call `GET /api/columns?tableId={tableId}` for the specific sheet you are filtering, sorting, importing into, or running enrichment on. Do not reuse a column ID across sheets, even within the same workbook — the API will reject foreign IDs with `400 invalidColumnIds` (see §4 filter validation).

### List Columns
```
GET /api/columns?tableId={tableId}
```
Returns columns ordered by `order` field.

### Create Column
```
POST /api/columns
```
```json
{
  "tableId": "table-id",
  "name": "Company Name",
  "type": "text"
}
```
Types: `text`, `number`, `email`, `url`, `date`, `enrichment`, `formula`
Default width: 150, auto-increments order.

### Update Column
```
PATCH /api/columns/{id}
```
```json
{"name": "New Name", "type": "number", "width": 200}
```

### Delete Column
```
DELETE /api/columns/{id}
```

---

## 4. Rows

### List Rows (with Sort, Filter, Pagination)
```
GET /api/rows?tableId={tableId}&limit=1000&offset=0
```
Optional query parameters:
- `rowIds` — comma-separated IDs for specific rows
- `sortBy` — column ID to sort by
- `sortOrder` — `asc` (default) or `desc`
- `filters` — URL-encoded JSON array of filter objects
- `filterLogic` — `AND` (default) or `OR`
- `limit` — max rows returned (default: 100000)
- `offset` — rows to skip (default: 0)

**Response headers:** `X-Total-Count`, `X-Filtered-Count`

**Filter object format:**
```json
[{"columnId": "col-id", "operator": "contains", "value": "stripe"}]
```

> **Validation.** `GET /api/rows` returns `400 {error, invalidColumnIds, tableId}` if any `filter.columnId` (or `sortBy`) is not a column of the requested `tableId`. Each sheet has its own column IDs — refetch `GET /api/columns?tableId=...` per sheet. (Older clients may have observed "every row matches" instead of an error; that was a silent bug, fixed 2026-04-30.)

**Filter operators:**
| Operator | Description | Value |
|----------|------------|-------|
| `equals` | Exact match (case-insensitive) | string |
| `not_equals` | Not equal | string |
| `contains` | Contains substring | string |
| `not_contains` | Does not contain | string |
| `is_empty` | Cell is empty/null | — |
| `is_not_empty` | Cell has value | — |
| `starts_with` | Starts with | string |
| `ends_with` | Ends with | string |
| `greater_than` | Greater than (numeric) | number |
| `less_than` | Less than (numeric) | number |
| `between` | Between range (numeric) | [min, max] |

**Example with sort + filter + pagination:**
```
GET /api/rows?tableId=X&filters=[{"columnId":"col-1","operator":"contains","value":"stripe"}]&filterLogic=AND&sortBy=col-2&sortOrder=desc&limit=50&offset=0
```

**Cell data structure:**
```json
{
  "columnId": {
    "value": "string or number",
    "status": "complete",
    "enrichmentData": {},
    "metadata": {}
  }
}
```

### Create Rows (Bulk)
```
POST /api/rows
```
```json
{
  "tableId": "table-id",
  "rows": [
    {"col-id-1": {"value": "Stripe"}, "col-id-2": {"value": "stripe.com"}},
    {"col-id-1": {"value": "Shopify"}, "col-id-2": {"value": "shopify.com"}}
  ]
}
```

### Update Row
```
PATCH /api/rows/{id}
```
```json
{
  "data": {
    "col-id-1": {"value": "Updated Value"}
  }
}
```
Merges with existing data (doesn't replace other columns).

### Delete Rows (Bulk)
```
DELETE /api/rows
```
```json
{"ids": ["row-id-1", "row-id-2"], "tableId": "table-id"}
```

### Delete Single Row
```
DELETE /api/rows/{id}
```

### Bulk Update Rows
```
PATCH /api/rows
```
```json
{
  "updates": [
    {"id": "row-1", "data": {"col-id": {"value": "New Value"}}},
    {"id": "row-2", "data": {"col-id": {"value": "Other"}}}
  ]
}
```

---

## 5. Import & Export

### Import CSV
```
POST /api/import/csv
```
```json
{
  "tableId": "table-id",
  "data": [
    {"Name": "John", "Email": "john@example.com"},
    {"Name": "Jane", "Email": "jane@example.com"}
  ],
  "columnMapping": {
    "Name": {"targetColumnId": "existing-col-id"},
    "Email": {"newColumnName": "Email Address"}
  }
}
```
Auto-infers column types. Creates columns if needed.

### Export CSV
```
POST /api/export/csv
```
```json
{"tableId": "table-id"}
```
Returns CSV content with `Content-Type: text/csv`.

---

## 6. AI Enrichment

> **🟢 CANONICAL FLOW — agents using this API to add an AI enrichment to a table MUST use `POST /api/enrichment/setup-and-run` (§6.1).** The legacy granular endpoints (§6.3) are retained for editing or rerunning *existing* configs only. Read §6.2 for the failure modes that arise from reaching for the wrong endpoint.

### 6.1. Canonical Flow — Setup & Run (USE THIS)

```
POST /api/enrichment/setup-and-run
```

One atomic call that mirrors what happens when a user clicks "Run" in the EnrichmentPanel UI:

1. Inserts an `enrichment_configs` row with your model/prompt/outputColumns/temperature/webSearchEnabled.
2. Creates a column with `type: "enrichment"` and `enrichmentConfigId` linked to the new config — this is what makes the UI recognize the column (cell click → inspector modal, column header → run-button dropdown, "Extract to column" affordance).
3. Runs the enrichment over the requested rows using the same prompt builder, tool-calling loop, and metadata persistence as a UI run.

**Request body:**
```json
{
  "tableId": "table-id",
  "columnName": "Latest News",
  "prompt": "Search the web for the most recent news (last 30 days) about {{Company}}. Return the EXACT headline and EXACT source URL.",
  "model": "gpt-5-mini",
  "inputColumns": ["col-id-of-Company"],
  "outputColumns": ["headline", "source_url"],
  "temperature": 0.1,
  "webSearchEnabled": true,
  "rowIds": ["row-1", "row-2"]
}
```

**Required fields:** `tableId`, `columnName`, `prompt`, `inputColumns` (non-empty array).

**Optional fields (with defaults):**
- `model` — default `"gpt-5-mini"`. Any model from §"Cost Optimization" table.
- `outputColumns` — default `[]`. Use a list of keys (e.g. `["headline","source_url"]`) for structured output. Each key auto-creates a sibling text column populated from the model's JSON.
- `temperature` — default `0.7`. Use `0.1-0.3` for factual lookups.
- `webSearchEnabled` — default `false`. Set `true` when the prompt needs live web data (see §6.4).
- `webSearchProvider` — default `"spider"` (only Spider.Cloud is honored at runtime).
- `costLimitEnabled` / `maxCostPerRow` — per-row cost cap (covers model tokens + Spider credits).
- `rowIds` — array of row IDs to enrich. If omitted, runs on **all rows** in the table.
- `onlyEmpty` — default `false`. Skip rows where the target cell is already non-empty.
- `forceRerun` — default `false`. When `true`, re-runs even already-populated rows.

**Response (201 Created):**
```json
{
  "configId": "...",
  "targetColumnId": "...",
  "targetColumn": { "id": "...", "name": "Latest News", "type": "enrichment", "enrichmentConfigId": "...", "..." },
  "results": [
    {
      "rowId": "...",
      "success": true,
      "data": { /* full updated row.data — every cell incl. the new enrichment cell */ },
      "cost": 0.0048
    }
  ],
  "totalCost": 0.0048,
  "processedCount": 1,
  "successCount": 1,
  "errorCount": 0,
  "newColumns": [ /* any output-column siblings auto-created from outputColumns[] */ ]
}
```

The cell is populated with `enrichmentData` (the parsed JSON), `rawResponse`, and full `metadata` (tokens, time, cost, plus `webSearchCalls` and `webSearchCost` when web search was on). Same shape as a UI run.

**Worked example — find a recent news headline with web search:**
```bash
curl -X POST https://dataflow-pi.vercel.app/api/enrichment/setup-and-run \
  -H "Authorization: Bearer $DATAFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableId": "TABLE_ID",
    "columnName": "Recent News",
    "prompt": "Search the web for one news article (last 30 days) about {{Company}}. Return EXACT headline + EXACT URL. Do not paraphrase. If none found, return empty strings.",
    "model": "gpt-5-mini",
    "inputColumns": ["COMPANY_COL_ID"],
    "outputColumns": ["headline", "source_url"],
    "temperature": 0.1,
    "webSearchEnabled": true,
    "rowIds": ["ROW_ID"]
  }'
```

After this returns, opening the table in the UI shows the new column with a working run-button dropdown and a clickable cell that opens the inspector modal — same as if a user had configured it in the EnrichmentPanel.

### 6.2. Anti-patterns (DO NOT)

These are common mistakes when an agent skips `setup-and-run` and tries to assemble the flow manually. Each one produces broken UI state:

- **DO NOT call `POST /api/enrichment/run` against a `text` column.** The cell will populate but the UI inspector won't open and the column header won't show the run-button dropdown — the column-to-config link is missing. Use `setup-and-run` instead.
- **DO NOT call `POST /api/columns` with `type: "enrichment"` and forget `enrichmentConfigId`.** Same outcome — orphaned column. There's a fallback in the EnrichmentPanel that searches by name, but it's brittle and will not find a config you skipped creating.
- **DO NOT call Azure OpenAI / OpenAI / any LLM directly from your client and write the result to a plain cell.** Cost won't be tracked, no `metadata` will be persisted, and the result won't be re-runnable. Always go through `setup-and-run` (or `/run` for an existing config) so the unified prompt builder, tool-calling loop, and metadata layer apply.
- **DO NOT skip `outputColumns` for multi-datapoint results.** Without it, the model returns one blob and the "Extract to column" affordance has nothing structured to extract. If the user wants headline + URL + summary, declare them as `outputColumns: ["headline","url","summary"]` and the runner auto-creates sibling columns populated per-cell.
- **DO NOT use `POST /api/formula/...` for AI work.** Formulas are for deterministic transformations (split, combine, regex). For anything that needs reasoning or live data, use `setup-and-run`.
- **DO NOT toggle `webSearchEnabled: true` on `POST /api/enrichment/batch`** — batch returns 400 with that combination. Web search is real-time only. For >1000 rows that need web search, run `setup-and-run` in chunks.
- **DO NOT enable web search for tasks the model already knows from training** (extract domain from email, classify text, transform formats). Spider charges credits per call — wasted spend.

### 6.3. Lower-level endpoints (for editing existing configs)

These are the granular endpoints. Use them when iterating on or rerunning an *existing* enrichment — not for creating a new one (use §6.1).

#### List All Enrichment Configs
```
GET /api/enrichment
```
Returns array of all enrichment configurations.

### Create Enrichment Config
```
POST /api/enrichment
```
```json
{
  "name": "Company Research",
  "model": "gpt-5-mini",
  "prompt": "Research {{Company Name}} and return their industry and funding.",
  "inputColumns": ["col-id-company-name"],
  "outputColumns": ["industry", "funding"],
  "outputFormat": "json",
  "temperature": 0.7,
  "webSearchEnabled": false,
  "webSearchProvider": "spider"
}
```

**Web search fields (optional, default OFF):**
- `webSearchEnabled` (boolean, default `false`) — when `true`, the model gets `search_web` + `scrape_url` tools backed by Spider.Cloud and is **forced** to call a tool on the first round (`tool_choice: "required"`). Use this when the prompt asks for current data, recent news, websites, or anything past the model's training cutoff. See "AI Enrichment with Web Search" below.
- `webSearchProvider` (string, default `"spider"`) — only `"spider"` is honored at runtime. Reserved for future providers.

### Get / Update Enrichment Config
```
GET    /api/enrichment/{id}
PATCH  /api/enrichment/{id}
```
PATCH accepts any subset of the POST fields, including `webSearchEnabled` / `webSearchProvider`. Toggling `webSearchEnabled` on an existing config takes effect on the next `/run` call.

### Delete Enrichment Config
```
DELETE /api/enrichment/{id}
```

### Run Enrichment (Synchronous)
```
POST /api/enrichment/run
```
```json
{
  "configId": "config-id",
  "tableId": "table-id",
  "targetColumnId": "output-col-id",
  "rowIds": ["row-1", "row-2", "row-3"]
}
```
Processes rows immediately. Returns results with cost/token metadata.

### Submit Batch Enrichment (Async, Azure)
```
POST /api/enrichment/batch
```
```json
{
  "configId": "config-id",
  "tableId": "table-id",
  "targetColumnId": "output-col-id",
  "model": "gpt-4.1-mini"
}
```
Submits to Azure Batch API. Takes 1-24 hours. Up to 100k rows.

**Returns 400 if the config has `webSearchEnabled: true`** — web search is real-time only. For configs that need web search, use `POST /api/enrichment/setup-and-run` (§6.1) for a new enrichment, or `POST /api/enrichment/run` against an existing one.

### Check Batch Status
```
GET /api/enrichment/batch/status?tableId={tableId}
GET /api/enrichment/batch/status?jobId={jobId}
```

### Cancel Batch
```
DELETE /api/enrichment/batch/cancel?columnId={columnId}
```

### Retry Single Cell
```
POST /api/enrichment/retry-cell
```
```json
{"rowId": "row-id", "columnId": "col-id", "tableId": "table-id"}
```

### Optimize Prompt with AI
```
POST /api/enrichment/optimize-prompt
```
```json
{
  "prompt": "Research this company",
  "columns": [{"name": "Company", "type": "text", "sampleValue": "Stripe"}]
}
```

### Extract Datapoint to New Column
```
POST /api/enrichment/extract-datapoint
```
```json
{"tableId": "table-id", "sourceColumnId": "enrichment-col-id", "dataKey": "industry"}
```

### List Enrichment Jobs
```
GET /api/enrichment/jobs?columnId={columnId}
```

### Create Background Enrichment Job
```
POST /api/enrichment/jobs
```
```json
{
  "configId": "config-id",
  "tableId": "table-id",
  "targetColumnId": "col-id",
  "rowIds": ["row-1", "row-2"]
}
```
Creates an asynchronous enrichment job. Returns `{jobId, status}`.

### Cancel Enrichment Jobs
```
DELETE /api/enrichment/jobs
```
Query params (one of):
- `?jobId={id}` — Cancel specific job
- `?columnId={id}` — Cancel all jobs for column
- `?all=true` — Cancel all active jobs
- `?resetStuck=true` — Reset stuck processing cells

### 6.4. AI Enrichment with Web Search (Spider.Cloud)

Set `webSearchEnabled: true` on `POST /api/enrichment/setup-and-run` (§6.1) — or PATCH it on an existing config — to give the model two tools during real-time enrichment:

| Tool | Purpose | Cost (Spider credits) |
|---|---|---|
| `search_web(query, limit?)` | Search the live web. `limit` 1-10, default 3. | ~1 credit per result returned |
| `scrape_url(url)` | Fetch one URL as markdown. | ~5-20 credits per page |

**Behavior at runtime:**
- The model is **forced** to call a tool on the first round (`tool_choice: "required"`). It cannot answer purely from training data.
- Hard cap: **3 tool-call rounds** per row. Per-row hard timeout: 90s (vs 30s without tools).
- Spider credit cost is converted to USD ($0.0001/credit) and added to `metadata.totalCost`. The existing per-row cost cap (`costLimitEnabled` + `maxCostPerRow`) covers both model tokens and Spider spend.
- All Azure-OpenAI models supported, including `gpt-5-mini` (Responses API path) and `gpt-5-nano` (separate Azure resource).
- **Batch enrichment is NOT supported** — `POST /api/enrichment/batch` returns 400 when the config has web search on.

**Cell metadata gains two fields:**
```json
"metadata": {
  "inputTokens": 7388,
  "outputTokens": 1714,
  "timeTakenMs": 71000,
  "totalCost": 0.00477,
  "webSearchCalls": 3,
  "webSearchCost": 0.0005
}
```

**When to enable** — turn ON for prompts that need:
- Current news / events / press / press-releases (anything within the model's last few months of cutoff or after).
- Live websites, domains, contact info.
- Real-time prices, stock quotes, status pages.
- Verification of facts the user wants grounded in citations.

**When to leave OFF** — turn OFF for:
- Pure transformation (extract domain from email, parse, classify).
- Reasoning over data already in the row.
- Anything where the answer is in the model's training data and no citation is required.

**Prompt-design tips when web search is ON:**
- Be explicit: "Search the web…" or "Use search_web to…". The model already has a system hint forcing one search, but a clear prompt narrows it.
- Specify what to return verbatim: "Return the EXACT headline and EXACT URL. Do not paraphrase." This anchors the answer to actual results.
- Lower `temperature` (0.1-0.3) for factual lookups. Helps the model commit to one search rather than re-searching.
- Use the Data Guide (`outputColumns`) — structured outputs (e.g. `["headline", "source_url"]`) keep the model focused.

**Cost guidance** (verified live):
| Task | Tool calls | Total cost/row | Wall time |
|---|---|---|---|
| "Find the official website of {{Company}}" | 1 | ~$0.0014 | ~24s |
| "Find a recent news headline about {{Topic}}" | 2-3 | ~$0.005 | ~70s |
| "Research and summarize {{Company}} (last 30 days)" | 3 (cap) | ~$0.008 | ~80s |

**Negative control** — when `webSearchEnabled: false`, `webSearchCalls` is `0` (or absent) and the model self-reports inability to fetch live data rather than hallucinating.

**Example end-to-end** — see §6.1 for the canonical `setup-and-run` worked example. `webSearchCalls > 0` in the per-cell metadata confirms a real fetch (not a training-data answer).

---

## 7. Formula

### List All Formula Configs
```
GET /api/formula
```

### Create Formula Config
```
POST /api/formula
```
```json
{"name": "Full Name", "formula": "[{{First Name}}, {{Last Name}}].filter(Boolean).join(' ')"}
```
Supports `{{Column Name}}` references, JavaScript expressions, lodash (`_`), FormulaJS functions.

### Get Formula Config
```
GET /api/formula/{id}
```

### Update Formula Config
```
PATCH /api/formula/{id}
```
```json
{"name": "Updated Name", "formula": "new expression"}
```

### Delete Formula Config
```
DELETE /api/formula/{id}
```

### Run Formula
```
POST /api/formula/run
```
```json
{
  "tableId": "table-id",
  "formula": "{{First Name}} + ' ' + {{Last Name}}",
  "outputColumnName": "Full Name"
}
```

### Re-run Formula
```
POST /api/formula/rerun
```
```json
{"columnId": "formula-col-id", "formula": "updated expression"}
```

### AI Generate Formula
```
POST /api/formula/generate
```
```json
{
  "description": "Extract domain from email address",
  "columns": [{"name": "Email", "type": "email", "sampleValue": "john@stripe.com"}]
}
```

### Check Formula Progress
```
GET /api/formula/run?jobId={jobId}
```

### Check Re-run Progress
```
GET /api/formula/rerun?jobId={jobId}
```
Same response format as `GET /api/formula/run?jobId=`.

---

## 8. Find Email

Three providers, all sharing the same request shape. Each writes the resolved email into a single **result column** (an `enrichment`-typed column) — `cell.value` is the address, and the full provider response (status, confidence, source, provider name, etc.) lives in `cell.enrichmentData`. The cell shows status badges; clicking it opens the data viewer the manual UI uses.

If you want a clean plain-text Email column for downstream consumption, create that text column separately and copy `cell.value` from each result-column cell. (`find_emails_waterfall` in the campaign engine does this automatically — see §11.)

| Provider | Endpoint | Mode | Notes |
|----------|----------|------|-------|
| Ninjer | `POST /api/find-email/run` | sync | Original provider, 90s/row worst case |
| TryKitt | `POST /api/find-email/trykitt` | sync | Realtime mode |
| AI Ark | `POST /api/find-email/ai-ark` | **async via webhook** | Returns immediately; emails arrive 1-2 min later |

### Common request body
```json
{
  "tableId": "table-id",
  "rowIds": ["row-1", "row-2"],
  "inputMode": "full_name",
  "fullNameColumnId": "name-col-id",
  "firstNameColumnId": "first-col-id",
  "lastNameColumnId": "last-col-id",
  "domainColumnId": "domain-col-id",
  "resultColumnId": "result-enrichment-col-id"
}
```
`inputMode` is `"full_name"` or `"first_last"`. Provide `fullNameColumnId` for the first, or `firstNameColumnId` + `lastNameColumnId` for the second. `domainColumnId` is required either way. `resultColumnId` must be an `enrichment`-typed column — create one via `POST /api/columns` with `{ "tableId": "...", "name": "Email (AI)", "type": "enrichment", "actionKind": "find_email_<provider>", "actionConfig": { /* the input column ids */ } }` first.

### Common response shape
```json
{
  "results": [{"rowId": "...", "success": true, "email": "...", "status": "found", "enrichmentData": {"...": "..."}}],
  "processedCount": 2,
  "foundCount": 1,
  "errorCount": 0
}
```
Status strings: `found`, `not_found`, `catch_all` (Ninjer), `skipped` (missing inputs), `error`. AI Ark adds `submitted` (cell stays in `processing` status) and writes the final `VALID`/`INVALID`/`CATCH_ALL` into `enrichmentData.status` once its webhook fires (see below).

---

### Provider 1: Ninjer

```
POST /api/find-email/run
```
2 concurrent requests, 100ms delay between batches. 90s timeout per row. Returns when every row has a final result.

### Provider 2: TryKitt

```
POST /api/find-email/trykitt
```
Same request body. Same concurrency/timeout. Uses TryKitt's `realtime: true` mode under the hood, so each call blocks until the result is available.

### Provider 3: AI Ark (async)

```
POST /api/find-email/ai-ark
```

AI Ark email-finding is webhook-based. The endpoint does **two** AI Ark calls per row:

1. `POST /people` — search filtered by full name + domain to grab a `personId` and the response's `trackId`.
2. `POST /people/email-finder` — submit `{ webhook, trackId, ids:[personId] }` so AI Ark will POST results back later.

The `trackId` expires within minutes of the search, so search and email-finder must happen back-to-back. Best-match selection prefers an exact (case-insensitive) full-name match in the search results, falling back to the first result.

**Per-row outcomes:**
- `submitted` — queued at AI Ark; cell flips to `status: "processing"`, value `submitted`. Real result arrives via webhook.
- `not_found` — AI Ark search returned 0 matches for this name+domain; no email-finder call made.
- `skipped` — name or domain cell was empty.
- `error` — search or submission failed; details logged as `[ai-ark] Row X failed: ...`.

**Response shape (note `async: true` and that `foundCount` is always 0 — true count is unknown until the webhook fires):**
```json
{
  "results": [{"rowId": "...", "success": true, "email": null, "status": "submitted"}],
  "processedCount": 1,
  "foundCount": 0,
  "submittedCount": 1,
  "notFoundCount": 0,
  "skippedCount": 0,
  "errorCount": 0,
  "async": true,
  "message": "1 email(s) submitted to AI Ark — results arrive in 1-2 minutes via webhook."
}
```

**Configuration (env vars):**
- `AI_ARC_API_KEY` — AI Ark developer-portal token (sent as `X-TOKEN` header).
- `CRON_SECRET` — HMAC key used to sign webhook URLs. Already used by other features.
- `PUBLIC_BASE_URL` — public HTTPS origin AI Ark can reach (e.g. `https://dataflow-pi.vercel.app`). Required when running behind a reverse proxy (Vercel→ACA), because `request.nextUrl.origin` inside the proxied container is the internal URL and AI Ark rejects it as `webhook is invalid`. Falls back to `request.nextUrl.origin` when unset.

#### The webhook callback (AI Ark calls this; you don't)

```
POST /api/find-email/ai-ark/webhook?tableId=...&rowId=...&resultColId=...&token=...
```

- The query string carries the cell coordinates plus an HMAC token computed as `HMAC-SHA256(tableId:rowId:resultColId, CRON_SECRET)`. The handler verifies the token before writing — anyone can hit the URL but only AI Ark (or whoever holds `CRON_SECRET`) can land an email in a cell.
- For backward-compatibility with in-flight submissions made before the result-column refactor, the webhook also accepts the legacy `emailColId` + `statusColId` query params with their 4-part HMAC payload (`tableId:rowId:emailColId:statusColId`). New submissions all use the 3-part shape above.
- The path is exempt from the bearer-auth middleware (AI Ark doesn't have your `DATAFLOW_API_KEY`); HMAC verification replaces it.
- Always returns `200 {"ok": true}` even on parse errors so AI Ark doesn't retry forever. Failures are logged as `[ai-ark webhook] ...`.
- `GET` returns a small JSON health probe.

**AI Ark webhook payload shape (verified live):**
```json
{
  "trackId": "879e3ec0-...",
  "state": "DONE",
  "statistics": {"found": 1, "total": 1},
  "data": [
    {
      "input": {"domain": "airbnb.com", "firstname": "Brian", "lastname": "Chesky"},
      "output": [
        {
          "address": "brian.chesky@airbnb.com",
          "status": "VALID",
          "domainType": "CATCH_ALL",
          "found": true,
          "free": true,
          "generic": false,
          "mx": {"found": true, "provider": "g-suite", "record": "aspmx.l.google.com"},
          "subStatus": "EMPTY"
        }
      ],
      "refId": "...",
      "state": "DONE"
    }
  ]
}
```

The handler walks `data[].output[]` and writes the first `address` into the result column's `cell.value` and `cell.enrichmentData.email`. The corresponding `status` (`VALID`, `INVALID`, `CATCH_ALL`, etc.) lands in `cell.enrichmentData.status`, with `cell.enrichmentData.provider = "ai_ark"`. The cell's `status` flips from `processing` to `complete` (a real address was returned) or stays empty with `enrichmentData.status = "not_found"` if none was. Any prior `enrichmentData.track_id` / `person_id` set at submission time are preserved.

The `Email (AI)` cell is the result column the user clicks to inspect. Downstream campaign steps (and `materialize_send_ready`) read the *clean* `Email` text column — `find_emails_waterfall` copies `cell.value` from the result column into that text column after each pass. See §11 (`find_emails_waterfall`) for the full result-column + clean-text-column pattern.

#### End-to-end timing

- Submission → returns within a few seconds per row (rate-limited by AI Ark to 5 req/s).
- Webhook callback → typically 60-90 seconds after submission, can be longer under load.
- `foundCount` in the synchronous response is always 0 — poll `GET /api/rows` or refresh the UI to see the final emails.

#### Cost

Two AI Ark API calls per row (one search + one email-finder submit). The webhook callback itself is free. AI Ark credits — check `GET https://api.ai-ark.com/api/developer-portal/v1/payments/credits` (sent as `X-TOKEN: $AI_ARC_API_KEY`) for the live balance.

---

## 9. Look Up (Cross-Sheet VLOOKUP)

### Run Lookup
```
POST /api/lookup/run
```
```json
{
  "tableId": "people-sheet-id",
  "sourceTableId": "companies-sheet-id",
  "inputColumnId": "people-domain-col",
  "matchColumnId": "companies-domain-col",
  "returnColumnId": "companies-funding-col",
  "targetColumnId": "new-funding-col-in-people"
}
```
Case-insensitive matching. Writes to targetColumn for all rows.

---

## 10. Add Data (Clay People/Company Search)

### Search People or Companies
```
POST /api/add-data/search
```

**People search:**
```json
{
  "searchType": "people",
  "domains": ["stripe.com", "shopify.com"],
  "filters": {
    "job_title_keywords": ["Engineer"],
    "seniority_levels": ["senior", "c-suite"],
    "countries_include": ["United States"],
    "limit": 1000
  }
}
```

**Company search:**
```json
{
  "searchType": "companies",
  "filters": {
    "industries": ["Software Development"],
    "sizes": ["50", "200"],
    "country_names": ["United States"],
    "limit": 500
  }
}
```

Max 25,000 per search. Uses Clay.com API.

### People Search Filters (all optional)

**Job & Role:**
- `job_title_keywords` (string[]) — Keywords in job title
- `job_title_exclude_keywords` (string[]) — Exclude these title keywords
- `job_title_mode` ("smart"|"contain"|"exact") — Title matching mode
- `seniority_levels` (string[]) — e.g. `["owner","c-suite","vp","director","manager","senior","entry"]`
- `job_functions` (string[]) — e.g. `["Sales","Marketing","Engineering","Finance","HR"]`
- `job_description_keywords` (string[]) — Keywords in job description

**Location:**
- `countries_include` / `countries_exclude` (string[])
- `states_include` / `states_exclude` (string[])
- `cities_include` / `cities_exclude` (string[])
- `regions_include` / `regions_exclude` (string[])
- `search_raw_location` (boolean)

**Company:**
- `company_sizes` (string[]) — e.g. `["1","2-10","11-50","51-200","201-500","501-1,000","1,001-5,000","5,001-10,000","10,001+"]`
- `company_industries_include` / `company_industries_exclude` (string[])
- `company_description_keywords` / `company_description_keywords_exclude` (string[])

**Profile:**
- `headline_keywords` (string[])
- `about_keywords` (string[])
- `profile_keywords` (string[])
- `certification_keywords` (string[])
- `school_names` (string[])
- `languages` (string[])
- `names` (string[])

**Experience & Connections:**
- `connection_count` / `max_connection_count` (number)
- `follower_count` / `max_follower_count` (number)
- `experience_count` / `max_experience_count` (number)
- `current_role_min_months` / `current_role_max_months` (number)
- `role_range_start_month` / `role_range_end_month` (number)
- `include_past_experiences` (boolean)

**Results:**
- `limit` (number) — Max results (default: 25000)
- `limit_per_company` (number) — Max results per company domain

### Company Search Filters (all optional)

**Identity:**
- `company_identifier` (string[]) — Company names or domains
- `types` (string[]) — e.g. `["Public","Privately Held","Non-Profit"]`
- `derived_business_types` (string[])

**Industry:**
- `industries` / `industries_exclude` (string[])
- `derived_industries` (string[])
- `derived_subindustries` / `derived_subindustries_exclude` (string[])
- `derived_revenue_streams` (string[])
- `semantic_description` (string) — Natural language description

**Size:**
- `sizes` (string[]) — Same format as people `company_sizes`
- `minimum_member_count` / `maximum_member_count` (number)
- `minimum_follower_count` (number)

**Location:**
- `country_names` / `country_names_exclude` (string[])
- `locations` / `locations_exclude` (string[])

**Keywords:**
- `description_keywords` / `description_keywords_exclude` (string[])

**Financials:**
- `annual_revenues` (string[])
- `funding_amounts` (string[])

**Technology:**
- `technographics_main_categories` (string[])
- `technographics_parent_categories` (string[])
- `technographics_products` (string[])
- `technographics_vendors` (string[])

**Results:**
- `limit` (number)

---

## 11. Stats

### Get Storage & Counts
```
GET /api/stats
```
Returns project/table/column/row counts and estimated storage usage.

---

## 12. Job Monitoring & Progress

### Unified Job Status
```
GET /api/jobs/status
GET /api/jobs/status?tableId={id}
GET /api/jobs/status?columnId={id}
```
Returns all active and recently completed enrichment/batch jobs with progress, timing, cost projections.

### Column Progress (Cell-Level)
```
GET /api/columns/{id}/progress
```
Returns cell status counts for a column (complete, processing, pending, error, empty) with timing and error samples.

---

## 13. Admin & Debug

### Batch Status Overview
```
GET /api/admin/batch-status
```
All batch jobs with Azure sync comparison and stuck job detection.

### Debug Batch Job
```
GET /api/admin/batch-debug?jobId={id}
```
Debug batch job cell states.

### Force Job to Error
```
POST /api/admin/batch-debug?jobId={id}
```
Force update stuck job to error status.

### Force-Sync with Azure
```
POST /api/admin/batch-force-sync?jobId={id}
```

### Force Mark Complete
```
POST /api/admin/batch-mark-complete?jobId={id}
```

### Force Mark Error
```
POST /api/admin/batch-mark-error?jobId={id}&error={message}
```

---

## 14. Cron & Background Processing

### Process Enrichment Queue
```
GET /api/cron/process-enrichment
```
Processes pending/running enrichment jobs. Called by Vercel cron.

### Process Batch Queue
```
GET /api/cron/process-batch
```
Polls Azure batch jobs and processes completions.

### Force Complete Stuck Job
```
GET /api/cron/complete-job?jobId={id}
```

---

## 15. Maintenance

### Nuke Table
```
GET /api/nuke-table?id={tableId}
```
Completely deletes a table and ALL associated data (columns, rows, enrichment jobs, batch jobs). Irreversible.

---

## Data Types

### Column Types
`text`, `number`, `email`, `url`, `date`, `enrichment`, `formula`

### Cell Value Structure
```json
{
  "value": "string | number | null",
  "status": "complete | error | processing | pending | batch_submitted | batch_processing",
  "error": "string (if status=error)",
  "enrichmentData": {"key": "value"},
  "rawResponse": "full AI response text",
  "metadata": {
    "inputTokens": 100,
    "outputTokens": 50,
    "timeTakenMs": 1500,
    "totalCost": 0.001
  }
}
```

### Filter Object Format
```json
{"columnId": "col-id", "operator": "contains", "value": "search term"}
```

Available filter operators:
| Operator | Description | Value |
|----------|------------|-------|
| `equals` | Exact match (case-insensitive) | string |
| `not_equals` | Not equal | string |
| `contains` | Contains substring | string |
| `not_contains` | Does not contain | string |
| `is_empty` | Cell is empty/null | (none) |
| `is_not_empty` | Cell has value | (none) |
| `starts_with` | Starts with | string |
| `ends_with` | Ends with | string |
| `greater_than` | Greater than (numeric) | number |
| `less_than` | Less than (numeric) | number |
| `between` | Between range (numeric) | [min, max] |

### Status Codes
- `200` — Success (GET/PATCH/DELETE)
- `201` — Created (POST)
- `400` — Bad request (missing/invalid fields)
- `401` — Unauthorized
- `404` — Not found
- `500` — Server error
- `503` — Service unavailable
