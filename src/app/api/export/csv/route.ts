import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';

// POST /api/export/csv - Generate CSV export
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tableId,
      rowIds, // Optional: export specific rows
      columnIds, // Optional: export specific columns
    } = body;

    if (!tableId) {
      return NextResponse.json({ error: 'tableId is required' }, { status: 400 });
    }

    // Get columns
    let columns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId))
      .orderBy(schema.columns.order);

    // Filter columns if specified
    if (columnIds && Array.isArray(columnIds) && columnIds.length > 0) {
      columns = columns.filter((col) => columnIds.includes(col.id));
    }

    // Get rows
    let rows;
    if (rowIds && Array.isArray(rowIds) && rowIds.length > 0) {
      rows = await db
        .select()
        .from(schema.rows)
        .where(inArray(schema.rows.id, rowIds));
    } else {
      rows = await db
        .select()
        .from(schema.rows)
        .where(eq(schema.rows.tableId, tableId));
    }

    // Build CSV content
    const headers = columns.map((col) => escapeCSV(col.name));
    const csvRows = rows.map((row) => {
      return columns.map((col) => {
        const cellValue = row.data[col.id];
        const value = cellValue?.value;
        return escapeCSV(value?.toString() ?? '');
      });
    });

    // Add BOM for Excel compatibility
    const BOM = '\uFEFF';
    const csvContent =
      BOM + [headers.join(','), ...csvRows.map((row) => row.join(','))].join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="export-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting CSV:', error);
    return NextResponse.json({ error: 'Failed to export CSV' }, { status: 500 });
  }
}

function escapeCSV(value: string): string {
  // If the value contains comma, newline, or double quote, wrap in quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    // Escape double quotes by doubling them
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
