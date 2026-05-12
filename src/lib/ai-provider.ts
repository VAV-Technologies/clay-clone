// Unified AI Provider Interface — Azure OpenAI only

import type { AzureToolBundle, ToolDispatcher } from './azure-openai';

export interface AIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  timeTakenMs: number;
  toolCost?: number;
  toolCallCount?: number;
}

export interface AIGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  tools?: AzureToolBundle;
  toolDispatcher?: ToolDispatcher;
  systemHint?: string;
}

// Model pricing per 1M tokens
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Azure OpenAI models
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-5': { input: 5.00, output: 15.00 },
  'gpt-4.1-mini': { input: 0.15, output: 0.60 },
  'gpt-5-mini': { input: 0.30, output: 1.20 },
  'gpt-5-nano': { input: 0.10, output: 0.40 },
  'gpt-5-turbo': { input: 3.00, output: 10.00 },
  // DeepSeek models (deployed on Azure AI Foundry)
  'deepseek-chat': { input: 0.56, output: 1.68 },
  'deepseek-reasoner': { input: 0.56, output: 1.68 },
  // Anthropic models (called directly via @anthropic-ai/sdk)
  'claude-opus-4-7': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
};

export function isClaudeModel(modelId: string): boolean {
  return modelId.startsWith('claude-');
}

export const DEFAULT_PRICING = { input: 0.15, output: 0.60 };

// Check if Azure is configured
export function isAzureConfigured(): boolean {
  return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}

// Get pricing for a model
export function getModelPricing(modelId: string): { input: number; output: number } {
  return MODEL_PRICING[modelId] || DEFAULT_PRICING;
}

// Calculate cost from token usage
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getModelPricing(modelId);
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// Rate limiting settings per model
export function getProviderRateLimits(modelId?: string): {
  concurrentRequests: number;
  delayBetweenChunks: number;
} {
  if (modelId === 'gpt-5-nano') {
    return { concurrentRequests: 500, delayBetweenChunks: 0 };
  }
  if (modelId === 'gpt-5-mini') {
    return { concurrentRequests: 150, delayBetweenChunks: 0 };
  }
  return { concurrentRequests: 75, delayBetweenChunks: 0 };
}

// Unified AI call — main entry point
export async function callAI(
  prompt: string,
  modelId: string,
  config: AIGenerationConfig = {}
): Promise<AIResult> {
  if (isClaudeModel(modelId)) {
    const { generateContentAnthropic } = await import('./anthropic-provider');
    return generateContentAnthropic(modelId, prompt, config);
  }

  if (!isAzureConfigured()) {
    throw new Error(
      'Azure OpenAI not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY environment variables.'
    );
  }

  const { generateContent } = await import('./azure-openai');
  return generateContent(modelId, prompt, {
    temperature: config.temperature,
    maxTokens: config.maxOutputTokens,
    tools: config.tools,
    toolDispatcher: config.toolDispatcher,
    systemHint: config.systemHint,
  });
}
