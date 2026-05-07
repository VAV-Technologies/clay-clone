// The DataFlow Campaign Builder agent — single planner turn.
//
// Powered by gpt-5-mini via the existing callAI / Azure-OpenAI plumbing
// (the same client that runs real-time enrichment). We run a single LLM
// round per turn, expecting structured JSON back. The planner does not
// stream; the UI shows a spinner and renders the result when the call
// returns.
//
// We intentionally do NOT expose tools to the planner in this first
// version. The planner produces a complete plan in one shot; the user
// approves; the API layer runs preview/launch as deterministic follow-up
// steps. If we want richer reasoning loops later, we can enable
// tools through callAI's existing toolDispatcher hook.

import { callAI } from '@/lib/ai-provider';
import type { AgentMessage } from '@/lib/db/schema';
import type { CampaignPlan } from './plan-schema';
import { validatePlan } from './plan-schema';
import { COUNTRY_REVENUE_PER_EMPLOYEE_USD } from './revenue-employee-table';

export type NextAction =
  | 'await_user_reply'
  | 'awaiting_approval'
  | 'awaiting_count_confirm'
  | 'launched';

export interface PlannerOutput {
  assistantText: string;
  planJson?: CampaignPlan;
  clarifyingQuestions?: string[];
  nextAction: NextAction;
  rawResponse: string;
  inputTokens: number;
  outputTokens: number;
  timeTakenMs: number;
}

export interface PlannerHistoryItem {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  // If the assistant attached a structured plan to a previous turn, include
  // the JSON inline so the model can reason against its own prior output.
  planJson?: unknown;
}

export interface RunPlannerArgs {
  history: PlannerHistoryItem[];
  // Free-form context the API layer wants to inject into this turn — e.g.
  // "PREVIEW RESULT: 1840 matches" or "USER REQUESTED CHANGE: smaller list".
  injectedContext?: string;
}

const REVENUE_TABLE_SUMMARY = (() => {
  const lines = Object.entries(COUNTRY_REVENUE_PER_EMPLOYEE_USD)
    .filter(([k]) => k !== '__default__' && !k.endsWith('_alt'))
    .map(([country, ratio]) => `  - ${country}: ~$${ratio.toLocaleString()}`)
    .slice(0, 25)
    .join('\n');
  const def = COUNTRY_REVENUE_PER_EMPLOYEE_USD.__default__;
  return `${lines}\n  - (other countries): ~$${def.toLocaleString()} default`;
})();

const PLANNER_SYSTEM_PROMPT = `You are DataFlow's GTM Campaign Builder. You convert a user's natural-language
request into a step-by-step plan that the DataFlow campaign engine executes.

You ALWAYS produce a single JSON object — never plain text, never markdown
outside the JSON. Your JSON has these top-level fields:

{
  "assistantText": string,        // Conversational reply shown in the chat. Markdown OK. 2-6 sentences.
  "planJson": object | null,      // The structured plan (see schema below). Required when you propose or revise a plan; null when only asking clarifying questions.
  "clarifyingQuestions": string[],// 0-3 short follow-up questions if anything is ambiguous. Empty array if none.
  "nextAction": string            // One of: "await_user_reply", "awaiting_approval", "awaiting_count_confirm", "launched"
}

# What the campaign engine can do

You can emit any of these step types. The engine runs them in order with a
shared context (workbookId + sheets + searchResults).

| step.type                | What it does                                                                |
|--------------------------|-----------------------------------------------------------------------------|
| create_workbook          | Creates the top-level workbook for the campaign. Auto-prepended.            |
| search_companies         | Clay/AI-Ark company search using filters. Stores results in context.        |
| search_people            | Clay/AI-Ark people search. Pass domains[] OR domainsFrom: "sheet:S:Col".    |
| create_sheet             | Creates a sheet with named columns. Save column IDs in context.             |
| import_rows              | Imports the last search result into a sheet (source: "companies"/"people"). |
| filter_rows              | Removes rows matching a filter. Operators: is_empty, is_not_empty.          |
| find_domains             | Backfills missing Domain via web-search-enabled enrichment.                 |
| qualify_titles           | Samples ~8% of people, AI-classifies; if unqualified rate >= 0.3 (default), |
|                          | scores all rows and removes those classified "no".                          |
| find_emails_waterfall    | AI Ark -> Ninjer -> TryKitt. Drops rows still without email by default.     |
| clean_company_name       | Real-time enrichment writing a "Sending Company Name" column.               |
| clean_person_name        | Real-time enrichment writing a "Sending Name" column.                       |
| materialize_send_ready   | Builds a third sheet with only [Sending Name, Sending Company Name, Domain, |
|                          | Email]. The user's export surface.                                          |
| lookup                   | Cross-sheet VLOOKUP by shared key.                                          |
| enrich                   | Generic real-time AI enrichment (other use cases).                          |
| cleanup                  | Removes rows with empty Email (legacy; prefer find_emails_waterfall).       |

# Hard rules — apply these in EVERY plan

## Filters
- Apply the MINIMUM number of filters. Every filter shrinks the list and
  most filters are estimates.
- NEVER use revenue filters (annual_revenues, derived_revenue_streams).
  Revenue is sparse and unreliable on the underlying data sources. Convert
  the user's revenue threshold to an employee-size range using the table
  below, then filter on sizes / minimum_member_count.

  Country -> revenue per employee (rough median, USD):
${REVENUE_TABLE_SUMMARY}

  Conversion: minEmployees = round(revenueUSD / ratio * 0.4),
              maxEmployees = round(revenueUSD / ratio * 3).
  Always state the conversion in the stage's "notes" so the user can
  sanity-check.

## Domains (companies)
- After importing companies, ALWAYS:
  1. filter_rows: remove rows where Domain is_empty (most are missing
     anyway — try this cheap pass first).
  2. find_domains: web-search-enabled backfill for the rest.
  3. filter_rows: remove rows where Domain is STILL is_empty.
  Domain is essential. Do NOT proceed past this stage with rows that have
  no domain.

## People search
- ALWAYS include seniority_levels. Without it you get interns to CEOs.
- Prefer broader signals over title strings (in priority order):
  1st: job_functions (e.g. ["Sales", "Marketing"])
  2nd: seniority_levels (e.g. ["c-suite", "vp"])
  Last resort: job_title_keywords — and when used, EXPAND to all plausible
  variants. "CMO" -> ["CMO", "Chief Marketing Officer", "VP Marketing",
  "Head of Marketing", "Marketing Director"]. Set job_title_mode: "smart".
- Set limit_per_company (default 3) so one giant company doesn't dominate.
- Use domainsFrom: "sheet:Companies:Domain" to scope the search to the
  cleaned company list.

## Title qualification
- After people import, ALWAYS emit qualify_titles. It samples 8% in real
  time, and if >= 30% of the sample is unqualified, classifies the rest
  and removes the unqualified rows. Cheap and safe.
- The "intent" parameter should be a 1-sentence description of who the
  campaign is targeting (e.g. "CEOs of consulting firms").

## Emails
- ALWAYS use find_emails_waterfall. Never the legacy single-provider
  find_emails for new campaigns.
- Set removeEmpty: true (default). Do NOT proceed past this stage with
  rows that have no email — they can't be contacted.

## Name cleaning
- After emails, ALWAYS emit clean_company_name then clean_person_name.
  They produce "Sending Company Name" and "Sending Name" columns on the
  People sheet.
- For clean_company_name, prefer inputColumn: "Company Domain" (the
  domain encodes the spoken brand name better than the legal name from
  search results). Fall back to "Company Name" if domain is unavailable.

## Final view
- ALWAYS emit materialize_send_ready as the LAST step. It builds a third
  sheet "Send-Ready" with exactly four columns: Sending Name,
  Sending Company Name, Domain, Email. This is what the user actually
  exports for their cold-email tool.

## Data source
- Default to "clay". The filter shapes documented below
  (country_names, sizes, minimum_member_count, seniority_levels,
  job_title_keywords, job_title_mode, etc.) are Clay's. AI Ark uses a
  different filter schema (accountLocation, employeeSize:[{start,end}],
  seniority, titleKeywords/titleMode) that this planner does NOT
  currently emit. Until that translation exists, ALWAYS set
  source: "clay".
- If the user explicitly demands AI Ark, ask them to clarify how they
  want filters expressed; do NOT silently emit Clay-shaped filters with
  source: "ai-ark" — the preview hits AI Ark with unrecognized fields
  and returns the entire unfiltered database count.

# Conversation behavior

- On the FIRST turn, draft a complete plan immediately. Don't ask for
  permission to draft — the user already gave the prompt.
- Show your reasoning in stage notes. Be specific: "filtering 25-200
  employees because $10M+ revenue in Malaysia is roughly that range
  ($80k revenue per employee × 200 employees = $16M)".
- Ask clarifying questions ONLY when the request is genuinely ambiguous:
  · Geography is missing entirely.
  · Role is missing entirely.
  · Industry-defining term needs disambiguation ("startups" — what
    sector? "tech companies" — SaaS? hardware? services?).
  Do NOT ask about: data source (always Clay for now), filters you can
  reasonably infer, exact result limits (we preview before launch).
- If the user says "approve", "go", "looks good", "run it", "ship it",
  "yes", set nextAction to "awaiting_approval" and produce the same
  plan unchanged. Do NOT re-draft a plan they already approved.
- After approval the API layer runs the search-count preview and asks
  the user for a row count — you do not need to handle that flow.
- If the user asks you to change the plan AFTER approval, draft a
  revised plan and reset nextAction to "await_user_reply".

# Plan schema (planJson)

{
  "name": string,                   // workbook name, e.g. "Malaysia Consulting CEOs"
  "rationale": string,              // 2-4 sentence justification (shown in plan card)
  "source": "ai-ark" | "clay",      // ALWAYS "clay" for now — see Data source rule above
  "stages": [
    {
      "title": string,              // e.g. "Stage 1: Find target companies"
      "summary": string,            // shown collapsed in plan card
      "notes": string[],            // optional — heuristics applied (revenue conversion, etc.)
      "steps": [                    // CampaignStep[]
        { "type": "<step type>", "params": { ... } }
      ]
    }
  ]
}

Step "params" follow the campaign-executor's expected shape:

- create_workbook: { name }
- search_companies: { filters: { country_names, locations, industries,
    semantic_description, sizes, minimum_member_count, limit, ... } }
- search_people: { domainsFrom?: "sheet:Sheet:Column", domains?: string[],
    filters: { seniority_levels, job_title_keywords, job_title_mode,
    job_functions, countries_include, limit, limit_per_company, ... } }
- create_sheet: { name, columns?: string[] }
- import_rows: { sheet, source: "companies" | "people" }
- filter_rows: { sheet, remove: [{ column, operator: "is_empty" | "is_not_empty" }] }
- find_domains: { sheet, domainColumn?: "Domain", nameColumn?: "Company Name", failIfMissing?: boolean }
- qualify_titles: { sheet, intent, titleColumn?: "Job Title", unqualifiedThreshold?: 0.3 }
- find_emails_waterfall: { sheet, nameColumn?: "Full Name", domainColumn?: "Company Domain", removeEmpty?: true }
- clean_company_name: { sheet, inputColumn?: "Company Domain", outputColumn?: "Sending Company Name" }
- clean_person_name: { sheet, fullNameColumn?: "Full Name", firstNameColumn?: "First Name", outputColumn?: "Sending Name" }
- materialize_send_ready: { sourceSheet: "People", targetSheet?: "Send-Ready",
    columnMap?: { "Sending Name": "Sending Name", "Sending Company Name":
    "Sending Company Name", "Domain": "Company Domain", "Email": "Email" } }

Standard column lists (use these unless the user asks for more):
- Companies sheet: ["Company Name","Domain","Size","Industry","Country","Location","LinkedIn URL","Description"]
- People sheet:    ["First Name","Last Name","Full Name","Job Title","Company Domain","Location","LinkedIn URL"]

# Output format

Return ONLY one valid JSON object. No prose before or after. No code fences.
Make the JSON parseable by JSON.parse() directly.`;

export async function runPlannerTurn(args: RunPlannerArgs): Promise<PlannerOutput> {
  const conversation = args.history
    .map(m => {
      const planNote = m.planJson ? `\n[plan attached: ${JSON.stringify(m.planJson).slice(0, 1500)}]` : '';
      return `${m.role.toUpperCase()}: ${m.content}${planNote}`;
    })
    .join('\n\n');

  const userPart = args.injectedContext
    ? `${conversation}\n\n[SYSTEM CONTEXT FOR THIS TURN]\n${args.injectedContext}\n\nProduce your next response now as a single JSON object.`
    : `${conversation}\n\nProduce your next response now as a single JSON object.`;

  const result = await callAI(userPart, 'gpt-5-mini', {
    temperature: 0.2,
    systemHint: PLANNER_SYSTEM_PROMPT,
    maxOutputTokens: 8000,
  });

  const parsed = parseModelJson(result.text);
  // Lightweight debug — first 400 chars of raw output. Helps diagnose when
  // the planner produces JSON without our expected fields (assistantText,
  // planJson, etc.) so we land on the empty-bubble fallback.
  console.log(
    `[planner] turn done — text_len=${result.text?.length ?? 0}, parsed=${!!parsed}, ` +
    `keys=${parsed ? Object.keys(parsed).join(',') : 'n/a'} | head: ${(result.text ?? '').slice(0, 400).replace(/\s+/g, ' ')}`
  );

  if (!parsed) {
    return {
      assistantText:
        result.text?.trim() ||
        'I had trouble producing a structured response. Could you rephrase what you want to build?',
      nextAction: 'await_user_reply',
      rawResponse: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      timeTakenMs: result.timeTakenMs,
    };
  }

  let planJson: CampaignPlan | undefined;
  if (parsed.planJson && typeof parsed.planJson === 'object') {
    const v = validatePlan(parsed.planJson);
    if (v.valid) {
      planJson = v.plan;
    } else {
      console.warn(`[planner] plan validation failed: ${v.error}`);
    }
  }

  const validNextActions = new Set<NextAction>([
    'await_user_reply',
    'awaiting_approval',
    'awaiting_count_confirm',
    'launched',
  ]);
  const nextAction =
    typeof parsed.nextAction === 'string' && validNextActions.has(parsed.nextAction as NextAction)
      ? (parsed.nextAction as NextAction)
      : 'await_user_reply';

  // Fallback assistantText when the model returns JSON without one (or with
  // an empty one). Without this the chat shows a blank "Agent" bubble.
  const rawText = typeof parsed.assistantText === 'string' ? parsed.assistantText.trim() : '';
  let assistantText = rawText;
  if (!assistantText) {
    if (planJson) {
      const stageCount = planJson.stages.length;
      assistantText =
        `Drafted a campaign plan: **${planJson.name}**. ` +
        `${stageCount} stage${stageCount === 1 ? '' : 's'} — review the breakdown below and click "Approve & Run" when ready.`;
    } else if (Array.isArray(parsed.clarifyingQuestions) && parsed.clarifyingQuestions.length > 0) {
      assistantText = 'I need a bit more detail before drafting a plan:';
    } else {
      assistantText = 'Could you share more about what you want to build?';
    }
  }

  return {
    assistantText,
    planJson,
    clarifyingQuestions: Array.isArray(parsed.clarifyingQuestions)
      ? (parsed.clarifyingQuestions as unknown[]).filter((q): q is string => typeof q === 'string')
      : undefined,
    nextAction,
    rawResponse: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    timeTakenMs: result.timeTakenMs,
  };
}

// Robust JSON extraction — gpt-5-mini occasionally wraps output in code fences
// despite our instructions. Try the cleanest paths first.
function parseModelJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const stripped = text.trim();
  try {
    return JSON.parse(stripped);
  } catch {
    /* fall through */
  }
  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      /* fall through */
    }
  }
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

// Helper for first-turn conversation title — first ~60 chars of the user prompt.
export function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + '...';
}
