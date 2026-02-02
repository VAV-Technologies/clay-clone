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
  model: text('model').notNull().default('gemini-2.5-flash'),
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

// Background enrichment jobs - processes even if browser is closed
export const enrichmentJobs = sqliteTable('enrichment_jobs', {
  id: text('id').primaryKey(),
  tableId: text('table_id').notNull(),
  configId: text('config_id').notNull(),
  targetColumnId: text('target_column_id').notNull(),
  // Row IDs to process (JSON array)
  rowIds: text('row_ids', { mode: 'json' }).notNull().$type<string[]>(),
  // Current position in rowIds array
  currentIndex: integer('current_index').notNull().default(0),
  // Job status
  status: text('status', { enum: ['pending', 'running', 'complete', 'cancelled', 'error'] }).notNull().default('pending'),
  // Stats
  processedCount: integer('processed_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  totalCost: real('total_cost').notNull().default(0),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// Azure Batch enrichment jobs - for bulk processing with 50% cheaper batch API
export const batchEnrichmentJobs = sqliteTable('batch_enrichment_jobs', {
  id: text('id').primaryKey(),
  tableId: text('table_id').notNull(),
  configId: text('config_id').notNull(),
  targetColumnId: text('target_column_id').notNull(),

  // Batch grouping - for splitting large batches (>25K rows)
  batchGroupId: text('batch_group_id'),      // Links related batches together
  batchNumber: integer('batch_number'),       // 1, 2, 3, etc.
  totalBatches: integer('total_batches'),     // Total batches in group

  // Azure IDs
  azureFileId: text('azure_file_id'),
  azureBatchId: text('azure_batch_id'),
  azureOutputFileId: text('azure_output_file_id'),
  azureErrorFileId: text('azure_error_file_id'),

  // Row mappings: [{rowId, customId}]
  rowMappings: text('row_mappings', { mode: 'json' }).notNull().$type<Array<{rowId: string; customId: string}>>(),

  // Azure status: validating, in_progress, finalizing, completed, failed, expired, cancelled
  azureStatus: text('azure_status').notNull().default('pending_upload'),

  // Internal status: pending, uploading, submitted, processing, downloading, complete, error, cancelled
  status: text('status').notNull().default('pending'),

  // Stats
  totalRows: integer('total_rows').notNull().default(0),
  processedCount: integer('processed_count').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  totalCost: real('total_cost').notNull().default(0),
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),

  // Error tracking
  lastError: text('last_error'),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// TypeScript types
export interface EnrichmentDatapoint {
  key: string;
  value: string | number | null;
}

export interface CellValue {
  value: string | number | null;
  status?: 'pending' | 'processing' | 'complete' | 'error' | 'batch_submitted' | 'batch_processing';
  // Reference to batch job if this cell is being processed by a batch job
  batchJobId?: string;
  // Structured data from enrichment (e.g., {city: "Jakarta", country: "Indonesia"})
  enrichmentData?: Record<string, string | number | null>;
  // Raw AI response for debugging
  rawResponse?: string;
  error?: string;
  // Usage metadata (no extra cost - from API response)
  metadata?: {
    inputTokens: number;
    outputTokens: number;
    timeTakenMs: number;
    totalCost: number;
    forcedToFinishEarly?: boolean;
  };
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
export type EnrichmentJob = typeof enrichmentJobs.$inferSelect;
export type NewEnrichmentJob = typeof enrichmentJobs.$inferInsert;
export type BatchEnrichmentJob = typeof batchEnrichmentJobs.$inferSelect;
export type NewBatchEnrichmentJob = typeof batchEnrichmentJobs.$inferInsert;

// Ninja Email Finder jobs - for finding emails using MailTester Ninja API
export const ninjaEmailJobs = sqliteTable('ninja_email_jobs', {
  id: text('id').primaryKey(),
  tableId: text('table_id').notNull(),
  targetColumnId: text('target_column_id').notNull(),
  // Input column configuration
  inputMode: text('input_mode', { enum: ['fullName', 'firstLast'] }).notNull(),
  fullNameColumnId: text('full_name_column_id'),
  firstNameColumnId: text('first_name_column_id'),
  lastNameColumnId: text('last_name_column_id'),
  domainColumnId: text('domain_column_id').notNull(),
  // Row tracking
  rowIds: text('row_ids', { mode: 'json' }).notNull().$type<string[]>(),
  currentIndex: integer('current_index').notNull().default(0),
  // Status: pending, running, complete, cancelled, error
  status: text('status', { enum: ['pending', 'running', 'complete', 'cancelled', 'error'] }).notNull().default('pending'),
  // Stats
  processedCount: integer('processed_count').notNull().default(0),
  foundCount: integer('found_count').notNull().default(0),
  notFoundCount: integer('not_found_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export type NinjaEmailJob = typeof ninjaEmailJobs.$inferSelect;
export type NewNinjaEmailJob = typeof ninjaEmailJobs.$inferInsert;
