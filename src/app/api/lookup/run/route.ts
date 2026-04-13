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
      returnColumnId,
      targetColumnId,
      condition,
    } = await request.json();

    if (!tableId || !sourceTableId || !inputColumnId || !matchColumnId || !returnColumnId || !targetColumnId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Fetch all rows from source table and build lookup map
    const sourceRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sourceTableId));

    const lookupMap = new Map<string, string>();
    for (const row of sourceRows) {
      const data = row.data as Record<string, CellValue>;
      const matchVal = data[matchColumnId]?.value?.toString().trim().toLowerCase();
      const returnVal = data[returnColumnId]?.value?.toString() || '';
      if (matchVal) {
        lookupMap.set(matchVal, returnVal);
      }
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

    // 3. For each row, look up the value and write to target column
    for (const row of currentRows) {
      const data = row.data as Record<string, CellValue>;
      const inputVal = data[inputColumnId]?.value?.toString().trim().toLowerCase();

      if (inputVal && lookupMap.has(inputVal)) {
        const lookedUpValue = lookupMap.get(inputVal)!;
        const updatedData = {
          ...data,
          [targetColumnId]: { value: lookedUpValue, status: 'complete' as const },
        };
        await db.update(schema.rows).set({ data: updatedData }).where(eq(schema.rows.id, row.id));
        matchedCount++;
      } else {
        const updatedData = {
          ...data,
          [targetColumnId]: { value: '', status: 'complete' as const },
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
