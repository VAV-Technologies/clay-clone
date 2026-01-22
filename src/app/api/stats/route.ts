import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const maxDuration = 60;

// GET /api/stats - Get database storage stats
export async function GET() {
  try {
    // Use COUNT queries instead of fetching all rows (much faster)
    const [projectCount, tableCount, columnCount, rowCount, enrichmentCount, formulaCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(schema.projects),
      db.select({ count: sql<number>`count(*)` }).from(schema.tables),
      db.select({ count: sql<number>`count(*)` }).from(schema.columns),
      db.select({ count: sql<number>`count(*)` }).from(schema.rows),
      db.select({ count: sql<number>`count(*)` }).from(schema.enrichmentConfigs),
      db.select({ count: sql<number>`count(*)` }).from(schema.formulaConfigs),
    ]);

    // Estimate storage based on row count
    // Turso free tier: 9GB storage, 500M row reads/month
    // Rough estimate: average row size ~500 bytes
    const totalRows = Number(rowCount[0]?.count ?? 0);
    const estimatedStorageBytes = totalRows * 500; // rough estimate

    // Turso free tier limits
    const maxStorageBytes = 9 * 1024 * 1024 * 1024; // 9GB
    const usagePercent = (estimatedStorageBytes / maxStorageBytes) * 100;

    return NextResponse.json({
      counts: {
        projects: Number(projectCount[0]?.count ?? 0),
        tables: Number(tableCount[0]?.count ?? 0),
        columns: Number(columnCount[0]?.count ?? 0),
        rows: totalRows,
        enrichmentConfigs: Number(enrichmentCount[0]?.count ?? 0),
        formulaConfigs: Number(formulaCount[0]?.count ?? 0),
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
