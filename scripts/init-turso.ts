import { createClient } from '@libsql/client';

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
  process.exit(1);
}

const client = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
});

async function initDatabase() {
  console.log('Initializing Turso database...');

  const statements = [
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('folder', 'workbook', 'table')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES projects(id)
    )`,
    `CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      table_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      width INTEGER DEFAULT 150,
      "order" INTEGER NOT NULL,
      enrichment_config_id TEXT,
      formula_config_id TEXT,
      FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS rows (
      id TEXT PRIMARY KEY,
      table_id TEXT,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS enrichment_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
      prompt TEXT NOT NULL,
      input_columns TEXT NOT NULL,
      output_format TEXT NOT NULL DEFAULT 'text',
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 1000,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS formula_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      formula TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tables_project ON tables(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_columns_table ON columns(table_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rows_table ON rows(table_id)`,
  ];

  for (const sql of statements) {
    try {
      await client.execute(sql);
      console.log('✓ Executed:', sql.substring(0, 50) + '...');
    } catch (error) {
      console.error('Error executing:', sql.substring(0, 50));
      console.error(error);
    }
  }

  console.log('Database initialized successfully!');
}

initDatabase().catch(console.error);
