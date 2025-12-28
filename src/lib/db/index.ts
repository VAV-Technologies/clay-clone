import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import * as schema from './schema';

// Check if we're using Turso (production) or local SQLite (development)
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

let db: ReturnType<typeof drizzleSqlite> | ReturnType<typeof drizzleLibsql>;

if (TURSO_DATABASE_URL && TURSO_AUTH_TOKEN) {
  // Production: Use Turso
  const client = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  });
  db = drizzleLibsql(client, { schema });
  console.log('Connected to Turso database');
} else {
  // Development: Use local SQLite
  const sqlite = new Database('dataflow.db');
  db = drizzleSqlite(sqlite, { schema });

  // Run migrations for local development
  runLocalMigrations(sqlite);
}

function runLocalMigrations(sqlite: Database.Database) {
  // Migration: Add 'table' to projects type constraint
  try {
    const tableInfo = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get() as { sql: string } | undefined;
    if (tableInfo?.sql && !tableInfo.sql.includes("'table'")) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS projects_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          parent_id TEXT,
          type TEXT NOT NULL CHECK (type IN ('folder', 'workbook', 'table')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES projects_new(id)
        );
        INSERT INTO projects_new SELECT * FROM projects;
        DROP TABLE projects;
        ALTER TABLE projects_new RENAME TO projects;
      `);
    }
  } catch {
    // Table might not exist yet
  }

  // Migration: Add formula_config_id to columns table
  try {
    const columnsInfo = sqlite.prepare("PRAGMA table_info(columns)").all() as { name: string }[];
    const hasFormulaConfigId = columnsInfo.some(col => col.name === 'formula_config_id');
    if (!hasFormulaConfigId && columnsInfo.length > 0) {
      sqlite.exec(`ALTER TABLE columns ADD COLUMN formula_config_id TEXT`);
    }
  } catch {
    // Column already exists or table doesn't exist
  }

  // Initialize database with tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('folder', 'workbook', 'table')),
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
      formula_config_id TEXT,
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

    CREATE TABLE IF NOT EXISTS formula_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      formula TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tables_project ON tables(project_id);
    CREATE INDEX IF NOT EXISTS idx_columns_table ON columns(table_id);
    CREATE INDEX IF NOT EXISTS idx_rows_table ON rows(table_id);
  `);
}

export { db, schema };
