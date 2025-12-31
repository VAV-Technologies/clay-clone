import { VertexAI } from '@google-cloud/vertexai';

let vertexAIClient: VertexAI | null = null;

export function getVertexAI(): VertexAI {
  if (vertexAIClient) {
    return vertexAIClient;
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required');
  }

  // Check if we have service account as base64 (for Vercel - avoids special char issues)
  const serviceAccountBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  // Or as raw JSON
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountBase64) {
    // Decode base64 and parse JSON
    const decoded = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
    const credentials = JSON.parse(decoded);

    vertexAIClient = new VertexAI({
      project: projectId,
      location,
      googleAuthOptions: {
        credentials,
      },
    });
  } else if (serviceAccountJson) {
    // Parse the JSON directly
    const credentials = JSON.parse(serviceAccountJson);

    vertexAIClient = new VertexAI({
      project: projectId,
      location,
      googleAuthOptions: {
        credentials,
      },
    });
  } else {
    // Local development - uses GOOGLE_APPLICATION_CREDENTIALS file
    vertexAIClient = new VertexAI({
      project: projectId,
      location,
    });
  }

  return vertexAIClient;
}

export function getGenerativeModel(modelName: string = 'gemini-2.0-flash', config?: {
  temperature?: number;
  maxOutputTokens?: number;
}) {
  const vertexAI = getVertexAI();

  return vertexAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: config?.temperature ?? 0.7,
      maxOutputTokens: config?.maxOutputTokens ?? 2048,
    },
  });
}
