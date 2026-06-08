import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { tableExists } from '@/lib/api-validation';

// GET /api/export/csv?tableId=xxx - Export CSV via query param (for API access)
export async function GET(request: NextRequest) {
  const tableId = request.nextUrl.searchParams.get('tableId');
  if (!tableId) {
    return NextResponse.json({ error: 'tableId query param is required' }, { status: 400 });
  }
  // Reuse POST logic
  const fakeRequest = { json: async () => ({ tableId }) } as NextRequest;
  return POST(fakeRequest);
}

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
    if (!(await tableExists(tableId))) {
      return NextResponse.json({ error: 'Table not found', tableId }, { status: 404 });
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
      return columns.map((col) => escapeCSV(exportCellValue(col, row.data[col.id])));
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

// Enrichment columns store an internal display token (e.g. 'matched',
// 'N datapoints') in cell.value while the real data lives in enrichmentData.
// Export the meaningful data so it isn't lost (QA finding C4-011): a single
// datapoint exports as its scalar; multiple datapoints export as JSON.
function exportCellValue(
  col: { type: string },
  cell: { value?: string | number | null; enrichmentData?: Record<string, unknown> } | undefined
): string {
  if (!cell) return '';
  if (col.type === 'enrichment' && cell.enrichmentData && typeof cell.enrichmentData === 'object') {
    const entries = Object.entries(cell.enrichmentData).filter(([k]) => k !== '__no_match');
    if (entries.length === 0) return cell.value?.toString() ?? '';
    if (entries.length === 1) return entries[0][1]?.toString() ?? '';
    return JSON.stringify(Object.fromEntries(entries));
  }
  return cell.value?.toString() ?? '';
}

function escapeCSV(value: string): string {
  // If the value contains comma, newline, or double quote, wrap in quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    // Escape double quotes by doubling them
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
