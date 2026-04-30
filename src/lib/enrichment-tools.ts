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
    query: { type: 'string', description: 'Search query in plain English. Be specific.' },
    limit: { type: 'integer', description: 'Max results to return (1-10). Default 5.' },
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
  'Search the public web via Spider.Cloud and return a list of results. Use when the prompt mentions current events, recent data, news, or anything past the model\'s knowledge cutoff. Prefer one focused search per row.';

const SCRAPE_DESC =
  'Fetch the body of a single URL as markdown. Use only after search_web when one specific result needs full content. Avoid scraping more than one URL per row.';

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
// single tool round-trip from blowing past the context window.
const MAX_TOOL_RESULT_CHARS = 12000;

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
    out.content = r.content.slice(0, 1500);
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
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, Math.floor(limitRaw))) : 5;

      const { results, costUsd } = await spiderSearch({ query, limit });
      const compact = results.map(compactResult);
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
  'You have two tools: search_web(query, limit?) and scrape_url(url). ' +
  'Use them to research live information when the prompt asks for recent or current data. ' +
  'Prefer ONE focused search; only scrape a URL when a search result needs full body content. ' +
  'After research, answer in the requested format.';
