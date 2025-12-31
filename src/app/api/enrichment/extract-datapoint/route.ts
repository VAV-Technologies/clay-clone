import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

function generateId() {
  return nanoid(12);
}

// POST /api/enrichment/extract-datapoint - Extract a datapoint from enrichment data to a new column
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tableId, sourceColumnId, dataKey } = body;

    if (!tableId || !sourceColumnId || !dataKey) {
      return NextResponse.json(
        { error: 'tableId, sourceColumnId, and dataKey are required' },
        { status: 400 }
      );
    }

    // Verify the source column exists and is an enrichment column
    const [sourceColumn] = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.id, sourceColumnId));

    if (!sourceColumn) {
      return NextResponse.json({ error: 'Source column not found' }, { status: 404 });
    }

    if (sourceColumn.type !== 'enrichment') {
      return NextResponse.json(
        { error: 'Source column is not an enrichment column' },
        { status: 400 }
      );
    }

    // Get the max order for new column placement
    const existingColumns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    const maxOrder = existingColumns.reduce((m, col) => Math.max(m, col.order), 0);
    const newOrder = maxOrder + 1;

    // Create the new column
    const newColumnId = generateId();
    const newColumn = {
      id: newColumnId,
      tableId,
      name: dataKey, // Use the datapoint key as the column name
      type: 'text' as const,
      width: 150,
      order: newOrder,
      enrichmentConfigId: null,
    };

    await db.insert(schema.columns).values(newColumn);

    // Get all rows for this table
    const rows = await db
      .select()
      .from(schema.rows)
      .where(eq(schema.rows.tableId, tableId));

    // Extract the datapoint value from each row's enrichment data and populate the new column
    for (const row of rows) {
      // row.data is already parsed as an object by Drizzle
      const rowData = (row.data || {}) as Record<string, unknown>;
      const enrichmentCellData = rowData[sourceColumnId] as Record<string, unknown> | undefined;
      let extractedValue: string | number | null = null;

      console.log(`Processing row ${row.id}:`, {
        hasSourceColumn: !!enrichmentCellData,
        hasEnrichmentData: !!enrichmentCellData?.enrichmentData,
        dataKey,
        enrichmentData: enrichmentCellData?.enrichmentData
      });

      // Try to get the value from enrichmentData
      if (enrichmentCellData?.enrichmentData && typeof enrichmentCellData.enrichmentData === 'object') {
        const dataValue = enrichmentCellData.enrichmentData[dataKey];
        if (dataValue !== undefined) {
          extractedValue = dataValue;
        }
      }

      // Fallback for legacy data: if looking for "result" key and no enrichmentData, use the value directly
      if (extractedValue === null && dataKey === 'result' && enrichmentCellData?.value !== undefined) {
        extractedValue = enrichmentCellData.value;
      }

      console.log(`Extracted value for row ${row.id}:`, extractedValue);

      // Update the row with the new column value
      const updatedData = {
        ...rowData,
        [newColumnId]: {
          value: extractedValue,
          status: extractedValue !== null ? 'complete' : undefined,
        },
      };

      await db
        .update(schema.rows)
        .set({ data: updatedData })
        .where(eq(schema.rows.id, row.id));
    }

    return NextResponse.json({
      success: true,
      column: newColumn,
      rowsUpdated: rows.length,
    });
  } catch (error) {
    console.error('Error extracting datapoint:', error);
    return NextResponse.json(
      { error: 'Failed to extract datapoint to column' },
      { status: 500 }
    );
  }
}
