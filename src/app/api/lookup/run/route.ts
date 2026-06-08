import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import { applyFilter, type Filter } from '@/lib/filter-utils';
import { tableExists, COLUMN_SCOPE_MESSAGE } from '@/lib/api-validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const {
      tableId,
      sourceTableId,
      inputColumnId,
      matchColumnId,
      targetColumnId,
      condition,
    } = await request.json();

    if (!tableId || !sourceTableId || !inputColumnId || !matchColumnId || !targetColumnId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Existence checks — an unknown source/target table must 404, not silently
    // zero out every target cell as "no match" (QA finding C-004).
    if (!(await tableExists(tableId))) {
      return NextResponse.json({ error: 'Table not found', tableId }, { status: 404 });
    }
    if (!(await tableExists(sourceTableId))) {
      return NextResponse.json({ error: 'Source table not found', sourceTableId }, { status: 404 });
    }

    const sourceColumns = await db.select().from(schema.columns).where(eq(schema.columns.tableId, sourceTableId));
    const currentColumns = await db.select().from(schema.columns).where(eq(schema.columns.tableId, tableId));
    const sourceColIds = new Set(sourceColumns.map((c) => c.id));
    const currentColIds = new Set(currentColumns.map((c) => c.id));

    // Column-scope guard (QA finding C-003): inputColumnId/targetColumnId/condition
    // must belong to the current table and matchColumnId to the source table.
    // Without this, a foreign inputColumnId resolved to empty for every row and
    // then OVERWROTE all previously-matched cells with __no_match.
    const invalid: string[] = [];
    if (!currentColIds.has(inputColumnId)) invalid.push(inputColumnId);
    if (!currentColIds.has(targetColumnId)) invalid.push(targetColumnId);
    if (!sourceColIds.has(matchColumnId)) invalid.push(matchColumnId);
    if (condition && condition.columnId && !currentColIds.has(condition.columnId)) invalid.push(condition.columnId);
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: COLUMN_SCOPE_MESSAGE, invalidColumnIds: Array.from(new Set(invalid)), tableId, sourceTableId },
        { status: 400 }
      );
    }

    // 1. Fetch all source rows and build the lookup map.
    const sourceRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sourceTableId));

    // Skip the source table's own result columns (type === 'enrichment') from
    // the extractable payload — they're cell-viewer surfaces, not data.
    const exposedSourceColumns = sourceColumns.filter((c) => c.type !== 'enrichment');

    // matchValue (lowercased) -> { source-row fields keyed by column NAME }.
    // First match wins; duplicate keys are counted and surfaced rather than
    // silently overwriting (QA finding C-002 — last-write-wins data loss).
    const lookupMap = new Map<string, Record<string, string | number | null>>();
    let duplicateKeyCount = 0;
    for (const row of sourceRows) {
      const data = row.data as Record<string, CellValue>;
      const matchVal = data[matchColumnId]?.value?.toString().trim().toLowerCase();
      if (!matchVal) continue;
      if (lookupMap.has(matchVal)) {
        duplicateKeyCount++;
        continue;
      }
      const fields: Record<string, string | number | null> = {};
      for (const col of exposedSourceColumns) {
        const cell = data[col.id] as CellValue | undefined;
        const v = cell?.value;
        fields[col.name] = v === undefined ? null : (v as string | number | null);
      }
      lookupMap.set(matchVal, fields);
    }

    // 2. Fetch current rows and apply optional condition filter.
    const allCurrentRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
    let currentRows = allCurrentRows;
    if (condition && condition.columnId && condition.operator) {
      const filter: Filter = { columnId: condition.columnId, operator: condition.operator, value: condition.value || '' };
      currentRows = allCurrentRows.filter((row) => applyFilter(row as unknown as Parameters<typeof applyFilter>[0], filter, currentColumns));
      console.log(`[lookup] Condition applied: ${allCurrentRows.length} → ${currentRows.length} rows`);
    }

    let matchedCount = 0;
    let unmatchedCount = 0;

    // 3. Write the matched source fields (or a no-match marker) to the target column.
    for (const row of currentRows) {
      const data = row.data as Record<string, CellValue>;
      const inputVal = data[inputColumnId]?.value?.toString().trim().toLowerCase();

      if (inputVal && lookupMap.has(inputVal)) {
        const fields = lookupMap.get(inputVal)!;
        const updatedData = {
          ...data,
          [targetColumnId]: { value: 'matched', status: 'complete' as const, enrichmentData: fields },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        matchedCount++;
      } else {
        const updatedData = {
          ...data,
          [targetColumnId]: { value: null, status: 'complete' as const, enrichmentData: { __no_match: 'no source row matched' } },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        unmatchedCount++;
      }
    }

    return NextResponse.json({
      processedCount: currentRows.length,
      matchedCount,
      unmatchedCount,
      sourceRowCount: sourceRows.length,
      duplicateKeyCount,
    });
  } catch (error) {
    console.error('Lookup error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Lookup failed' },
      { status: 500 }
    );
  }
}
