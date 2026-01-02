import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';

// GET /api/stats - Get database storage stats
export async function GET() {
  try {
    // Count rows in each table by fetching all and counting
    const projects = await db.select().from(schema.projects);
    const tables = await db.select().from(schema.tables);
    const columns = await db.select().from(schema.columns);
    const rows = await db.select().from(schema.rows);
    const enrichmentConfigs = await db.select().from(schema.enrichmentConfigs);
    const formulaConfigs = await db.select().from(schema.formulaConfigs);

    // Estimate storage based on row count
    // Turso free tier: 9GB storage, 500M row reads/month
    // Rough estimate: average row size ~500 bytes
    const totalRows = rows.length;
    const estimatedStorageBytes = totalRows * 500; // rough estimate

    // Turso free tier limits
    const maxStorageBytes = 9 * 1024 * 1024 * 1024; // 9GB
    const usagePercent = (estimatedStorageBytes / maxStorageBytes) * 100;

    return NextResponse.json({
      counts: {
        projects: projects.length,
        tables: tables.length,
        columns: columns.length,
        rows: totalRows,
        enrichmentConfigs: enrichmentConfigs.length,
        formulaConfigs: formulaConfigs.length,
      },
      storage: {
        estimatedBytes: estimatedStorageBytes,
        estimatedMB: Math.round(estimatedStorageBytes / (1024 * 1024) * 100) / 100,
        maxBytes: maxStorageBytes,
        maxGB: 9,
        usagePercent: Math.round(usagePercent * 100) / 100,
      },
      limits: {
        tier: 'Free',
        maxStorage: '9 GB',
        maxRowReads: '500M/month',
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
