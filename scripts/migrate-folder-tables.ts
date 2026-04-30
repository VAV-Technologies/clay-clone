// One-shot migration: wrap every legacy table that lives directly under a
// folder-type project in a new workbook project, so the data model is
// folder -> workbook -> sheet across the board.
//
// Run with:
//   npx tsx scripts/migrate-folder-tables.ts
//
// Reads TURSO_DATABASE_URL + TURSO_AUTH_TOKEN from .env.local.

import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

function loadDotenv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.warn('Could not read .env.local:', (err as Error).message);
  }
}

async function main() {
  loadDotenv();

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set');
  }

  const client = createClient({ url, authToken });

  const folders = await client.execute({
    sql: "SELECT id, name FROM projects WHERE type = 'folder'",
    args: [],
  });

  console.log(`Found ${folders.rows.length} folder(s)`);
  if (folders.rows.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  const folderIds = folders.rows.map((r) => r.id as string);
  const placeholders = folderIds.map(() => '?').join(',');

  const orphanTables = await client.execute({
    sql: `SELECT id, project_id, name FROM tables WHERE project_id IN (${placeholders})`,
    args: folderIds,
  });

  console.log(`Found ${orphanTables.rows.length} table(s) sitting directly under folders`);
  if (orphanTables.rows.length === 0) {
    console.log('Already migrated. Nothing to do.');
    return;
  }

  let createdWorkbooks = 0;

  for (const row of orphanTables.rows) {
    const tableId = row.id as string;
    const folderId = row.project_id as string;
    const tableName = row.name as string;

    const workbookId = randomUUID();
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);

    await client.batch(
      [
        {
          sql:
            'INSERT INTO projects (id, name, parent_id, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [workbookId, tableName, folderId, 'workbook', nowSec, nowSec],
        },
        {
          sql: 'UPDATE tables SET project_id = ?, updated_at = ? WHERE id = ?',
          args: [workbookId, nowSec, tableId],
        },
      ],
      'write'
    );

    createdWorkbooks += 1;
    console.log(`  - wrapped table "${tableName}" (${tableId}) under new workbook ${workbookId}`);
  }

  console.log(`\nDone. Migrated ${orphanTables.rows.length} table(s); created ${createdWorkbooks} workbook(s).`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
