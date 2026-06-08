import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

/**
 * Atomically marks a cell (row.data[columnId].status) as 'processing' iff it is
 * not already 'processing', returning true only if WE won the claim.
 *
 * This is the concurrency guard that stops two simultaneous runs from both
 * invoking the (paid) provider for the same cell — the SELECT-then-write window
 * that let concurrent enrichment-run / ai-ark submits double-charge (QA findings
 * C1-001, C1-005). Implemented as a conditional json_set so it works whether or
 * not the cell already exists, and avoids any same-second timestamp race.
 *
 * A cell stuck at 'processing' (a crashed run) is recovered by the cron's
 * stale-job cleanup or the retry-cell endpoints, not by re-running.
 */
export async function claimCellForProcessing(rowId: string, columnId: string): Promise<boolean> {
  const path = `$."${columnId}".status`;
  const claimed = (await db.all(sql`
    UPDATE rows
    SET data = json_set(data, ${path}, 'processing')
    WHERE id = ${rowId}
      AND coalesce(json_extract(data, ${path}), '') != 'processing'
    RETURNING id
  `)) as unknown[];
  return claimed.length > 0;
}
