import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { sql, type SQL } from 'drizzle-orm';
import { purgeAzureFiles } from '@/lib/db/cascade';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/admin/cleanup-orphans[?dryRun=0]
// One-time purge of orphaned rows in the auxiliary tables that have no foreign
// keys and therefore are NOT cleaned by FK cascade:
//   - enrichment_configs    not referenced by any column
//   - formula_configs       not referenced by any column
//   - campaigns             whose workbook_id points to a deleted project
//   - batch_enrichment_jobs whose table_id points to a deleted table (+ Azure files)
//   - enrichment_jobs       whose table_id points to a deleted table
//
// Defaults to a DRY RUN (counts only). Pass ?dryRun=0 to actually delete.
// Idempotent and safe to re-run. The core hierarchy (rows/columns/tables) is
// already cleaned by cascade and is intentionally NOT touched here.
//
// Auth: requires Authorization: Bearer ${DATAFLOW_API_KEY} (the /api/admin
// prefix is exempt from middleware auth, so we enforce it manually here).

// Provably-orphaned predicates (bare column names resolve against each query's single FROM table).
const ORPHAN = {
  enrichmentConfigs: sql`id NOT IN (SELECT enrichment_config_id FROM columns WHERE enrichment_config_id IS NOT NULL)`,
  formulaConfigs: sql`id NOT IN (SELECT formula_config_id FROM columns WHERE formula_config_id IS NOT NULL)`,
  campaigns: sql`workbook_id IS NOT NULL AND workbook_id NOT IN (SELECT id FROM projects)`,
  batchJobs: sql`table_id NOT IN (SELECT id FROM tables)`,
  enrichmentJobs: sql`table_id NOT IN (SELECT id FROM tables)`,
} as const;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const validKey = process.env.DATAFLOW_API_KEY;
  if (!validKey || authHeader !== `Bearer ${validKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dryRun') !== '0';

  try {
    // table is a SQLiteTable; the union of our five tables doesn't satisfy
    // .from()'s overloads, so accept it permissively (it's a maintenance route).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countWhere = async (table: any, where: SQL) => {
      const r = await db.select({ c: sql<number>`count(*)` }).from(table).where(where);
      return Number(r[0]?.c ?? 0);
    };

    const orphans = {
      enrichmentConfigs: await countWhere(schema.enrichmentConfigs, ORPHAN.enrichmentConfigs),
      formulaConfigs: await countWhere(schema.formulaConfigs, ORPHAN.formulaConfigs),
      campaigns: await countWhere(schema.campaigns, ORPHAN.campaigns),
      batchJobs: await countWhere(schema.batchEnrichmentJobs, ORPHAN.batchJobs),
      enrichmentJobs: await countWhere(schema.enrichmentJobs, ORPHAN.enrichmentJobs),
    };

    if (dryRun) {
      return NextResponse.json({ dryRun: true, orphans, azureFilesPurged: 0 });
    }

    // Collect Azure file ids from the orphaned batch jobs BEFORE deleting them.
    const orphanBatchJobs = await db
      .select({
        f: schema.batchEnrichmentJobs.azureFileId,
        o: schema.batchEnrichmentJobs.azureOutputFileId,
        e: schema.batchEnrichmentJobs.azureErrorFileId,
      })
      .from(schema.batchEnrichmentJobs)
      .where(ORPHAN.batchJobs);
    const azureFileIds = Array.from(
      new Set(
        orphanBatchJobs.flatMap((j) => [j.f, j.o, j.e]).filter((x): x is string => !!x && x.trim() !== ''),
      ),
    );

    await db.transaction(async (tx) => {
      await tx.delete(schema.enrichmentConfigs).where(ORPHAN.enrichmentConfigs);
      await tx.delete(schema.formulaConfigs).where(ORPHAN.formulaConfigs);
      await tx.delete(schema.campaigns).where(ORPHAN.campaigns);
      await tx.delete(schema.batchEnrichmentJobs).where(ORPHAN.batchJobs);
      await tx.delete(schema.enrichmentJobs).where(ORPHAN.enrichmentJobs);
    });

    const azureFilesPurged = await purgeAzureFiles(azureFileIds);

    return NextResponse.json({ dryRun: false, deleted: orphans, azureFilesPurged });
  } catch (error) {
    console.error('Error in cleanup-orphans:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Cleanup failed' },
      { status: 500 },
    );
  }
}
