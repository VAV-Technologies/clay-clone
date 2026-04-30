# Claude Code Rules

## API docs are authoritative — read them first

When the task involves reading/writing workbook data (projects, sheets, columns, rows, enrichment, formulas, lookup, find-email, import/export), the **first action** is:

    Read API-REFERENCE.md

Do **not** read route files under `src/app/api/**`, the drizzle schema, the formula evaluator, or middleware to figure out how to call the app. Those are implementation details. `API-REFERENCE.md` documents every endpoint, request body, filter operator, standard column names, and end-to-end workflows (Workflows 1–6). The production base URL is `https://dataflow-pi.vercel.app` and auth is `Authorization: Bearer $DATAFLOW_API_KEY` (already in `.env.local`).

Use `GET /api/rows` filters server-side (`is_empty`, `is_not_empty`, `contains`, etc. with `filterLogic=AND|OR`) instead of fetching all rows and filtering in JS.

**Column IDs are per-sheet, never reuse them across sheets.** When filtering, sorting, looking up, finding email, or enriching anything that takes a `columnId`, fetch `GET /api/columns?tableId={this-sheet}` for the *exact* sheet you are targeting and use those IDs. Reusing a column ID from another sheet (even within the same workbook) returns `400 invalidColumnIds` — pre-fix it silently matched every row, which is the most common silent-wrong-answer trap in this API.

Prefer a few `curl` calls over writing a migration script. Only drop to a script when you genuinely need a loop (pagination, bulk inserts >500 rows).

## Auto-deploy
**ALWAYS commit and push changes to origin/master immediately after making any code changes.** Do not wait for the user to ask. Every change should go live to Vercel automatically.
