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

  // Check if we have service account JSON as env var (for Vercel)
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    // Parse the JSON and use it for auth
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
