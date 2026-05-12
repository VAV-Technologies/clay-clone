// Anthropic provider for callAI — mirrors azure-openai.ts:generateContent
// for the no-tools planner path. The DataFlow Campaign Builder planner
// does a single structured-JSON completion per turn, so we only need to
// implement: system + user prompt -> text + token counts.
//
// Tools/function-calling aren't wired here. If a future caller passes
// `tools`, we throw loudly rather than silently dropping them.
//
// Provider selection: src/lib/ai-provider.ts:callAI dispatches here when
// modelId.startsWith('claude-'). Recommended default for planner: claude-sonnet-4-6.

import Anthropic from '@anthropic-ai/sdk';
import type { AIResult, AIGenerationConfig } from './ai-provider';

export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Anthropic not configured. Set ANTHROPIC_API_KEY to call claude-* models.'
      );
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

export async function generateContentAnthropic(
  modelId: string,
  prompt: string,
  config: AIGenerationConfig = {}
): Promise<AIResult> {
  if (config.tools) {
    throw new Error(
      'anthropic-provider: tool calls are not implemented yet. Use the Azure path or extend this provider.'
    );
  }

  const startTime = Date.now();
  const client = getClient();

  const response = await client.messages.create({
    model: modelId,
    max_tokens: config.maxOutputTokens ?? 4096,
    temperature: config.temperature ?? 0.2,
    system: config.systemHint,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    timeTakenMs: Date.now() - startTime,
  };
}
