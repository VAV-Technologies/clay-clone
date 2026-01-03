import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  type: text('type', { enum: ['folder', 'workbook', 'table'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  parent: one(projects, {
    fields: [projects.parentId],
    references: [projects.id],
    relationName: 'parent',
  }),
  children: many(projects, { relationName: 'parent' }),
  tables: many(tables),
}));

export const tables = sqliteTable('tables', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const tablesRelations = relations(tables, ({ one, many }) => ({
  project: one(projects, {
    fields: [tables.projectId],
    references: [projects.id],
  }),
  columns: many(columns),
  rows: many(rows),
}));

export const columns = sqliteTable('columns', {
  id: text('id').primaryKey(),
  tableId: text('table_id').references(() => tables.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['text', 'number', 'email', 'url', 'date', 'enrichment', 'formula'] }).notNull().default('text'),
  width: integer('width').default(150),
  order: integer('order').notNull(),
  enrichmentConfigId: text('enrichment_config_id'),
  formulaConfigId: text('formula_config_id'),
});

export const columnsRelations = relations(columns, ({ one }) => ({
  table: one(tables, {
    fields: [columns.tableId],
    references: [tables.id],
  }),
  enrichmentConfig: one(enrichmentConfigs, {
    fields: [columns.enrichmentConfigId],
    references: [enrichmentConfigs.id],
  }),
  formulaConfig: one(formulaConfigs, {
    fields: [columns.formulaConfigId],
    references: [formulaConfigs.id],
  }),
}));

export const rows = sqliteTable('rows', {
  id: text('id').primaryKey(),
  tableId: text('table_id').references(() => tables.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).notNull().$type<Record<string, CellValue>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const rowsRelations = relations(rows, ({ one }) => ({
  table: one(tables, {
    fields: [rows.tableId],
    references: [tables.id],
  }),
}));

export const enrichmentConfigs = sqliteTable('enrichment_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  model: text('model', { enum: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'] }).notNull().default('gemini-1.5-flash'),
  prompt: text('prompt').notNull(),
  inputColumns: text('input_columns', { mode: 'json' }).notNull().$type<string[]>(),
  // Output columns defined in Data Guide - each becomes a separate column
  outputColumns: text('output_columns', { mode: 'json' }).$type<string[]>(),
  outputFormat: text('output_format', { enum: ['text', 'json'] }).notNull().default('text'),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(1000), // Deprecated, kept for compatibility
  // Cost limit settings
  costLimitEnabled: integer('cost_limit_enabled', { mode: 'boolean' }).default(false),
  maxCostPerRow: real('max_cost_per_row'), // In dollars, null = unlimited
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const formulaConfigs = sqliteTable('formula_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  formula: text('formula').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// TypeScript types
export interface EnrichmentDatapoint {
  key: string;
  value: string | number | null;
}

export interface CellValue {
  value: string | number | null;
  status?: 'pending' | 'processing' | 'complete' | 'error';
  // Structured data from enrichment (e.g., {city: "Jakarta", country: "Indonesia"})
  enrichmentData?: Record<string, string | number | null>;
  // Raw AI response for debugging
  rawResponse?: string;
  error?: string;
}

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Table = typeof tables.$inferSelect;
export type NewTable = typeof tables.$inferInsert;
export type Column = typeof columns.$inferSelect;
export type NewColumn = typeof columns.$inferInsert;
export type Row = typeof rows.$inferSelect;
export type NewRow = typeof rows.$inferInsert;
export type EnrichmentConfig = typeof enrichmentConfigs.$inferSelect;
export type NewEnrichmentConfig = typeof enrichmentConfigs.$inferInsert;
export type FormulaConfig = typeof formulaConfigs.$inferSelect;
export type NewFormulaConfig = typeof formulaConfigs.$inferInsert;
