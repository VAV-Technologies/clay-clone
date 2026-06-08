// POST /api/enrichment/run — low-level: run an EXISTING enrichment config
// against a set of rows. For brand-new enrichments (create + run in one
// shot), use POST /api/enrichment/setup-and-run instead.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { runEnrichmentJob } from '@/lib/enrichment-runner';
import { getColumnIdSet, COLUMN_SCOPE_MESSAGE } from '@/lib/api-validation';

// Vercel function config - extend timeout for AI calls (web search can run up to 90s/row)
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      configId,
      tableId,
      targetColumnId,
      rowIds,
      onlyEmpty = false,
      includeErrors = false,
      forceRerun = false,
    } = body;

    if (!configId || !tableId || !targetColumnId) {
      return NextResponse.json(
        { error: 'configId, tableId, and targetColumnId are required' },
        { status: 400 }
      );
    }

    const [config] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, configId));

    if (!config) {
      return NextResponse.json({ error: 'Enrichment config not found' }, { status: 404 });
    }

    // Column-scope guard on the enrichment write path (QA finding C1-006):
    // reject a targetColumnId that isn't a column of this table before spending.
    const validColumnIds = await getColumnIdSet(tableId);
    if (!validColumnIds.has(targetColumnId)) {
      return NextResponse.json(
        { error: COLUMN_SCOPE_MESSAGE, invalidColumnIds: [targetColumnId], tableId },
        { status: 400 }
      );
    }

    const result = await runEnrichmentJob({
      config,
      tableId,
      targetColumnId,
      rowIds,
      onlyEmpty,
      includeErrors,
      forceRerun,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error running enrichment:', error);
    return NextResponse.json({ error: 'Failed to run enrichment' }, { status: 500 });
  }
}
