import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';
import { applyFilter, type Filter } from '@/lib/filter-utils';

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

    // 1. Fetch all rows + columns from source table.
    const sourceRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sourceTableId));
    const sourceColumns = await db.select().from(schema.columns).where(eq(schema.columns.tableId, sourceTableId));

    // Skip the source table's own result columns (type === 'enrichment') from
    // the extractable payload — they're cell-viewer surfaces, not data.
    const exposedSourceColumns = sourceColumns.filter(c => c.type !== 'enrichment');

    // Build lookup map: matchValue (lowercased) -> { all source-row fields keyed by column NAME }.
    const lookupMap = new Map<string, Record<string, string | number | null>>();
    for (const row of sourceRows) {
      const data = row.data as Record<string, CellValue>;
      const matchVal = data[matchColumnId]?.value?.toString().trim().toLowerCase();
      if (!matchVal) continue;
      const fields: Record<string, string | number | null> = {};
      for (const col of exposedSourceColumns) {
        const cell = data[col.id] as CellValue | undefined;
        const v = cell?.value;
        fields[col.name] = v === undefined ? null : (v as string | number | null);
      }
      lookupMap.set(matchVal, fields);
    }

    // 2. Fetch all rows from current table and apply optional condition filter
    const allCurrentRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, tableId));
    const currentColumns = await db.select().from(schema.columns).where(eq(schema.columns.tableId, tableId));

    let currentRows = allCurrentRows;
    if (condition && condition.columnId && condition.operator) {
      const filter: Filter = { columnId: condition.columnId, operator: condition.operator, value: condition.value || '' };
      currentRows = allCurrentRows.filter(row => applyFilter(row as unknown as Parameters<typeof applyFilter>[0], filter, currentColumns));
      console.log(`[lookup] Condition applied: ${allCurrentRows.length} → ${currentRows.length} rows`);
    }

    let matchedCount = 0;
    let unmatchedCount = 0;

    // 3. For each row, look up the source-row fields and write to target column.
    // The cell value is just a marker ('matched' / null) — the real payload
    // lives in enrichmentData and surfaces through the cell viewer.
    for (const row of currentRows) {
      const data = row.data as Record<string, CellValue>;
      const inputVal = data[inputColumnId]?.value?.toString().trim().toLowerCase();

      if (inputVal && lookupMap.has(inputVal)) {
        const fields = lookupMap.get(inputVal)!;
        const updatedData = {
          ...data,
          [targetColumnId]: {
            value: 'matched',
            status: 'complete' as const,
            enrichmentData: fields,
          },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        matchedCount++;
      } else {
        const updatedData = {
          ...data,
          [targetColumnId]: {
            value: null,
            status: 'complete' as const,
            enrichmentData: { __no_match: 'no source row matched' },
          },
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
    });
  } catch (error) {
    console.error('Lookup error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Lookup failed' },
      { status: 500 }
    );
  }
}
