import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

// GET /api/enrichment/[id] - Get a single enrichment config
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [config] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, id));

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('Error fetching enrichment config:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

// PATCH /api/enrichment/[id] - Update an enrichment config
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { model, prompt, temperature, maxTokens, inputColumns, outputColumns, outputFormat } = body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (model !== undefined) updateData.model = model;
    if (prompt !== undefined) updateData.prompt = prompt;
    if (temperature !== undefined) updateData.temperature = temperature;
    if (maxTokens !== undefined) updateData.maxTokens = maxTokens;
    if (inputColumns !== undefined) updateData.inputColumns = inputColumns;
    if (outputColumns !== undefined) updateData.outputColumns = outputColumns;
    if (outputFormat !== undefined) updateData.outputFormat = outputFormat;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await db
      .update(schema.enrichmentConfigs)
      .set(updateData)
      .where(eq(schema.enrichmentConfigs.id, id));

    // Fetch the updated config
    const [updated] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, id));

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating enrichment config:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}

// DELETE /api/enrichment/[id] - Delete an enrichment config
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.delete(schema.enrichmentConfigs).where(eq(schema.enrichmentConfigs.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting enrichment config:', error);
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 });
  }
}
