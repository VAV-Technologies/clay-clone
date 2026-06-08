import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * Shared scope-validation helpers for mutation endpoints.
 *
 * The READ path (GET /api/rows) already rejects columnIds that don't belong to
 * the target table (the "column-scope" guard). These helpers extend the same
 * protection to the WRITE paths (rows POST/PATCH/DELETE, lookup/run,
 * find-email/run, enrichment/run) so a foreign or phantom columnId can no
 * longer silently create orphaned, UI-invisible cells or trigger phantom
 * charges. See QA findings A-015/022/023, C-003/017, C1-006.
 */

/** Returns the set of valid column ids for a table (empty set if none / table missing). */
export async function getColumnIdSet(tableId: string): Promise<Set<string>> {
  const cols = await db
    .select({ id: schema.columns.id })
    .from(schema.columns)
    .where(eq(schema.columns.tableId, tableId));
  return new Set(cols.map((c) => c.id));
}

/** True if a table row with this id exists. */
export async function tableExists(tableId: string): Promise<boolean> {
  const t = await db
    .select({ id: schema.tables.id })
    .from(schema.tables)
    .where(eq(schema.tables.id, tableId))
    .limit(1);
  return t.length > 0;
}

/** True if a project (workbook/folder) with this id exists. */
export async function projectExists(projectId: string): Promise<boolean> {
  const p = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return p.length > 0;
}

/** Returns the de-duplicated subset of keys that are NOT valid column ids. */
export function invalidColumnIds(keys: string[], validIds: Set<string>): string[] {
  return Array.from(new Set(keys.filter((k) => !validIds.has(k))));
}

/** Standard message used whenever a write references a column outside the target sheet. */
export const COLUMN_SCOPE_MESSAGE =
  'Request references columnId(s) that do not belong to this table. Column IDs are scoped per-sheet — fetch GET /api/columns?tableId=... for the sheet you are writing to.';
