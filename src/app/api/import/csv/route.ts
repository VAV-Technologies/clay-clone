import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

interface CsvRow {
  [key: string]: string;
}

// POST /api/import/csv - Import CSV data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tableId,
      projectId,
      tableName,
      data,
      columnMapping,
      mode = 'create', // 'create', 'append', 'replace'
    } = body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: 'No data provided' }, { status: 400 });
    }

    const now = new Date();
    let targetTableId = tableId;
    let columns: typeof schema.columns.$inferSelect[] = [];

    if (mode === 'create') {
      // Create new table
      if (!projectId || !tableName) {
        return NextResponse.json(
          { error: 'projectId and tableName required for create mode' },
          { status: 400 }
        );
      }

      targetTableId = generateId();

      await db.insert(schema.tables).values({
        id: targetTableId,
        projectId,
        name: tableName,
        createdAt: now,
        updatedAt: now,
      });

      // Infer columns from first row
      const firstRow = data[0] as CsvRow;
      const columnNames = Object.keys(firstRow);

      columns = columnNames.map((name, index) => ({
        id: generateId(),
        tableId: targetTableId,
        name: columnMapping?.[name] || name,
        type: inferColumnType(firstRow[name]) as 'text' | 'number' | 'email' | 'url' | 'date' | 'enrichment',
        width: 150,
        order: index,
        enrichmentConfigId: null,
      }));

      await db.insert(schema.columns).values(columns);
    } else {
      // Get existing table and columns
      if (!tableId) {
        return NextResponse.json({ error: 'tableId required for append/replace mode' }, { status: 400 });
      }

      columns = await db
        .select()
        .from(schema.columns)
        .where(eq(schema.columns.tableId, tableId));

      if (mode === 'replace') {
        // Delete existing rows
        await db.delete(schema.rows).where(eq(schema.rows.tableId, tableId));
      }
    }

    // Create column name to ID mapping
    const columnNameToId = new Map(columns.map((col) => [col.name.toLowerCase(), col.id]));

    // Transform data into rows
    const rows = data.map((rowData: CsvRow) => {
      const cellData: Record<string, { value: string | number | null }> = {};

      Object.entries(rowData).forEach(([key, value]) => {
        const mappedName = columnMapping?.[key] || key;
        const columnId = columnNameToId.get(mappedName.toLowerCase());

        if (columnId) {
          cellData[columnId] = {
            value: value || null,
          };
        }
      });

      return {
        id: generateId(),
        tableId: targetTableId,
        data: cellData,
        createdAt: now,
      };
    });

    // Insert rows in batches
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await db.insert(schema.rows).values(batch);
    }

    // Update table's updatedAt
    await db
      .update(schema.tables)
      .set({ updatedAt: now })
      .where(eq(schema.tables.id, targetTableId));

    return NextResponse.json({
      success: true,
      tableId: targetTableId,
      rowsImported: rows.length,
      columnsCreated: mode === 'create' ? columns.length : 0,
    });
  } catch (error) {
    console.error('Error importing CSV:', error);
    return NextResponse.json({ error: 'Failed to import CSV' }, { status: 500 });
  }
}

function inferColumnType(value: string): string {
  if (!value) return 'text';

  // Check for email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'email';
  }

  // Check for URL
  if (/^https?:\/\//.test(value)) {
    return 'url';
  }

  // Check for number
  if (!isNaN(Number(value)) && value.trim() !== '') {
    return 'number';
  }

  // Check for date
  const dateFormats = [
    /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
    /^\d{2}-\d{2}-\d{4}$/, // DD-MM-YYYY
  ];
  if (dateFormats.some((format) => format.test(value))) {
    return 'date';
  }

  return 'text';
}
