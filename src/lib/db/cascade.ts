import { eq, inArray } from 'drizzle-orm';
import { schema } from '@/lib/db';
import { deleteFile } from '@/lib/azure-batch';

// Cleanup for everything tied to a table/column that the FK `ON DELETE CASCADE`
// does NOT cover. The core hierarchy (projects → tables → columns → rows)
// cascades correctly on Turso (foreign_keys is ON), but four auxiliary tables
// were created without foreign keys and so leak on delete:
//   - batch_enrichment_jobs   (keyed by table_id / target_column_id)
//   - enrichment_jobs         (keyed by table_id)
//   - enrichment_configs      (referenced by columns.enrichment_config_id)
//   - formula_configs         (referenced by columns.formula_config_id)
// plus the Azure Batch files referenced by batch_enrichment_jobs rows.
//
// These helpers centralize that cleanup so the table-delete, folder-delete and
// column-delete paths all behave identically.

// Accepts either the root `db` handle or an open transaction. Drizzle's db and
// tx generics don't unify cleanly across the libsql/better-sqlite3 drivers, so
// this internal helper takes a permissive handle; column names stay typed via
// the `schema` references used in each query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = any;

interface AzureFileRow { f: string | null; o: string | null; e: string | null }

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((x): x is string => !!x && x.trim() !== '')));
}

// libsql delete results expose `rowsAffected`; better-sqlite3 exposes `changes`.
function affected(res: unknown): number {
  const r = res as { rowsAffected?: number; changes?: number } | undefined;
  return r?.rowsAffected ?? r?.changes ?? 0;
}

/**
 * Azure Batch leaves input/output/error files in the Azure OpenAI Files store.
 * Their ids live ONLY on batch_enrichment_jobs rows, so collect them BEFORE the
 * rows are deleted. Returns a deduped list of non-empty file ids.
 */
export async function collectAzureFileIdsForTable(reader: Executor, tableId: string): Promise<string[]> {
  const jobs = await reader
    .select({
      f: schema.batchEnrichmentJobs.azureFileId,
      o: schema.batchEnrichmentJobs.azureOutputFileId,
      e: schema.batchEnrichmentJobs.azureErrorFileId,
    })
    .from(schema.batchEnrichmentJobs)
    .where(eq(schema.batchEnrichmentJobs.tableId, tableId));
  return uniqueIds(jobs.flatMap((j: AzureFileRow) => [j.f, j.o, j.e]));
}

export async function collectAzureFileIdsForColumn(reader: Executor, columnId: string): Promise<string[]> {
  const jobs = await reader
    .select({
      f: schema.batchEnrichmentJobs.azureFileId,
      o: schema.batchEnrichmentJobs.azureOutputFileId,
      e: schema.batchEnrichmentJobs.azureErrorFileId,
    })
    .from(schema.batchEnrichmentJobs)
    .where(eq(schema.batchEnrichmentJobs.targetColumnId, columnId));
  return uniqueIds(jobs.flatMap((j: AzureFileRow) => [j.f, j.o, j.e]));
}

/**
 * Delete enrichment_configs / formula_configs from the given candidate sets,
 * but ONLY those that no surviving column references (configs are not
 * guaranteed 1:1 with a column). Call this AFTER the owning columns have been
 * deleted so the "still referenced" check reads correctly.
 */
export async function deleteUnreferencedConfigs(
  tx: Executor,
  candidates: { enrichmentIds: string[]; formulaIds: string[] },
): Promise<{ enrichmentConfigs: number; formulaConfigs: number }> {
  let enrichmentConfigs = 0;
  let formulaConfigs = 0;

  const enrichmentIds = uniqueIds(candidates.enrichmentIds);
  if (enrichmentIds.length) {
    const stillUsed = await tx
      .select({ id: schema.columns.enrichmentConfigId })
      .from(schema.columns)
      .where(inArray(schema.columns.enrichmentConfigId, enrichmentIds));
    const used = new Set(stillUsed.map((r: { id: string | null }) => r.id));
    const toDelete = enrichmentIds.filter((id) => !used.has(id));
    if (toDelete.length) {
      await tx.delete(schema.enrichmentConfigs).where(inArray(schema.enrichmentConfigs.id, toDelete));
      enrichmentConfigs = toDelete.length;
    }
  }

  const formulaIds = uniqueIds(candidates.formulaIds);
  if (formulaIds.length) {
    const stillUsed = await tx
      .select({ id: schema.columns.formulaConfigId })
      .from(schema.columns)
      .where(inArray(schema.columns.formulaConfigId, formulaIds));
    const used = new Set(stillUsed.map((r: { id: string | null }) => r.id));
    const toDelete = formulaIds.filter((id) => !used.has(id));
    if (toDelete.length) {
      await tx.delete(schema.formulaConfigs).where(inArray(schema.formulaConfigs.id, toDelete));
      formulaConfigs = toDelete.length;
    }
  }

  return { enrichmentConfigs, formulaConfigs };
}

export interface TableDependentCounts {
  batchJobs: number;
  enrichmentJobs: number;
  enrichmentConfigs: number;
  formulaConfigs: number;
}

/**
 * Delete every non-cascading dependent of a table: batch_enrichment_jobs,
 * enrichment_jobs, the table's columns, and any enrichment/formula configs left
 * unreferenced by removing those columns. Runs inside the caller's transaction.
 *
 * NOTE: this deletes the columns (required so the config guard reads correctly)
 * but leaves the table's `rows` and the `tables` row itself to the caller, which
 * deletes them next (rows are large; the caller controls that statement).
 */
export async function deleteTableDependents(tx: Executor, tableId: string): Promise<TableDependentCounts> {
  // 1. Capture config ids referenced by this table's columns BEFORE deleting them.
  const cols = await tx
    .select({ e: schema.columns.enrichmentConfigId, f: schema.columns.formulaConfigId })
    .from(schema.columns)
    .where(eq(schema.columns.tableId, tableId));
  const enrichmentIds = uniqueIds(cols.map((c: { e: string | null; f: string | null }) => c.e));
  const formulaIds = uniqueIds(cols.map((c: { e: string | null; f: string | null }) => c.f));

  // 2/3. Jobs (no FK — must be deleted explicitly).
  const batchRes = await tx
    .delete(schema.batchEnrichmentJobs)
    .where(eq(schema.batchEnrichmentJobs.tableId, tableId));
  const jobRes = await tx
    .delete(schema.enrichmentJobs)
    .where(eq(schema.enrichmentJobs.tableId, tableId));

  // 4. Columns — must precede the config guard below.
  await tx.delete(schema.columns).where(eq(schema.columns.tableId, tableId));

  // 5. Now-unreferenced configs (guarded against shared configs).
  const cfg = await deleteUnreferencedConfigs(tx, { enrichmentIds, formulaIds });

  return {
    batchJobs: affected(batchRes),
    enrichmentJobs: affected(jobRes),
    enrichmentConfigs: cfg.enrichmentConfigs,
    formulaConfigs: cfg.formulaConfigs,
  };
}

const AZURE_PURGE_CONCURRENCY = 5;
const AZURE_PURGE_TIMEOUT_MS = 3000;
const AZURE_PURGE_MAX = 200;

/**
 * Best-effort deletion of Azure Batch files. NEVER throws and never blocks the
 * DB delete — call it AFTER the transaction commits. Bounded by a concurrency
 * pool, a per-call timeout, and a hard ceiling on the number of files.
 */
export async function purgeAzureFiles(fileIds: string[]): Promise<number> {
  let ids = uniqueIds(fileIds);
  if (!ids.length) return 0;
  if (ids.length > AZURE_PURGE_MAX) {
    console.warn(
      `[cascade] purgeAzureFiles: ${ids.length} files exceeds cap ${AZURE_PURGE_MAX}; ` +
        `purging first ${AZURE_PURGE_MAX}, skipping ${ids.length - AZURE_PURGE_MAX}`,
    );
    ids = ids.slice(0, AZURE_PURGE_MAX);
  }

  const withTimeout = (p: Promise<void>) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('azure deleteFile timeout')), AZURE_PURGE_TIMEOUT_MS);
      p.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });

  let purged = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        await withTimeout(deleteFile(id));
        purged++;
      } catch (err) {
        console.error('[cascade] purgeAzureFiles failed for', id, (err as Error).message);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(AZURE_PURGE_CONCURRENCY, ids.length) }, worker),
  );
  return purged;
}
