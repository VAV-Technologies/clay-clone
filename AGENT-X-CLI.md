# Agent X — DataFlow Terminal Guide

`agent-x` is the terminal client for **DataFlow** (the GTM data engine behind `dataflow-pi.vercel.app`). It is the **execution layer** — not the planner. The planner brain is **you** (or Claude Code, or any LLM driving it). You read the rules in this guide, draft a `CampaignPlan` yourself, then submit it via `agent-x api POST /api/campaigns`.

> If you want gpt-5-mini to do the planning, use the web UI at [`/agent`](https://dataflow-pi.vercel.app/agent). The CLI does not delegate.

---

## Install

### macOS / Linux / WSL / Git Bash
```bash
curl -fsSL https://dataflow-pi.vercel.app/cli/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"   # if your shell rc doesn't already
```

### Windows PowerShell
```powershell
irm https://dataflow-pi.vercel.app/cli/install.ps1 | iex
```

Both installers require **Node.js ≥ 18** on PATH. Linux/macOS gets a single Node script at `~/.local/bin/agent-x`. Windows gets `~/.local/bin/agent-x.mjs` plus a `.cmd` shim so you can type `agent-x` from any prompt.

### Install location overrides
- `AGENT_X_INSTALL_DIR` — where the binary lands (default `~/.local/bin`).
- `DATAFLOW_BASE_URL` — base URL during install (default `https://dataflow-pi.vercel.app`).

---

## Configure

```
agent-x set-key <DATAFLOW_API_KEY>             # saved to ~/.config/agent-x/env
agent-x set-base-url https://staging.example   # optional, defaults to prod
```

Lookup precedence at runtime: **env vars > ~/.config/agent-x/env > defaults**. So `DATAFLOW_API_KEY=other agent-x …` wins for one-off overrides.

You can also get your API key from the web UI: open `/agent/<id>`, click **Use from terminal** in the sidebar, copy the install line and `set-key` command from the modal.

---

## Command reference

The CLI has 5 subcommands. That's the whole surface — there is no `new` / `turn` / `preview` / `launch` / `get` / `list` / `delete` / `retry`. Those were the gpt-5-mini delegation path and have been removed.

| Command | Purpose |
|---|---|
| `agent-x api <METHOD> <path> [opts]` | HTTP passthrough to any `/api/*` endpoint. Auth handled. |
| `agent-x view <tableId> [opts]` | Pretty-print rows of a sheet (ASCII grid or `--json`). |
| `agent-x docs [--api] [--url]` | Fetch this guide. `--api`: endpoint reference only. `--url`: just the URL. |
| `agent-x set-key <token>` | Save `DATAFLOW_API_KEY`. |
| `agent-x set-base-url <url>` | Save `DATAFLOW_BASE_URL`. |

### `api` flags
- `--data '<json>'` — request body. Validated as JSON before the HTTP call.
- `--data-file <path>` — body from a file. Mutually exclusive with `--data`.
- `--query k=v` — repeatable. Becomes URL-encoded query params.
- `--output <path>` (or `-o`) — write response body to a file instead of stdout.

### `view` flags
- `--limit N` — number of rows (default 20).
- `--cols a,b,c` — show only matching columns (substring, case-insensitive).
- `--filter '<json>'` — server-side filter, e.g. `[{"columnId":"...","operator":"is_empty"}]`.
- `--wide` — disable cell truncation (default 30 chars).
- `--json` — emit JSON array `[{ _id, "Col": value, ... }]` instead of a grid.
- `--meta` — show non-`complete` cell status next to values (grid) or include full cell object (json).
- `--inspect <columnName>` — per-column status tally + first 3 error samples (substring match on name).

---

## Examples

### Build and launch a campaign end-to-end (you are the planner)

```bash
# 1. Read the rules first.
agent-x docs

# 2. Plan in your head (or in chat with the user), write the plan to disk.
cat > /tmp/plan.json <<'EOF'
{
  "name": "Vietnam Mid-Market Manufacturing CFOs",
  "steps": [
    { "type": "search_companies", "params": { "source": "ai-ark",
        "filters": { "location": ["Vietnam"],
                     "industries": ["Manufacturing"],
                     "employeeSize": [{"start": 50, "end": 500}],
                     "limit": 1000 } } },
    { "type": "create_sheet",  "params": { "name": "Companies",
        "columns": ["Company Name","Domain","Size","Industry","Country","Location","LinkedIn URL","Description"] } },
    { "type": "import_rows",   "params": { "sheet": "Companies", "source": "companies" } },
    { "type": "filter_rows",   "params": { "sheet": "Companies",
        "remove": [{"column":"Domain","operator":"is_empty"}] } },
    { "type": "find_domains",  "params": { "sheet": "Companies" } },
    { "type": "filter_rows",   "params": { "sheet": "Companies",
        "remove": [{"column":"Domain","operator":"is_empty"}] } },
    { "type": "search_people", "params": { "source": "ai-ark",
        "domainsFrom": "sheet:Companies:Domain",
        "filters": { "accountLocation": ["Vietnam"],
                     "departments": ["Finance"],
                     "seniority": ["c_level","vp"],
                     "limit": 500 } } },
    { "type": "create_sheet",  "params": { "name": "People",
        "columns": ["First Name","Last Name","Full Name","Job Title","Company Domain","Location","LinkedIn URL"] } },
    { "type": "import_rows",   "params": { "sheet": "People", "source": "people" } },
    { "type": "qualify_titles","params": { "sheet": "People", "intent": "CFOs at mid-market manufacturing companies in Vietnam" } },
    { "type": "find_emails_waterfall", "params": { "sheet": "People", "removeEmpty": true } },
    { "type": "clean_company_name",    "params": { "sheet": "People", "inputColumn": "Company Domain" } },
    { "type": "clean_person_name",     "params": { "sheet": "People" } },
    { "type": "materialize_send_ready","params": { "sourceSheet": "People" } }
  ]
}
EOF

# 3. Submit.
agent-x api POST /api/campaigns --data-file /tmp/plan.json
# -> { "id": "camp_...", "workbookId": "wb_...", "totalSteps": 14 }

# 4. Poll for progress.
while sleep 8; do
  agent-x api GET /api/campaigns/camp_xxx | jq '{status, currentStepIndex, steps: [.steps[] | {type, status}]}'
done
```

### Inspect a workbook
```bash
agent-x api GET /api/projects                                        # list workbooks
agent-x api GET /api/tables --query projectId=wb_xxx                 # list sheets
agent-x view <tableId> --limit 10 --cols name,domain,size            # peek
agent-x view <tableId> --inspect "Email (AI)"                        # diagnose AI column
```

### Run AI enrichment on existing rows
```bash
agent-x api POST /api/enrichment/setup-and-run --data-file ./enrich-config.json
```

### Filter, then bulk delete
```bash
# Get IDs of rows with empty Email
agent-x api GET /api/rows \
  --query tableId=$TID \
  --query 'filters=[{"columnId":"COL_EMAIL","operator":"is_empty"}]' \
  --query filterLogic=AND \
  | jq -r '.[].id' > /tmp/ids.txt

agent-x api DELETE /api/rows --data "{\"rowIds\": $(jq -R . /tmp/ids.txt | jq -s .)}"
```

### Export a sheet as CSV
```bash
agent-x api GET /api/export/csv --query tableId=$TID --output /tmp/out.csv
```

### Retry an errored campaign
```bash
agent-x api POST /api/campaigns/<id> --data '{"action":"retry"}'
```

### Just pull the spec
```bash
agent-x docs           # full guide (CLI + planner rules + API reference)
agent-x docs --api     # endpoint reference only
agent-x docs --url     # just the URL — handy for `curl` pipes
```

---

## Notes for Claude Code (or any LLM driving this CLI)

**You ARE Agent X.** The rules below — drawn from the same system prompt gpt-5-mini follows in the web UI — apply to you. Don't shortcut them.

1. **Always `agent-x docs` first** if you don't already have the guide in context. The rules + plan schema + step recipes are in the section that follows the CLI reference.
2. **Don't call `/api/agent/conversations*` endpoints from the CLI.** Those exist for the web UI; using them delegates to gpt-5-mini, which defeats the point of you being the planner.
3. **Column IDs are per-sheet.** Always call `GET /api/columns?tableId={this-sheet}` before constructing any filter, sort, or enrichment request. Reusing a column ID from another sheet returns `400 invalidColumnIds`.
4. **Construct ONE plan, submit ONCE.** Don't fire individual `search_companies` / `create_sheet` / `import_rows` etc. via separate API calls — flatten them into a `steps[]` array and POST to `/api/campaigns`. The server's engine handles ordering, retries, batch enrichment polling, and find_domains web search. Reimplementing that in your head is a bug waiting to happen.
5. **Approval flow:** draft the plan, render it in chat as markdown, ask for explicit approval, then POST. Don't auto-launch.
6. **`agent-x view --inspect <col>` is your debug tool** when an AI column has empty cells.

---

