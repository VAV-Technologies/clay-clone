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

### List Rows
```
GET /api/rows?tableId={tableId}&limit=1000&offset=0
```
Optional: `rowIds=id1,id2,id3` for specific rows.

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

### Sorting & Filtering
```
GET /api/rows?tableId={id}&sortBy={columnId}&sortOrder=asc|desc
GET /api/rows?tableId={id}&filters=[{"columnId":"col-id","operator":"contains","value":"stripe"}]&filterLogic=AND|OR
```

Query parameters:
- `sortBy` — Column ID to sort by
- `sortOrder` — `asc` (default) or `desc`
- `filters` — URL-encoded JSON array of filter objects
- `filterLogic` — `AND` (default) or `OR`

Response includes headers: `X-Total-Count`, `X-Filtered-Count`

Filter object format:
```json
{"columnId": "col-id", "operator": "contains", "value": "search term"}
```

Available operators:
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

Combined example:
```
GET /api/rows?tableId=X&filters=[{"columnId":"col-1","operator":"contains","value":"stripe"},{"columnId":"col-2","operator":"is_not_empty"}]&filterLogic=AND&sortBy=col-1&sortOrder=desc&limit=50&offset=0
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
