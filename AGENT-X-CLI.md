# Agent X — DataFlow Terminal Guide

`agent-x` is the terminal client for **DataFlow** (the GTM data engine behind `dataflow-pi.vercel.app`). It lets you (or Claude Code, or any script) drive everything the web UI does — from natural-language campaign building to direct row/column CRUD — without leaving the shell.

Two modes:
1. **Conversational planner** — `agent-x new "find 50 CFOs in Vietnam"` → multi-turn chat → preview → launch.
2. **Direct API** — `agent-x api <METHOD> <path>` and `agent-x view <tableId>` for anything outside the planner.

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

Both installers require **Node.js ≥ 18** on PATH. The bash installer drops a single Node script at `~/.local/bin/agent-x`; the PowerShell variant writes `~/.local/bin/agent-x.mjs` plus a `.cmd` shim so you can type `agent-x` from any prompt.

### Install location overrides
- `AGENT_X_INSTALL_DIR` — where the binary lands (default `~/.local/bin`).
- `DATAFLOW_BASE_URL` — base URL during install (default `https://dataflow-pi.vercel.app`).

---

## Configure

```
agent-x set-key <DATAFLOW_API_KEY>          # saved to ~/.config/agent-x/env
agent-x set-base-url https://staging.example # optional, defaults to prod
```

Lookup precedence at runtime: **env vars > ~/.config/agent-x/env > defaults**. So `DATAFLOW_API_KEY=other agent-x …` wins for one-off overrides.

---

## Two ways to drive DataFlow

| Use the planner (`new` / `turn` / `preview` / `launch`) | Use the API (`api` / `view`) |
|---|---|
| The user describes a goal in plain English | You already know which rows/columns/tables to touch |
| You want filter conversion, qualify-titles, email waterfall, send-ready sheet — for free | You want to inspect, edit, or backfill specific cells |
| Result: a running campaign with multiple sheets | Result: one HTTP request, one response |

Both authenticate via the same `DATAFLOW_API_KEY`. You can mix them — e.g. let the planner build the workbook, then use `agent-x view` to inspect a sheet and `agent-x api POST /api/enrichment/setup-and-run` to add an AI column afterwards.

---

## Command reference

### Conversational planner

| Command | Purpose |
|---|---|
| `agent-x new "<prompt>" [--model <id>]` | Start a new campaign conversation. Default model: `gpt-5-mini` (Azure). |
| `agent-x turn <conv_id> "<msg>" [--model <id>]` | Append a follow-up turn. Send `"approve"` (or `"go"`, `"looks good"`, etc.) to lock the plan. |
| `agent-x get <conv_id>` | Show conversation status, last assistant message, plan summary, and (if launched) campaign progress. |
| `agent-x preview <conv_id>` | After approval: run the search-count preview. Shows `estimatedTotal` so you can pick a sensible launch limit. |
| `agent-x launch <conv_id> [--limit N]` | Launch the approved plan as a real campaign. `--limit` caps the initial search size. |
| `agent-x list` | Recent conversations. |
| `agent-x delete <conv_id>` | Delete a conversation (cancels its campaign if still running). |

**Approval keywords** (short-circuit; no LLM call): `approve`, `approved`, `go`, `go ahead`, `looks good`, `looks great`, `lgtm`, `run it`, `ship it`, `yes`, `ok`, `okay`, `sounds good`, `do it`, `confirm`, `proceed`. Anything with `but / change / add / only / instead / ?` etc. routes back to the planner for a fresh draft.

### Direct API

| Command | Purpose |
|---|---|
| `agent-x api <METHOD> <path> [opts]` | HTTP passthrough to any endpoint in the API reference below. |
| `agent-x view <tableId> [opts]` | Pretty-print rows of a sheet as an ASCII grid (or JSON with `--json`). |
| `agent-x docs [--api] [--url]` | Fetch this guide. `--api` returns only the endpoint reference. `--url` just prints the URL. |

**`api` flags:**
- `--data '<json>'` — request body. Validated as JSON before any HTTP call.
- `--data-file <path>` — body from a file. Mutually exclusive with `--data`.
- `--query k=v` — repeatable. Becomes URL-encoded query params.

**`view` flags:**
- `--limit N` — number of rows (default 20).
- `--cols a,b,c` — show only matching columns (substring, case-insensitive).
- `--filter '<json>'` — server-side filter, e.g. `[{"columnId":"...","operator":"is_empty"}]`.
- `--wide` — disable cell truncation (default 30 chars).
- `--json` — emit JSON array of `{ _id, "Col Name": value, … }` instead of a grid.

---

## Examples

### Build and launch a campaign end-to-end
```bash
agent-x new "find 50 CFOs of mid-market manufacturing companies in Vietnam"
# -> conv_295bad99-...

agent-x turn conv_295bad99-... "approve"
agent-x preview conv_295bad99-...        # estimatedTotal: 216
agent-x launch  conv_295bad99-... --limit 50
agent-x get     conv_295bad99-...        # poll status / step progress
```

### Inspect a sheet from a running campaign
```bash
# Find the workbook
agent-x list
agent-x get conv_295bad99-...
#   workbook: bc55c139-6c0d-49b4-b032-ba7e91aa95d1

# List its sheets
agent-x api GET /api/tables --query projectId=bc55c139-6c0d-49b4-b032-ba7e91aa95d1

# View the Companies sheet
agent-x view 94d0262a-f25b-437a-91c4-81f13ab2ccbd --limit 10 --cols name,domain,size
```

### Run an AI enrichment on existing rows
```bash
agent-x api POST /api/enrichment/setup-and-run --data-file ./enrich-config.json
# enrich-config.json: { tableId, columnName, prompt, model, ... }  — see §6.1 below
```

### Filter, then bulk delete
```bash
# Get IDs of rows with empty Email
agent-x api GET /api/rows \
  --query tableId=$TID \
  --query 'filters=[{"columnId":"COL_EMAIL","operator":"is_empty"}]' \
  --query filterLogic=AND \
  | jq -r '.[].id' > /tmp/ids.txt

# Delete them
agent-x api DELETE /api/rows --data "{\"rowIds\": $(jq -R . /tmp/ids.txt | jq -s .)}"
```

### Just pull the spec
```bash
agent-x docs           # this guide (CLI + API reference, ~1500 lines)
agent-x docs --api     # endpoint reference only
agent-x docs --url     # the URL (handy for `curl` pipes)
```

---

## Notes for Claude Code

If you're an AI agent reading this via `agent-x docs`:

- **Column IDs are per-sheet.** Always call `GET /api/columns?tableId={this-sheet}` before constructing any filter, sort, or enrichment request. Reusing a column ID from another sheet returns `400 invalidColumnIds`.
- **Prefer the planner for whole campaigns**, the API for surgical edits. The planner already encodes hard-won rules (revenue → employee conversion, mandatory seniority filter, find_domains backfill, email waterfall, send-ready sheet). Don't reimplement.
- **`approve` is idempotent** — calling it twice on the same conversation is safe and free (no LLM round-trip).
- **`agent-x view` is the fastest way to verify a campaign worked** — pipe to `--json | jq` if you need to assert on values programmatically.

---

