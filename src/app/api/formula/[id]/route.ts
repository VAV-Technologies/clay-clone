import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

// GET /api/formula/[id] - Get a single formula config
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [config] = await db
      .select()
      .from(schema.formulaConfigs)
      .where(eq(schema.formulaConfigs.id, id));

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('Error fetching formula config:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

// PATCH /api/formula/[id] - Update a formula config
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, formula } = body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (formula !== undefined) updateData.formula = formula;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await db
      .update(schema.formulaConfigs)
      .set(updateData)
      .where(eq(schema.formulaConfigs.id, id));

    // Fetch the updated config
    const [updated] = await db
      .select()
      .from(schema.formulaConfigs)
      .where(eq(schema.formulaConfigs.id, id));

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating formula config:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}

// DELETE /api/formula/[id] - Delete a formula config
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.delete(schema.formulaConfigs).where(eq(schema.formulaConfigs.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting formula config:', error);
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 });
  }
}
