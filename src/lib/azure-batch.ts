// Azure OpenAI Batch API Module
// For bulk processing with 50% cheaper batch pricing
// Jobs may take 1-24 hours to complete

const API_VERSION = '2024-10-21';

// Hardcoded Azure Batch API config (dedicated for batch processing)
const BATCH_CONFIG = {
  endpoint: 'https://mama-mkof4van-eastus2.services.ai.azure.com/api/projects/mama-mkof4van-eastus2_project',
  apiKey: 'EAUz04QAIN1DxUG2MijyS0k1ZuPgDbLIIQhk1irZooGRBp3LJCQmJQQJ99CAACHYHv6XJ3w3AAAAACOGzQm5',
  deployment: 'gpt-5-mini-2',
};

function getBatchConfig() {
  return BATCH_CONFIG;
}

export interface BatchRequestLine {
  custom_id: string;
  method: 'POST';
  url: '/v1/chat/completions';
  body: {
    model: string;
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
    max_completion_tokens?: number;
  };
}

export interface BatchJobResponse {
  id: string;
  object: 'batch';
  endpoint: string;
  input_file_id: string;
  completion_window: string;
  status: 'validating' | 'in_progress' | 'finalizing' | 'completed' | 'failed' | 'expired' | 'cancelling' | 'cancelled';
  output_file_id?: string;
  error_file_id?: string;
  created_at: number;
  in_progress_at?: number;
  expires_at?: number;
  finalizing_at?: number;
  completed_at?: number;
  failed_at?: number;
  expired_at?: number;
  cancelling_at?: number;
  cancelled_at?: number;
  request_counts?: {
    total: number;
    completed: number;
    failed: number;
  };
  metadata?: Record<string, string>;
  errors?: {
    object: 'list';
    data: Array<{
      code: string;
      message: string;
      param?: string;
      line?: number;
    }>;
  };
}

export interface BatchResultLine {
  id: string;
  custom_id: string;
  response?: {
    status_code: number;
    request_id: string;
    body: {
      id: string;
      object: 'chat.completion';
      created: number;
      model: string;
      choices: Array<{
        index: number;
        message: {
          role: 'assistant';
          content: string;
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface FileUploadResponse {
  id: string;
  object: 'file';
  bytes: number;
  created_at: number;
  filename: string;
  purpose: 'batch' | 'batch_output';
  status: 'uploaded' | 'pending' | 'running' | 'processed' | 'error' | 'deleting' | 'deleted';
  status_details?: string;
}

/**
 * Generate JSONL content for batch processing
 */
export function generateBatchJSONL(
  rows: Array<{ rowId: string; prompt: string }>,
  maxCompletionTokens: number = 8192
): { content: string; mappings: Array<{ rowId: string; customId: string }> } {
  const mappings: Array<{ rowId: string; customId: string }> = [];
  const lines: string[] = [];

  for (const row of rows) {
    const customId = `row-${row.rowId}`;
    mappings.push({ rowId: row.rowId, customId });

    const requestLine: BatchRequestLine = {
      custom_id: customId,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: BATCH_CONFIG.deployment,
        messages: [{ role: 'user', content: row.prompt }],
        max_completion_tokens: maxCompletionTokens,
      },
    };

    lines.push(JSON.stringify(requestLine));
  }

  return {
    content: lines.join('\n'),
    mappings,
  };
}

/**
 * Upload a batch file to Azure
 */
export async function uploadBatchFile(
  jsonlContent: string,
  filename: string = 'batch_input.jsonl'
): Promise<FileUploadResponse> {
  const config = getBatchConfig();
  const url = `${config.endpoint}/openai/files?api-version=${API_VERSION}`;

  // Create form data with the file
  const formData = new FormData();
  const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
  formData.append('file', blob, filename);
  formData.append('purpose', 'batch');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': config.apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to upload batch file: ${response.status}`);
  }

  return response.json();
}

/**
 * Create a batch job
 */
export async function createBatchJob(
  inputFileId: string,
  metadata?: Record<string, string>
): Promise<BatchJobResponse> {
  const config = getBatchConfig();
  const url = `${config.endpoint}/openai/batches?api-version=${API_VERSION}`;

  const body: Record<string, unknown> = {
    input_file_id: inputFileId,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
  };

  if (metadata) {
    body.metadata = metadata;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to create batch job: ${response.status}`);
  }

  return response.json();
}

/**
 * Get batch job status
 */
export async function getBatchStatus(batchId: string): Promise<BatchJobResponse> {
  const config = getBatchConfig();
  const url = `${config.endpoint}/openai/batches/${batchId}?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'api-key': config.apiKey,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to get batch status: ${response.status}`);
  }

  return response.json();
}

/**
 * Download batch results (JSONL file)
 */
export async function downloadBatchResults(fileId: string): Promise<string> {
  const config = getBatchConfig();
  const url = `${config.endpoint}/openai/files/${fileId}/content?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'api-key': config.apiKey,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to download batch results: ${response.status}`);
  }

  return response.text();
}

/**
 * Parse batch results JSONL content
 */
export function parseBatchResults(jsonlContent: string): BatchResultLine[] {
  const lines = jsonlContent.trim().split('\n');
  const results: BatchResultLine[] = [];

  for (const line of lines) {
    if (line.trim()) {
      try {
        results.push(JSON.parse(line));
      } catch (e) {
        console.error('Failed to parse batch result line:', e);
      }
    }
  }

  return results;
}

/**
 * Cancel a running batch job
 */
export async function cancelBatchJob(batchId: string): Promise<BatchJobResponse> {
  const config = getBatchConfig();
  const url = `${config.endpoint}/openai/batches/${batchId}/cancel?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': config.apiKey,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to cancel batch job: ${response.status}`);
  }

  return response.json();
}

/**
 * Delete a file from Azure
 */
export async function deleteFile(fileId: string): Promise<void> {
  const config = getBatchConfig();
  const url = `${config.endpoint}/openai/files/${fileId}?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'api-key': config.apiKey,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Failed to delete file:', errorData.error?.message || response.status);
    // Don't throw - file deletion is best effort cleanup
  }
}

/**
 * List all batch jobs (for monitoring)
 */
export async function listBatchJobs(limit: number = 20): Promise<{
  object: 'list';
  data: BatchJobResponse[];
  first_id?: string;
  last_id?: string;
  has_more: boolean;
}> {
  const config = getBatchConfig();
  const url = `${config.endpoint}/openai/batches?api-version=${API_VERSION}&limit=${limit}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'api-key': config.apiKey,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to list batch jobs: ${response.status}`);
  }

  return response.json();
}

/**
 * Get pricing for batch processing (50% of standard pricing)
 * GPT-5-mini batch pricing
 */
export function getBatchPricing() {
  return {
    input: 0.075,   // $0.075 per 1M input tokens (50% of $0.15)
    output: 0.30,   // $0.30 per 1M output tokens (50% of $0.60)
  };
}

/**
 * Calculate cost from token usage
 */
export function calculateBatchCost(inputTokens: number, outputTokens: number): number {
  const pricing = getBatchPricing();
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Check if batch API is available (always true with hardcoded config)
 */
export function isBatchAvailable(): boolean {
  return true;
}
