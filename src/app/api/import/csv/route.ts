import { NextRequest, NextResponse } from 'next/server';
import { db, schema, libsqlClient } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';
import type { InStatement } from '@libsql/client';

// Allow large request bodies for CSV imports
export const maxDuration = 60; // 60 seconds timeout
export const dynamic = 'force-dynamic';

interface CsvRow {
  [key: string]: string;
}

interface ColumnMappingEntry {
  targetColumnId?: string;
  newColumnName?: string;
}

// POST /api/import/csv - Import CSV data to an existing table
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tableId, data, columnMapping } = body;

    if (!tableId) {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 });
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: 'No data provided' }, { status: 400 });
    }

    const now = new Date();

    // Get existing columns
    const existingColumns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));

    // Build column ID map from existing columns
    const existingColumnById = new Map(existingColumns.map((c) => [c.id, c]));
    const existingColumnByName = new Map(existingColumns.map((c) => [c.name.toLowerCase(), c]));

    // Get CSV column names from first row
    const firstRow = data[0] as CsvRow;
    const csvColumnNames = Object.keys(firstRow);

    // Process column mapping
    const newColumns: typeof schema.columns.$inferSelect[] = [];
    let maxOrder = existingColumns.length > 0 ? Math.max(...existingColumns.map((c) => c.order)) : -1;

    // Build final mapping: csvColumnName -> columnId
    const csvToColumnId = new Map<string, string>();

    for (const csvColName of csvColumnNames) {
      const mappingEntry = columnMapping?.[csvColName] as ColumnMappingEntry | undefined;

      if (!mappingEntry) {
        // No mapping provided - try to auto-match by name or create new
        const existingCol = existingColumnByName.get(csvColName.toLowerCase());
        if (existingCol) {
          csvToColumnId.set(csvColName, existingCol.id);
        } else {
          // Create new column
          maxOrder++;
          const newCol = {
            id: generateId(),
            tableId,
            name: csvColName,
            type: inferColumnType(firstRow[csvColName]) as 'text' | 'number' | 'email' | 'url' | 'date' | 'enrichment' | 'formula',
            width: 150,
            order: maxOrder,
            enrichmentConfigId: null,
            formulaConfigId: null,
          };
          newColumns.push(newCol);
          csvToColumnId.set(csvColName, newCol.id);
        }
      } else if (mappingEntry.targetColumnId) {
        // Map to existing column by ID
        if (existingColumnById.has(mappingEntry.targetColumnId)) {
          csvToColumnId.set(csvColName, mappingEntry.targetColumnId);
        }
      } else if (mappingEntry.newColumnName) {
        // Check if a column with this name already exists
        const existingCol = existingColumnByName.get(mappingEntry.newColumnName.toLowerCase());
        if (existingCol) {
          csvToColumnId.set(csvColName, existingCol.id);
        } else {
          // Create new column with specified name
          maxOrder++;
          const newCol = {
            id: generateId(),
            tableId,
            name: mappingEntry.newColumnName,
            type: inferColumnType(firstRow[csvColName]) as 'text' | 'number' | 'email' | 'url' | 'date' | 'enrichment' | 'formula',
            width: 150,
            order: maxOrder,
            enrichmentConfigId: null,
            formulaConfigId: null,
          };
          newColumns.push(newCol);
          existingColumnByName.set(mappingEntry.newColumnName.toLowerCase(), newCol);
          csvToColumnId.set(csvColName, newCol.id);
        }
      }
      // If none of the above, column is skipped
    }

    // Insert new columns if any
    if (newColumns.length > 0) {
      await db.insert(schema.columns).values(newColumns);
    }

    // Transform data into rows
    const rows = data.map((rowData: CsvRow) => {
      const cellData: Record<string, { value: string | number | null }> = {};

      Object.entries(rowData).forEach(([csvColName, value]) => {
        const columnId = csvToColumnId.get(csvColName);

        if (columnId) {
          cellData[columnId] = {
            value: value || null,
          };
        }
      });

      return {
        id: generateId(),
        tableId,
        data: cellData,
        createdAt: now,
      };
    });

    // Insert rows using batch API for better performance
    if (libsqlClient && rows.length > 0) {
      // Use LibSQL batch API - sends all statements in a single HTTP request
      const statements: InStatement[] = rows.map((row) => ({
        sql: 'INSERT INTO rows (id, table_id, data, created_at) VALUES (?, ?, ?, ?)',
        args: [row.id, row.tableId, JSON.stringify(row.data), row.createdAt.getTime()],
      }));

      // Split into batches of 1000 statements to avoid hitting limits
      const BATCH_SIZE = 1000;
      for (let i = 0; i < statements.length; i += BATCH_SIZE) {
        const batch = statements.slice(i, i + BATCH_SIZE);
        await libsqlClient.batch(batch, 'write');
      }
    } else {
      // Fallback for local SQLite (non-Turso)
      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await db.insert(schema.rows).values(batch);
      }
    }

    // Update table's updatedAt
    await db
      .update(schema.tables)
      .set({ updatedAt: now })
      .where(eq(schema.tables.id, tableId));

    return NextResponse.json({
      success: true,
      tableId,
      rowsImported: rows.length,
      columnsCreated: newColumns.length,
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
