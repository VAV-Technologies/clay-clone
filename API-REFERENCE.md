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
| 13 | (Optional) AI personalization | `POST /api/enrichment` + `POST /api/enrichment/run` | Generate personalized intro lines using `{{Full Name}}`, `{{Job Title}}` template vars |
| 14 | Export | `GET /api/export/csv?tableId=...` | Download as CSV or read as JSON via `GET /api/rows` |

### Workflow 2: "Research these companies and find decision-makers"

When you already have a list of company domains/names:

| Step | Action | Endpoint |
|------|--------|----------|
| 1 | Create workbook + sheet | `POST /api/projects` + `POST /api/tables` |
| 2 | Import known companies | `POST /api/rows` or `POST /api/import/csv` |
| 3 | AI enrich missing data | `POST /api/enrichment` + `POST /api/enrichment/run` (research industry, size, HQ) |
| 4 | Search people at domains | `POST /api/add-data/search` with `searchType: "people"` + `domains: [...]` |
| 5 | Create People sheet + import | `POST /api/tables` + `POST /api/columns` + `POST /api/rows` |
| 6 | Lookup + Find Email + Clean | `POST /api/lookup/run` + `POST /api/find-email/run` + filter/delete |

### Workflow 3: "Find [role] people in [location] and get emails"

Direct people search (no company step needed):

| Step | Action | Endpoint |
|------|--------|----------|
| 1 | Search people directly | `POST /api/add-data/search` — omit `domains` field for cross-company search |
| 2 | Create workbook + sheet + columns | `POST /api/projects` + `POST /api/tables` + `POST /api/columns` |
| 3 | Import people | `POST /api/rows` |
| 4 | Find emails | `POST /api/find-email/run` |
| 5 | Clean up + export | Filter empty emails, delete, export CSV |

### Agent Decision Framework

- **Company-first vs People-first:** Request mentions industries, company sizes, revenue → start with company search. Request is about roles/titles → start with people search directly.
- **When to use Lookup:** Connect data between sheets. Common: pulling company info (industry, size) into a people sheet via matching domain columns.
- **When to use AI Enrichment:** For data that doesn't exist in Clay — personalized intros, research summaries, lead scoring. Batch mode (`POST /api/enrichment/batch`) for 1000+ rows.
- **When to use Formula:** Data transformations — extracting domains from emails, combining first+last name, conditional logic. No AI cost, instant.
- **Monitoring:** Poll `GET /api/jobs/status` for ETAs. Cell-level detail via `GET /api/columns/{id}/progress`.
- **Error handling:** After email finding, check foundCount. Filter/remove empty email rows before delivering results.

### Data Flow

```
Workbook (container)
  |
  +-- Sheet 1: Companies
  |     Search companies → Import rows → Filter bad data
  |
  +-- Sheet 2: People
  |     Search people at company domains → Import rows
  |     ← Lookup (pull company fields from Sheet 1)
  |     → Find Email (Ninjer API)
  |     → Filter (remove no-email rows)
  |     → AI Enrich (optional: personalization)
  |
  +-- Export: CSV or JSON via API
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

### List All Enrichment Configs
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
  "temperature": 0.7
}
```

### Get / Update Enrichment Config
```
GET    /api/enrichment/{id}
PATCH  /api/enrichment/{id}
```

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

### Find Emails for Rows
```
POST /api/find-email/run
```
```json
{
  "tableId": "table-id",
  "rowIds": ["row-1", "row-2"],
  "inputMode": "full_name",
  "fullNameColumnId": "name-col-id",
  "domainColumnId": "domain-col-id",
  "emailColumnId": "email-output-col-id",
  "emailStatusColumnId": "status-output-col-id"
}
```
Uses Ninjer API. 2 concurrent requests, 100ms delay. 90s timeout per call.

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
