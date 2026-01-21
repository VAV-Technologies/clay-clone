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
  'gpt-5-mini': 'gpt-5-mini',
  'gpt-5-turbo': 'gpt-5-turbo',
  // DeepSeek models (deployed on Azure AI Foundry)
  'deepseek-chat': 'deepseek-chat',
  'deepseek-reasoner': 'deepseek-reasoner',
};

// GPT-5 models use max_completion_tokens instead of max_tokens
function isGpt5Model(modelId: string): boolean {
  return modelId.startsWith('gpt-5');
}

// GPT-5 models require a newer API version
function getApiVersionForModel(modelId: string, defaultVersion: string): string {
  if (isGpt5Model(modelId)) {
    return '2025-01-01-preview';
  }
  return defaultVersion;
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

export interface AzureGenerationConfig {
  temperature?: number;
  maxTokens?: number;
}

export interface AzureAIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function generateContent(
  modelId: string,
  prompt: string,
  config: AzureGenerationConfig = {}
): Promise<AzureAIResult> {
  const azureConf = getAzureConfig();
  const deploymentName = getDeploymentName(modelId);
  const apiVersion = getApiVersionForModel(modelId, azureConf.apiVersion);

  const url = `${azureConf.endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

  // GPT-5 models use max_completion_tokens, older models use max_tokens
  const tokenParam = isGpt5Model(modelId)
    ? { max_completion_tokens: config.maxTokens ?? 8192 }
    : { max_tokens: config.maxTokens ?? 8192 };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': azureConf.apiKey,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: config.temperature ?? 0.7,
      ...tokenParam,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || `Azure OpenAI error: ${response.status}`;
    throw new Error(errorMessage);
  }

  const data = await response.json();

  return {
    text: data.choices?.[0]?.message?.content || '',
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// Check if Azure OpenAI is configured
export function isConfigured(): boolean {
  return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}
