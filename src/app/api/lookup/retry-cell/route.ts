import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { CellValue } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

// POST /api/lookup/retry-cell — replay the lookup for a single row using the
// stored column.actionConfig. Walks the source sheet for that one row's
// match value and writes the matched fields into enrichmentData.

export async function POST(request: NextRequest) {
  try {
    const { rowId, columnId, tableId } = await request.json();
    if (!rowId || !columnId || !tableId) {
      return NextResponse.json({ error: 'rowId, columnId, tableId required' }, { status: 400 });
    }

    const [column] = await db.select().from(schema.columns).where(eq(schema.columns.id, columnId));
    if (!column || column.actionKind !== 'lookup') {
      return NextResponse.json({ error: 'Column is not a lookup column' }, { status: 400 });
    }

    const config = (column.actionConfig as Record<string, unknown> | null) || {};
    const sourceTableId = config.sourceTableId as string | undefined;
    const inputColumnId = config.inputColumnId as string | undefined;
    const matchColumnId = config.matchColumnId as string | undefined;

    if (!sourceTableId || !inputColumnId || !matchColumnId) {
      return NextResponse.json({ error: 'Column actionConfig is missing required fields' }, { status: 400 });
    }

    const [row] = await db.select().from(schema.rows).where(eq(schema.rows.id, rowId));
    if (!row) return NextResponse.json({ error: 'Row not found' }, { status: 404 });

    const data = (row.data as Record<string, CellValue>) || {};
    const inputVal = data[inputColumnId]?.value?.toString().trim().toLowerCase();

    if (!inputVal) {
      const updated = {
        ...data,
        [columnId]: {
          value: null,
          status: 'complete' as const,
          enrichmentData: { __no_match: 'input cell empty' },
        },
      };
      await db.update(schema.rows).set({ data: updated }).where(eq(schema.rows.id, rowId));
      return NextResponse.json({ success: true, matched: false });
    }

    // Walk source rows + columns; find match.
    const sourceRows = await db.select().from(schema.rows).where(eq(schema.rows.tableId, sourceTableId));
    const sourceColumns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, sourceTableId));
    const exposedSourceColumns = sourceColumns.filter(c => c.type !== 'enrichment');

    let matchedFields: Record<string, string | number | null> | null = null;
    for (const sr of sourceRows) {
      const sd = sr.data as Record<string, CellValue>;
      const mv = sd[matchColumnId]?.value?.toString().trim().toLowerCase();
      if (mv === inputVal) {
        const fields: Record<string, string | number | null> = {};
        for (const col of exposedSourceColumns) {
          const cell = sd[col.id] as CellValue | undefined;
          const v = cell?.value;
          fields[col.name] = v === undefined ? null : (v as string | number | null);
        }
        matchedFields = fields;
        break;
      }
    }

    const updated = {
      ...data,
      [columnId]: matchedFields
        ? {
            value: 'matched',
            status: 'complete' as const,
            enrichmentData: matchedFields,
          }
        : {
            value: null,
            status: 'complete' as const,
            enrichmentData: { __no_match: 'no source row matched' },
          },
    };
    await db.update(schema.rows).set({ data: updated }).where(eq(schema.rows.id, rowId));

    return NextResponse.json({ success: true, matched: !!matchedFields });
  } catch (error) {
    console.error('[lookup/retry-cell] error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
