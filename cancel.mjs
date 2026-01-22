import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const envContent = readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
}
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
await db.execute(`UPDATE enrichment_jobs SET status = 'cancelled' WHERE status IN ('pending', 'running')`);
console.log('Done');
process.exit(0);
