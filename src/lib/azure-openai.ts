// Azure OpenAI Service client module
// Mirrors the vertex-ai.ts pattern for consistency

interface AzureConfig {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
}

let azureConfig: AzureConfig | null = null;

export function getAzureConfig(): AzureConfig {
  if (azureConfig) {
    return azureConfig;
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

  if (!endpoint || !apiKey) {
    throw new Error('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY environment variables are required');
  }

  // Ensure endpoint doesn't have trailing slash
  const cleanEndpoint = endpoint.replace(/\/$/, '');

  azureConfig = { endpoint: cleanEndpoint, apiKey, apiVersion };
  return azureConfig;
}

// Map model names to Azure deployment names
// Users can override these via environment variables
const DEFAULT_DEPLOYMENT_MAP: Record<string, string> = {
  // Azure OpenAI models
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-5': 'gpt-5',
  'gpt-4.1-mini': 'gpt-4.1-mini',
  'gpt-5-mini': 'gpt-5-mini',
  'gpt-5-nano': 'gpt-5-nano',
  'gpt-5-turbo': 'gpt-5-turbo',
  // DeepSeek models (deployed on Azure AI Foundry)
  'deepseek-chat': 'deepseek-chat',
  'deepseek-reasoner': 'deepseek-reasoner',
};

// GPT-5 models use max_completion_tokens instead of max_tokens
function isGpt5Model(modelId: string): boolean {
  return modelId.startsWith('gpt-5');
}

// GPT-5-mini uses the Responses API (different endpoint format)
function isResponsesApiModel(modelId: string): boolean {
  return modelId === 'gpt-5-mini';
}

// GPT-5 models require a newer API version
function getApiVersionForModel(modelId: string, defaultVersion: string): string {
  // gpt-5-mini uses Responses API
  if (modelId === 'gpt-5-mini') {
    return '2025-04-01-preview';
  }
  // gpt-5-nano uses a specific API version
  if (modelId === 'gpt-5-nano') {
    return '2025-01-01-preview';
  }
  if (isGpt5Model(modelId)) {
    return '2024-12-01-preview';
  }
  return defaultVersion;
}

// Get endpoint and API key for specific model (some models use different Azure resources)
function getModelEndpoint(modelId: string, defaultConfig: AzureConfig): { endpoint: string; apiKey: string } {
  // gpt-5-nano uses a separate Azure resource
  if (modelId === 'gpt-5-nano') {
    const nanoEndpoint = process.env.AZURE_GPT5_NANO_ENDPOINT;
    const nanoApiKey = process.env.AZURE_GPT5_NANO_API_KEY;
    if (nanoEndpoint && nanoApiKey) {
      return {
        endpoint: nanoEndpoint.replace(/\/$/, '').trim(),
        apiKey: nanoApiKey.trim(),
      };
    }
  }
  return { endpoint: defaultConfig.endpoint, apiKey: defaultConfig.apiKey };
}

export function getDeploymentName(modelId: string): string {
  // Check for custom deployment name in env (e.g., AZURE_DEPLOYMENT_GPT_4O)
  const envKey = `AZURE_DEPLOYMENT_${modelId.toUpperCase().replace(/-/g, '_')}`;
  const customDeployment = process.env[envKey];
  if (customDeployment) {
    return customDeployment;
  }

  return DEFAULT_DEPLOYMENT_MAP[modelId] || modelId;
}

// Tool-calling types — kept loose since both Chat Completions and Responses
// API accept slightly different shapes.
type ChatToolDef = { type: 'function'; function: { name: string; description: string; parameters: unknown } };
type ResponsesToolDef = { type: 'function'; name: string; description: string; parameters: unknown };

export interface AzureToolBundle {
  chat: ChatToolDef[];
  responses: ResponsesToolDef[];
}

export type ToolDispatcher = (
  name: string,
  argsJson: string,
) => Promise<{ content: string; costUsd: number }>;

export interface AzureGenerationConfig {
  temperature?: number;
  maxTokens?: number;
  tools?: AzureToolBundle;
  toolDispatcher?: ToolDispatcher;
  systemHint?: string;
}

export interface AzureAIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  timeTakenMs: number;
  toolCost?: number;
  toolCallCount?: number;
}

// Hard ceiling on tool-call rounds per generation. Keeps costs bounded.
// 3 = (forced search) → (optional follow-up search/scrape) → (final answer).
const MAX_TOOL_ROUNDS = 3;
// Soft time budget for the whole tool-call loop. The outer caller wraps with
// a 90s hard timeout when tools are enabled; we stop dispatching new tool
// calls past this soft mark to leave headroom for the final answer.
const SOFT_TIME_BUDGET_MS = 75000;

export async function generateContent(
  modelId: string,
  prompt: string,
  config: AzureGenerationConfig = {}
): Promise<AzureAIResult> {
  const startTime = Date.now();
  const azureConf = getAzureConfig();
  const deploymentName = getDeploymentName(modelId);
  const apiVersion = getApiVersionForModel(modelId, azureConf.apiVersion);
  const { endpoint, apiKey } = getModelEndpoint(modelId, azureConf);

  const useResponsesApi = isResponsesApiModel(modelId);
  const hasTools = !!(config.tools && config.toolDispatcher);

  if (useResponsesApi) {
    return generateViaResponsesApi({
      endpoint, apiKey, apiVersion, deploymentName, modelId, prompt, config, hasTools, startTime,
    });
  }

  return generateViaChatCompletions({
    endpoint, apiKey, apiVersion, deploymentName, modelId, prompt, config, hasTools, startTime,
  });
}

// ─── Chat Completions path (gpt-4o, gpt-5, gpt-5-nano, gpt-5-turbo, deepseek-*) ───

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

async function generateViaChatCompletions(args: {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deploymentName: string;
  modelId: string;
  prompt: string;
  config: AzureGenerationConfig;
  hasTools: boolean;
  startTime: number;
}): Promise<AzureAIResult> {
  const { endpoint, apiKey, apiVersion, deploymentName, modelId, prompt, config, hasTools, startTime } = args;
  const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  const isGpt5 = isGpt5Model(modelId);
  const tokenParam = isGpt5
    ? { max_completion_tokens: config.maxTokens ?? 8192 }
    : { max_tokens: config.maxTokens ?? 8192 };

  const messages: ChatMessage[] = [];
  if (hasTools && config.systemHint) {
    messages.push({ role: 'system', content: config.systemHint });
  }
  messages.push({ role: 'user', content: prompt });

  let totalIn = 0;
  let totalOut = 0;
  let toolCost = 0;
  let toolCallCount = 0;
  let lastText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    const elapsed = Date.now() - startTime;
    const overBudget = elapsed > SOFT_TIME_BUDGET_MS;

    const requestBody: Record<string, unknown> = {
      messages,
      ...tokenParam,
    };
    if (!isGpt5) requestBody.temperature = config.temperature ?? 0.7;

    if (hasTools && !overBudget && round < MAX_TOOL_ROUNDS) {
      requestBody.tools = config.tools!.chat;
      // Round 0: force the model to call a tool — this is the whole point of
      // enabling web search. Round 1+: let the model decide whether it has
      // enough info to answer.
      requestBody.tool_choice = round === 0 ? 'required' : 'auto';
    } else if (hasTools && (overBudget || round === MAX_TOOL_ROUNDS)) {
      // Wrap-up round: must include tools alongside tool_choice — Azure
      // rejects `tool_choice` when `tools` is missing.
      requestBody.tools = config.tools!.chat;
      requestBody.tool_choice = 'none';
    }

    console.log(
      `[azure] chat req — model=${modelId}, round=${round}, hasTools=${hasTools}, ` +
      `tool_choice=${requestBody.tool_choice ?? 'n/a'}, msgCount=${messages.length}`
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as { error?: { message?: string } }).error?.message
        || `Azure OpenAI error: ${response.status}`;
      console.error(`[azure] chat error — model=${modelId}, round=${round}, status=${response.status}, msg=${errorMessage}`);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    totalIn += data.usage?.prompt_tokens ?? 0;
    totalOut += data.usage?.completion_tokens ?? 0;

    const choice = data.choices?.[0];
    const msg = choice?.message;
    const finishReason = choice?.finish_reason;
    lastText = msg?.content ?? '';

    const toolCalls = msg?.tool_calls;
    if (hasTools && Array.isArray(toolCalls) && toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
      // Push the assistant message with tool_calls verbatim, then dispatch each call
      // and append role:'tool' messages keyed by tool_call_id.
      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        toolCallCount++;
        try {
          const r = await config.toolDispatcher!(tc.function.name, tc.function.arguments ?? '{}');
          toolCost += r.costUsd;
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: r.content,
          });
        } catch (err) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: 'dispatch_failed', message: (err as Error).message?.slice(0, 200) }),
          });
        }
      }
      continue;
    }

    // No tool calls — done.
    console.log(
      `[azure] Chat Completions done — model=${modelId}, rounds=${round + 1}, in=${totalIn}, out=${totalOut}, ` +
      `toolCalls=${toolCallCount}, toolCost=$${toolCost.toFixed(5)}, finish=${finishReason}, text_len=${lastText.length}`
    );
    break;
  }

  return {
    text: lastText,
    inputTokens: totalIn,
    outputTokens: totalOut,
    timeTakenMs: Date.now() - startTime,
    toolCost,
    toolCallCount,
  };
}

// ─── Responses API path (gpt-5-mini) ───
// Uses /openai/responses with `input` array, `tools`, and `previous_response_id`
// to thread state across tool round-trips. We don't pass `previous_response_id`
// — instead we resend the full input list each round, since Azure's preview
// versioning of stored responses varies. Token usage is summed across rounds.

interface ResponsesInputMessage {
  type: 'message';
  role: 'system' | 'user' | 'assistant';
  content: Array<{ type: 'input_text' | 'output_text'; text: string }>;
}

interface ResponsesFunctionCall {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponsesFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

type ResponsesInputItem = ResponsesInputMessage | ResponsesFunctionCall | ResponsesFunctionCallOutput;

async function generateViaResponsesApi(args: {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deploymentName: string;
  modelId: string;
  prompt: string;
  config: AzureGenerationConfig;
  hasTools: boolean;
  startTime: number;
}): Promise<AzureAIResult> {
  const { endpoint, apiKey, apiVersion, deploymentName, modelId, prompt, config, hasTools, startTime } = args;
  const url = `${endpoint}/openai/responses?api-version=${apiVersion}`;

  const input: ResponsesInputItem[] = [];
  if (hasTools && config.systemHint) {
    input.push({
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: config.systemHint }],
    });
  }
  input.push({
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: prompt }],
  });

  let totalIn = 0;
  let totalOut = 0;
  let toolCost = 0;
  let toolCallCount = 0;
  let lastText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    const elapsed = Date.now() - startTime;
    const overBudget = elapsed > SOFT_TIME_BUDGET_MS;

    const requestBody: Record<string, unknown> = {
      model: deploymentName,
      input,
      max_output_tokens: config.maxTokens ?? 8192,
    };

    if (hasTools && !overBudget && round < MAX_TOOL_ROUNDS) {
      requestBody.tools = config.tools!.responses;
      // See chat path for rationale: force a tool call on round 0.
      requestBody.tool_choice = round === 0 ? 'required' : 'auto';
    } else if (hasTools && (overBudget || round === MAX_TOOL_ROUNDS)) {
      // Wrap-up round must keep tools alongside tool_choice.
      requestBody.tools = config.tools!.responses;
      requestBody.tool_choice = 'none';
    }

    console.log(
      `[azure] responses req — model=${modelId}, round=${round}, hasTools=${hasTools}, ` +
      `tool_choice=${requestBody.tool_choice ?? 'n/a'}, inputLen=${input.length}`
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as { error?: { message?: string } }).error?.message
        || `Azure OpenAI error: ${response.status}`;
      console.error(`[azure] responses error — model=${modelId}, round=${round}, status=${response.status}, msg=${errorMessage}`);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    totalIn += data.usage?.input_tokens ?? 0;
    totalOut += data.usage?.output_tokens ?? 0;

    // Pull text + function calls out of `output[]`.
    const output: Array<Record<string, unknown>> = Array.isArray(data.output) ? data.output : [];
    const functionCalls: ResponsesFunctionCall[] = [];
    let textPieces: string[] = [];

    for (const item of output) {
      const t = item.type;
      if (t === 'function_call') {
        functionCalls.push({
          type: 'function_call',
          call_id: String(item.call_id ?? item.id ?? ''),
          name: String(item.name ?? ''),
          arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
        });
      } else if (t === 'message') {
        const content = (item as { content?: Array<{ type?: string; text?: string }> }).content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c?.type === 'output_text' && typeof c.text === 'string') textPieces.push(c.text);
          }
        }
      }
    }

    // Fallback for top-level `output_text` shorthand some versions return.
    if (textPieces.length === 0 && typeof data.output_text === 'string') {
      textPieces.push(data.output_text);
    }
    lastText = textPieces.join('');

    if (hasTools && functionCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
      // Echo the model's function_call items, then append matching outputs.
      for (const fc of functionCalls) {
        input.push(fc);
      }
      for (const fc of functionCalls) {
        toolCallCount++;
        try {
          const r = await config.toolDispatcher!(fc.name, fc.arguments ?? '{}');
          toolCost += r.costUsd;
          input.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: r.content,
          });
        } catch (err) {
          input.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: JSON.stringify({ error: 'dispatch_failed', message: (err as Error).message?.slice(0, 200) }),
          });
        }
      }
      continue;
    }

    console.log(
      `[azure] Responses API done — model=${modelId}, rounds=${round + 1}, in=${totalIn}, out=${totalOut}, ` +
      `toolCalls=${toolCallCount}, toolCost=$${toolCost.toFixed(5)}, text_len=${lastText.length}`
    );
    break;
  }

  return {
    text: lastText,
    inputTokens: totalIn,
    outputTokens: totalOut,
    timeTakenMs: Date.now() - startTime,
    toolCost,
    toolCallCount,
  };
}

// Check if Azure OpenAI is configured
export function isConfigured(): boolean {
  return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}
