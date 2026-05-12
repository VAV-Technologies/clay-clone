'use server';

// Server action backing the "Get CLI access" modal. Returns the live
// DATAFLOW_API_KEY so the user can copy-paste it straight into
// `agent-x set-key`. Anyone who reaches this page has already cleared
// the middleware's cookie/bearer check, so this isn't an escalation —
// it just surfaces the same credential the rest of the UI uses.

export async function getCliCredentials(): Promise<{
  apiKey: string;
  baseUrl: string;
}> {
  const apiKey = process.env.DATAFLOW_API_KEY ?? '';
  // APP_URL is the canonical server-side base URL. Fall back to the prod
  // hostname so the modal still works on previews / local dev where
  // APP_URL may not be set.
  const baseUrl = process.env.APP_URL || 'https://dataflow-pi.vercel.app';
  return { apiKey, baseUrl };
}
