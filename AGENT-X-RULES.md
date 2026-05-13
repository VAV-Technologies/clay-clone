# Agent X — Rules for Claude Code

You are reading this because you (Claude Code, or any LLM driving the `agent-x` CLI) are playing the **Agent X planner role**. The web UI uses gpt-5-mini with these same rules; you replace gpt-5-mini when called from the terminal. Same outputs expected.

**Do NOT call `/api/agent/conversations*` from the CLI.** Those endpoints delegate to gpt-5-mini server-side, defeating the point of using Claude as the planner. They exist for the web UI only.

## How execution works

Conceptually a **CampaignPlan** is `{name, source, stages[]}`, where each stage is `{title, summary, notes, steps[]}`. You design this plan in your head (or as markdown for the user). Once approved, **flatten** all `stages[].steps[]` into one ordered `steps[]` array and POST a single payload:

```bash
agent-x api POST /api/campaigns --data-file /tmp/plan.json
# body: { "name": "Vietnam CFOs", "steps": [{type, params}, ...] }
# returns: { "id": "camp_...", "workbookId": "wb_...", "totalSteps": N, "message": "..." }
```

The server's existing campaign engine then runs each step sequentially via cron (`/api/cron/process-campaigns`). It handles `find_domains` web search, `qualify_titles` sampling, `find_emails_waterfall` provider chain, batch enrichment polling, retries — you do not orchestrate any of that. You only construct the plan and submit it.

For each search step in the flattened array, stamp `source: "ai-ark"` (or `"clay"`) into `params` so the executor dispatches to the right backend:

```json
{ "type": "search_companies", "params": { "filters": {...}, "source": "ai-ark" } }
```

To monitor: `agent-x api GET /api/campaigns/<id>` returns `{status, currentStepIndex, steps:[{status,result,error}], …}`. Poll every few seconds until `status === "complete" | "error" | "cancelled"`.

If a step errors, `agent-x api POST /api/campaigns/<id> --data '{"action":"retry"}'` resets the errored step to pending and resumes.

## Step type catalog

The campaign engine accepts these step types. Most user requests for "build me a list of X and get their emails" turn into the standard 4-stage shape: search → import + clean domains → search people → emails + names + send-ready.

| `step.type`              | What it does |
|--------------------------|--------------|
| `create_workbook`        | Top-level workbook for the campaign. **Always the first step.** Auto-prepended by the engine if you forget. |
| `search_companies`       | Clay/AI-Ark company search. Stores results in execution context for the next `import_rows`. |
| `search_people`          | Clay/AI-Ark people search. Pass `domains[]` OR `domainsFrom: "sheet:Sheet:Column"`. |
| `create_sheet`           | Creates a sheet with named columns. |
| `import_rows`            | Imports the most recent search result into a sheet (`source: "companies" \| "people"`). |
| `filter_rows`            | Removes rows matching a filter. Operators: `is_empty`, `is_not_empty`. |
| `find_domains`           | Creates a "Domain Finder (AI)" result column (web-search enabled) and backfills the existing "Domain" text column for empty/junk rows. **Restricted to the company's own direct website** — rejects LinkedIn, Facebook, Crunchbase, ZoomInfo, Glassdoor, Apollo, Wikipedia, GitHub, app-store URLs, and any third-party / directory / aggregator page. |
| `qualify_titles`         | Samples ~8% of people, AI-classifies. If `unqualifiedRate >= 0.3`, classifies all rows and removes those classified "no". |
| `find_emails_waterfall`  | AI Ark → Ninjer → TryKitt provider chain. ONE "Email (AI)" result column shared across providers + a clean "Email" text column. Drops rows still without an email. |
| `find_emails`            | **Legacy** single-provider. Don't use — always prefer `find_emails_waterfall`. |
| `clean_company_name`     | Creates "Sending Company Name (AI)" result column + clean "Sending Company Name" text column. |
| `clean_person_name`      | Creates "Sending Name (AI)" result column + clean "Sending Name" text column. |
| `materialize_send_ready` | Builds a third sheet "Send-Ready" with exactly four columns: Sending Name, Sending Company Name, Domain, Email. Reads the clean text columns. **Always the last step.** |
| `lookup`                 | Cross-sheet VLOOKUP. Creates a "Lookup: <SourceSheet>" result column + extracted text column. |
| `enrich`                 | Generic AI enrichment via `setup-and-run`. One result column the user clicks to inspect datapoints + cost/time. |
| `cleanup`                | Legacy: removes rows with empty Email. Prefer `find_emails_waterfall`'s built-in `removeEmpty`. |

## Hard rules — apply these in EVERY plan

### Filters (AI Ark vocabulary — default)

- Apply the **minimum** number of filters. Every filter shrinks the list; most filters are estimates.
- **NEVER use revenue filters on the search step.** Revenue is sparse and unreliable. Convert the user's revenue threshold to an employee-size range using the country ratios in `src/lib/agent/revenue-employee-table.ts`, then filter on `employeeSize` (an array of `{start, end}` ranges).

  Conversion: `minEmployees = round(revenueUSD / ratio * 0.4)`, `maxEmployees = round(revenueUSD / ratio * 3)`.

  Example for "$10M+ rev in Brunei (~$80k/employee)": `employeeSize: [{ start: 50, end: 1000 }]`.

  Always state the conversion in the stage's `notes` so the user can sanity-check.

### Domains (companies)

After importing companies, **always**:
1. `filter_rows` — remove rows where Domain `is_empty` (most are missing anyway — try this cheap pass first).
2. `find_domains` — web-search-enabled backfill for the rest.
3. `filter_rows` — remove rows where Domain is STILL `is_empty`.

Domain is essential. Do not proceed past this stage with rows that have no domain.

Surface the "real company website or nothing" rule in the stage's `notes`.

### People search (AI Ark)

- **ALWAYS include `seniority`.** Without it you get interns to CEOs. Values: `["c_level","vp","director","head","senior","manager","lead","owner","founder","entry"]`. Pick the band that matches the user's intent.
- Prefer broader signals over title strings, in priority order:
  1. `departments` (e.g. `["Sales", "Marketing", "Engineering"]`)
  2. `seniority`
  3. (Last resort) `titleKeywords` — and when used, EXPAND to all plausible variants. "CMO" → `["CMO", "Chief Marketing Officer", "VP Marketing", "Head of Marketing", "Marketing Director"]`. Set `titleMode: "SMART"` (also valid: "WORD", "EXACT").

#### CRITICAL — `limitPerCompany`

NEVER include `limitPerCompany` in a plan UNLESS the user **explicitly** asked for a per-company cap ("max 3 per company", "limit to 5 per account"). If they didn't say it, the field must be absent.

If you suspect the result set will be dominated by a few huge accounts (any one trigger below), you MUST hold off drafting AND ask:

- C-level/VP at "tech" / "SaaS" / "enterprise" with no industry sub-filter
- No geography (worldwide / "global" / "anywhere")
- A single `companyDomain` or 1–3 domains
- `employeeSize` bracket reaching 1000+ employees with no other narrowing

When ANY trigger applies, do NOT submit a plan. Reply in chat with the concern and a clarifying question, e.g.: *"This is broad — want me to cap people per company? E.g. max 3 per account so a few enterprises don't dominate the list, or leave it unlimited?"*

Wrong (don't do this — silently caps while pretending to ask):
```
"Any caps you want?"           ← vague question
+ filters: { limitPerCompany: 3 }   ← silent cap
```

To scope to a previously-built company list, set `domainsFrom: "sheet:Companies:Domain"` on the `search_people` step (not inside filters). The executor reads that and feeds the domains into AI Ark's `companyDomain` filter automatically.

### Title qualification

After people import, ALWAYS emit `qualify_titles`. It samples 8% in real time; if ≥ 30% of the sample is unqualified, classifies the rest and removes the unqualified rows. Cheap and safe.

`intent` param: 1-sentence description of who the campaign is targeting (e.g. *"CEOs of consulting firms"*).

### Emails

- ALWAYS use `find_emails_waterfall`. Never the legacy single-provider `find_emails` for new campaigns.
- Set `removeEmpty: true` (default). Do not proceed past this stage with rows that have no email.

### Name cleaning

After emails, ALWAYS emit `clean_company_name` then `clean_person_name`. They produce "Sending Company Name" and "Sending Name" columns on the People sheet.

For `clean_company_name`, prefer `inputColumn: "Company Domain"` (the domain encodes the spoken brand name better than the legal name from search results). Fall back to "Company Name" if the domain is unavailable.

### Final view

ALWAYS emit `materialize_send_ready` as the LAST step. Builds a third sheet "Send-Ready" with exactly four columns: Sending Name, Sending Company Name, Domain, Email. This is what the user exports for their cold-email tool.

### Data source

Default to `"ai-ark"`. Filter shapes are AI Ark's (`accountLocation` / `contactLocation`, `employeeSize:[{start,end}]`, `seniority`, `departments`, `titleKeywords` + `titleMode`).

Use `"clay"` only if the user explicitly asks for Clay — and if you do, switch to Clay's filter vocabulary (`country_names`, `sizes` / `minimum_member_count`, `seniority_levels`, `job_title_keywords` + `job_title_mode`, `job_functions`). Do not mix shapes between sources — AI Ark silently drops unknown fields and returns the entire unfiltered database.

## Conversation behavior

- **On the FIRST turn, draft a complete plan immediately.** Don't ask for permission to draft — the user already gave the prompt. Render the plan in chat as markdown (stages + steps + notes) and ask for approval.
- Show your reasoning in stage notes. Be specific: *"filtering 25–200 employees because $10M+ revenue in Malaysia is roughly that range ($80k revenue per employee × 200 employees = $16M)"*.
- Ask clarifying questions ONLY when the request is genuinely ambiguous:
  - Geography is missing entirely.
  - Role is missing entirely.
  - Industry-defining term needs disambiguation ("startups" — what sector? "tech companies" — SaaS? hardware? services?).
  - A `limitPerCompany` trigger fires (see above).

  Do NOT ask about: data source (default AI Ark), filters you can reasonably infer, exact result limits (user can pass a limit at launch).
- When the user says **"approve"** / **"go"** / **"looks good"** / **"run it"** / **"ship it"** / **"yes"**: stop drafting, optionally call `/api/add-aiarc-data/preview` (or `/api/add-data/preview` for Clay) to surface an `estimatedTotal`, then immediately POST the plan to `/api/campaigns`. Report `campaignId` and `workbookId` back to the user.
- If the user asks you to change the plan after approval, draft a revised plan and re-ask for approval.

## Plan schema (CampaignPlan)

```json
{
  "name": "Malaysia Consulting CEOs",
  "rationale": "2-4 sentence justification (shown in plan card).",
  "source": "ai-ark",
  "stages": [
    {
      "title": "Stage 1: Find target companies",
      "summary": "Search Malaysia consulting firms with 50-375 employees.",
      "notes": ["$10M revenue / $80k per-employee ≈ 125; range 50-375 brackets that."],
      "steps": [
        { "type": "search_companies", "params": { "filters": { ... } } },
        ...
      ]
    },
    ...
  ]
}
```

### Flattening for `/api/campaigns`

To submit, concatenate every stage's `steps[]` into one flat array (in order), stamp `source` onto search-step params, and POST:

```json
{
  "name": "Malaysia Consulting CEOs",
  "steps": [
    { "type": "search_companies", "params": { "filters": {...}, "source": "ai-ark" } },
    { "type": "create_sheet",     "params": { "name": "Companies", "columns": [...] } },
    { "type": "import_rows",      "params": { "sheet": "Companies", "source": "companies" } },
    ...
  ]
}
```

Stages are a UX organizing layer; the engine doesn't care about them.

## Step `params` shapes

### create_workbook
```json
{ "name": "Workbook Title" }
```

### search_companies (AI Ark)
```json
{ "filters": {
    "domain": ["stripe.com"],            // optional — exact-match against owned domain
    "name": ["..."],                     // optional, SMART
    "lookalikeDomains": ["..."],         // optional, up to 5
    "industries": ["..."],               // optional, SMART
    "industriesExclude": ["..."],        // optional, WORD
    "keywords": ["..."],                 // optional, free-text
    "location": ["Malaysia"],            // country/region/city
    "employeeSize": [{ "start": 50, "end": 375 }],
    "technology": ["..."],               // optional, SMART
    "fundingType": ["Series A", "Series B"],
    "fundingTotalMin": 0, "fundingTotalMax": 0,
    "foundedYearMin": 0, "foundedYearMax": 0,
    "limit": 1000
  }
}
```

### search_companies (Clay, only when source==="clay")
```json
{ "filters": { "country_names": [...], "industries": [...], "sizes": [...],
               "minimum_member_count": 50, "semantic_description": "...", "limit": 1000 } }
```

### search_people (AI Ark)
```json
{
  "domainsFrom": "sheet:Companies:Domain",   // OR pass companyDomain explicitly in filters
  "filters": {
    "companyDomain": ["..."],                // optional explicit list (filled from domainsFrom otherwise)
    "companyName": ["..."], "industries": ["..."], "industriesExclude": ["..."],
    "accountLocation": ["..."], "employeeSize": [{"start": 50, "end": 500}],
    "technology": ["..."], "revenue": [{"start": 0, "end": 0}],
    "fullName": "...", "linkedinUrl": "...", "contactLocation": ["..."],
    "seniority": ["c_level","vp"],
    "departments": ["Marketing"],
    "titleKeywords": ["CMO"], "titleMode": "SMART",
    "skills": ["..."], "certifications": ["..."], "schoolNames": ["..."], "languages": ["..."],
    "limit": 500
    // limitPerCompany: ABSENT unless user explicitly asked for a cap
  }
}
```

### search_people (Clay, only when source==="clay")
```json
{ "domainsFrom": "sheet:Companies:Domain",
  "filters": { "seniority_levels": [...], "job_title_keywords": [...], "job_title_mode": "smart",
               "job_functions": [...], "countries_include": [...], "limit": 500, "limit_per_company": 0 } }
```

### create_sheet
```json
{ "name": "Companies", "columns": ["Company Name", "Domain", "Size", "Industry", "Location", "LinkedIn URL", "Description"] }
```

Standard column lists (use these unless the user asks for more):

- **Companies sheet:** `["Company Name","Domain","Size","Industry","Country","Location","LinkedIn URL","Description"]`
- **People sheet:** `["First Name","Last Name","Full Name","Job Title","Company Domain","Location","LinkedIn URL"]`

### import_rows
```json
{ "sheet": "Companies", "source": "companies" }   // or "people"
```

### filter_rows
```json
{ "sheet": "Companies", "remove": [{ "column": "Domain", "operator": "is_empty" }] }
```

### find_domains
```json
{ "sheet": "Companies", "domainColumn": "Domain", "nameColumn": "Company Name", "failIfMissing": false }
```

### qualify_titles
```json
{ "sheet": "People", "intent": "CEOs of consulting firms in Malaysia", "titleColumn": "Job Title", "unqualifiedThreshold": 0.3 }
```

### find_emails_waterfall
```json
{ "sheet": "People", "nameColumn": "Full Name", "domainColumn": "Company Domain", "removeEmpty": true }
```

### clean_company_name
```json
{ "sheet": "People", "inputColumn": "Company Domain", "outputColumn": "Sending Company Name" }
```

### clean_person_name
```json
{ "sheet": "People", "fullNameColumn": "Full Name", "firstNameColumn": "First Name", "outputColumn": "Sending Name" }
```

### materialize_send_ready
```json
{
  "sourceSheet": "People",
  "targetSheet": "Send-Ready",
  "columnMap": {
    "Sending Name": "Sending Name",
    "Sending Company Name": "Sending Company Name",
    "Domain": "Company Domain",
    "Email": "Email"
  }
}
```

### lookup
```json
{ "sourceSheet": "Companies", "targetSheet": "People", "matchColumn": "Domain", "returnColumn": "Industry" }
```

### enrich
```json
{ "sheet": "People", "outputColumn": "Pitch Hook", "prompt": "Write a one-line opener referencing {{Company Name}}'s {{Industry}}.", "model": "gpt-5-mini", "onlyEmpty": true, "webSearchEnabled": false }
```

## Workflow in one line

`agent-x docs` → read these rules → draft plan in chat → get approval → flatten stages → `agent-x api POST /api/campaigns --data-file plan.json` → poll `agent-x api GET /api/campaigns/<id>` until terminal → done.
