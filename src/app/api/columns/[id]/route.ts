import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { collectAzureFileIdsForColumn, deleteUnreferencedConfigs, purgeAzureFiles } from '@/lib/db/cascade';

// PATCH /api/columns/[id] - Update column
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, type, width, order, enrichmentConfigId } = body;

    const [existing] = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Column not found' }, { status: 404 });
    }

    const updates: Partial<typeof schema.columns.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (width !== undefined) updates.width = width;
    if (order !== undefined) updates.order = order;
    if (enrichmentConfigId !== undefined) updates.enrichmentConfigId = enrichmentConfigId;

    await db.update(schema.columns).set(updates).where(eq(schema.columns.id, id));

    // Update table's updatedAt
    if (existing.tableId) {
      await db
        .update(schema.tables)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tables.id, existing.tableId));
    }

    return NextResponse.json({ ...existing, ...updates });
  } catch (error) {
    console.error('Error updating column:', error);
    return NextResponse.json({ error: 'Failed to update column' }, { status: 500 });
  }
}

// DELETE /api/columns/[id] - Delete column
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [existing] = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Column not found' }, { status: 404 });
    }

    // Azure file ids live on batch_enrichment_jobs rows — grab them before deleting those rows.
    const azureFileIds = await collectAzureFileIdsForColumn(db, id);

    await db.transaction(async (tx) => {
      // If this is an enrichment column, cancel any running real-time jobs
      // (kept as an audit trail; not a bloat source while the table lives).
      if (existing.type === 'enrichment') {
        await tx
          .update(schema.enrichmentJobs)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(schema.enrichmentJobs.targetColumnId, id));
      }

      // Batch jobs targeting this column have no FK — delete them (orphan + Azure-file source).
      await tx
        .delete(schema.batchEnrichmentJobs)
        .where(eq(schema.batchEnrichmentJobs.targetColumnId, id));

      // Delete the column, then drop any config it leaves unreferenced.
      await tx.delete(schema.columns).where(eq(schema.columns.id, id));
      await deleteUnreferencedConfigs(tx, {
        enrichmentIds: existing.enrichmentConfigId ? [existing.enrichmentConfigId] : [],
        formulaIds: existing.formulaConfigId ? [existing.formulaConfigId] : [],
      });

      // Update table's updatedAt
      if (existing.tableId) {
        await tx
          .update(schema.tables)
          .set({ updatedAt: new Date() })
          .where(eq(schema.tables.id, existing.tableId));
      }
    });

    // Best-effort external cleanup (never blocks/faults the delete).
    await purgeAzureFiles(azureFileIds);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting column:', error);
    return NextResponse.json({ error: 'Failed to delete column' }, { status: 500 });
  }
}
