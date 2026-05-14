import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

async function main() {
  console.log('Before backfill:');
  const before = await client.execute(
    `SELECT output_format, COUNT(*) as n FROM enrichment_configs GROUP BY output_format`
  );
  console.log(before.rows);

  console.log('\nRunning UPDATE enrichment_configs SET output_format = \'json\' WHERE output_format IS NULL OR output_format = \'text\';');
  const r = await client.execute(
    `UPDATE enrichment_configs SET output_format = 'json' WHERE output_format IS NULL OR output_format = 'text'`
  );
  console.log(`Rows affected: ${r.rowsAffected}`);

  console.log('\nAfter backfill:');
  const after = await client.execute(
    `SELECT output_format, COUNT(*) as n FROM enrichment_configs GROUP BY output_format`
  );
  console.log(after.rows);

  process.exit(0);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
