// Tool definitions + dispatcher for Spider.Cloud web search during real-time enrichment.
// Two output shapes: Chat Completions (`tools[].function.{name,description,parameters}`)
// and Responses API (flat `{type, name, description, parameters}`).

import { spiderSearch, spiderScrape, type SpiderSearchResult } from './spider';

interface JSONSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

interface ChatToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaObject;
  };
}

interface ResponsesToolDef {
  type: 'function';
  name: string;
  description: string;
  parameters: JSONSchemaObject;
}

const SEARCH_PARAMS: JSONSchemaObject = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query in plain English. Be specific and concise.',
    },
    limit: {
      type: 'integer',
      description: 'Max results to return. Use 3 for simple lookups (find a website, find a single fact). Use 5 only when comparing or researching. Maximum 10. Default 3.',
    },
  },
  required: ['query'],
};

const SCRAPE_PARAMS: JSONSchemaObject = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'Absolute https URL to fetch.' },
  },
  required: ['url'],
};

const SEARCH_DESC =
  'Search the live web via Spider.Cloud. Each search costs credits — be efficient. ' +
  'Use the SMALLEST `limit` that will answer the question (3 for simple lookups, up to 10 for broad research). ' +
  'Prefer ONE well-formed search over multiple narrow ones. ' +
  'Returned items have title/url/description; the description is usually enough to answer. ' +
  'Do NOT call this multiple times with similar queries — refine the first query instead.';

const SCRAPE_DESC =
  'Fetch ONE URL as markdown when the search result description is not enough. ' +
  'Each scrape costs credits — only use when you genuinely need page body content (full article text, structured data on the page). ' +
  'Do not scrape more than one URL per row. Do not scrape if the search description already contains the answer.';

export const WEB_SEARCH_TOOLS: {
  chat: ChatToolDef[];
  responses: ResponsesToolDef[];
} = {
  chat: [
    { type: 'function', function: { name: 'search_web', description: SEARCH_DESC, parameters: SEARCH_PARAMS } },
    { type: 'function', function: { name: 'scrape_url', description: SCRAPE_DESC, parameters: SCRAPE_PARAMS } },
  ],
  responses: [
    { type: 'function', name: 'search_web', description: SEARCH_DESC, parameters: SEARCH_PARAMS },
    { type: 'function', name: 'scrape_url', description: SCRAPE_DESC, parameters: SCRAPE_PARAMS },
  ],
};

// Maximum characters of tool-result text we feed back to the model. Keeps a
// single tool round-trip from blowing past the context window AND keeps input
// token cost bounded — every char here is repaid in input tokens on every
// subsequent round of the loop.
const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_RESULT_CONTENT_CHARS = 700;

function trimContent(s: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n[...truncated ${s.length - max} chars]`;
}

// Compact each search result down to fields the model actually needs.
function compactResult(r: SpiderSearchResult): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof r.title === 'string') out.title = r.title;
  if (typeof r.url === 'string') out.url = r.url;
  if (typeof r.description === 'string') out.description = r.description;
  if (typeof r.content === 'string' && r.content.length > 0) {
    out.content = r.content.slice(0, MAX_RESULT_CONTENT_CHARS);
  }
  return out;
}

// Drop duplicates (Spider sometimes returns the same URL multiple times) and
// remove items with no useful content fields.
function dedupeResults(items: Array<Record<string, string>>): Array<Record<string, string>> {
  const seen = new Set<string>();
  const out: Array<Record<string, string>> = [];
  for (const r of items) {
    if (!r.url && !r.title && !r.description) continue;
    const key = (r.url || r.title || '').trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(r);
  }
  return out;
}

export interface ToolCallResult {
  content: string;
  costUsd: number;
}

export async function dispatchToolCall(name: string, argsJson: string): Promise<ToolCallResult> {
  let args: Record<string, unknown> = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; }
  catch {
    return { content: JSON.stringify({ error: 'invalid_arguments_json', got: argsJson?.slice(0, 200) }), costUsd: 0 };
  }

  try {
    if (name === 'search_web') {
      const query = String(args.query ?? '').trim();
      if (!query) {
        return { content: JSON.stringify({ error: 'missing_query' }), costUsd: 0 };
      }
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, Math.floor(limitRaw))) : 3;

      const { results, costUsd } = await spiderSearch({ query, limit });
      const compact = dedupeResults(results.map(compactResult));
      const payload = { query, results: compact };
      return { content: trimContent(JSON.stringify(payload)), costUsd };
    }

    if (name === 'scrape_url') {
      const url = String(args.url ?? '').trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        return { content: JSON.stringify({ error: 'invalid_url', got: url }), costUsd: 0 };
      }
      const { content, costUsd } = await spiderScrape({ url, returnFormat: 'markdown' });
      const payload = { url, content: trimContent(content) };
      return { content: trimContent(JSON.stringify(payload)), costUsd };
    }

    return { content: JSON.stringify({ error: 'unknown_tool', name }), costUsd: 0 };
  } catch (err) {
    return {
      content: JSON.stringify({ error: 'tool_error', message: (err as Error).message?.slice(0, 300) }),
      costUsd: 0,
    };
  }
}

export const WEB_SEARCH_SYSTEM_HINT =
  'Web search is ENABLED for this task. You have two tools: search_web(query, limit?) and scrape_url(url).\n\n' +
  'RULES:\n' +
  '1. You MUST call search_web at least once before answering. Do not answer from prior knowledge — the user enabled this tool because they want fresh data.\n' +
  '2. Be efficient. ONE well-formed search is almost always enough. Use the search-result `description` to answer; only call scrape_url if you need the full page body.\n' +
  '3. Pick the smallest `limit` that fits the task: 3 for "find the website / find a fact", up to 10 only for "research / compare / list".\n' +
  '4. Do not loop. After 1-2 tool calls you should have enough to answer. Do not re-search with similar queries.\n' +
  '5. Return ONLY the requested output format. Do not narrate the search process in the final answer.';
