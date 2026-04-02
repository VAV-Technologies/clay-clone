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

### Get / Update / Delete Config
```
GET    /api/enrichment/{id}
PATCH  /api/enrichment/{id}
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

---

## 7. Formula

### Create Formula Config
```
POST /api/formula
```
```json
{"name": "Full Name", "formula": "[{{First Name}}, {{Last Name}}].filter(Boolean).join(' ')"}
```
Supports `{{Column Name}}` references, JavaScript expressions, lodash (`_`), FormulaJS functions.

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

---

## 11. Stats

### Get Storage & Counts
```
GET /api/stats
```
Returns project/table/column/row counts and estimated storage usage.

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

### Status Codes
- `200` — Success (GET/PATCH/DELETE)
- `201` — Created (POST)
- `400` — Bad request (missing/invalid fields)
- `401` — Unauthorized
- `404` — Not found
- `500` — Server error
- `503` — Service unavailable
