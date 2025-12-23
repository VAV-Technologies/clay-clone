import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

const sqlite = new Database('dataflow.db');

export const db = drizzle(sqlite, { schema });

// Initialize database with tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    type TEXT NOT NULL CHECK (type IN ('folder', 'workbook')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY,
    table_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    width INTEGER DEFAULT 150,
    "order" INTEGER NOT NULL,
    enrichment_config_id TEXT,
    FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rows (
    id TEXT PRIMARY KEY,
    table_id TEXT,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS enrichment_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
    prompt TEXT NOT NULL,
    input_columns TEXT NOT NULL,
    output_format TEXT NOT NULL DEFAULT 'text',
    temperature REAL DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 1000,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
  CREATE INDEX IF NOT EXISTS idx_tables_project ON tables(project_id);
  CREATE INDEX IF NOT EXISTS idx_columns_table ON columns(table_id);
  CREATE INDEX IF NOT EXISTS idx_rows_table ON rows(table_id);
`);

export { schema };
