// Unified AI Provider Interface
// Abstracts Google (Vertex AI / Gemini) and Azure OpenAI behind a common interface

export interface AIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  timeTakenMs: number;
}

export interface AIGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
}

export type AIProvider = 'google' | 'azure';

// Model pricing per 1M tokens
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Google Gemini models
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-lite-001': { input: 0.075, output: 0.30 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-flash-lite': { input: 0.075, output: 0.30 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  // Azure OpenAI models
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-5': { input: 5.00, output: 15.00 },       // Estimated pricing
  'gpt-4.1-mini': { input: 0.15, output: 0.60 },  // GPT-4.1 Mini pricing
  'gpt-5-mini': { input: 0.30, output: 1.20 },   // Estimated pricing
  'gpt-5-turbo': { input: 3.00, output: 10.00 }, // Estimated pricing
  // DeepSeek models
  'deepseek-chat': { input: 0.56, output: 1.68 },
  'deepseek-reasoner': { input: 0.56, output: 1.68 },
};

export const DEFAULT_PRICING = { input: 0.15, output: 0.60 };

// Determine provider from model name
// Note: DeepSeek models are deployed on Azure AI Foundry, so they route to 'azure'
export function getProviderFromModel(modelId: string): AIProvider {
  if (modelId.startsWith('gpt-') || modelId.startsWith('deepseek-')) {
    return 'azure';
  }
  return 'google';
}

// Check if Azure is configured
export function isAzureConfigured(): boolean {
  return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}

// Check if Google is configured (either Vertex AI or Gemini API)
export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.GEMINI_API_KEY);
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

// Rate limiting settings per provider
export function getProviderRateLimits(provider: AIProvider): {
  concurrentRequests: number;
  delayBetweenChunks: number;
} {
  if (provider === 'azure') {
    // Azure OpenAI: 150K TPM / 150 RPM limits
    // 75 concurrent = safe burst under 150 RPM limit
    return {
      concurrentRequests: 75,
      delayBetweenChunks: 0,
    };
  }
  // Google Vertex AI
  return {
    concurrentRequests: 10,
    delayBetweenChunks: 200, // ms
  };
}

// Unified AI call - main entry point
export async function callAI(
  prompt: string,
  modelId: string,
  config: AIGenerationConfig = {}
): Promise<AIResult> {
  const provider = getProviderFromModel(modelId);
  const startTime = Date.now();

  if (provider === 'azure') {
    // Azure handles both GPT models and DeepSeek models (via Azure AI Foundry)
    if (!isAzureConfigured()) {
      throw new Error(
        'Azure OpenAI not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY environment variables.'
      );
    }

    const { generateContent } = await import('./azure-openai');
    return generateContent(modelId, prompt, {
      temperature: config.temperature,
      maxTokens: config.maxOutputTokens,
    });
  }

  // Google provider (Vertex AI or Gemini API)
  if (!isGoogleConfigured()) {
    throw new Error(
      'Google AI not configured. Set GOOGLE_CLOUD_PROJECT or GEMINI_API_KEY environment variable.'
    );
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const apiKey = process.env.GEMINI_API_KEY;

  if (projectId) {
    // Use Vertex AI (preferred for production)
    const { getGenerativeModel } = await import('./vertex-ai');
    const model = getGenerativeModel(modelId, {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    });

    const result = await model.generateContent(prompt);
    const timeTakenMs = Date.now() - startTime;
    const response = result.response;
    const usageMetadata = response.usageMetadata;

    return {
      text: response.candidates?.[0]?.content?.parts?.[0]?.text || '',
      inputTokens: usageMetadata?.promptTokenCount ?? 0,
      outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
      timeTakenMs,
    };
  }

  // Use Gemini API directly (fallback)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxOutputTokens ?? 8192,
      },
    }),
  });

  const timeTakenMs = Date.now() - startTime;

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    timeTakenMs,
  };
}
