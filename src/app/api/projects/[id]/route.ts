import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

// GET /api/projects/[id] - Get single project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id));

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get tables if it's a workbook
    let tables: typeof schema.tables.$inferSelect[] = [];
    if (project.type === 'workbook') {
      tables = await db
        .select()
        .from(schema.tables)
        .where(eq(schema.tables.projectId, id));
    }

    return NextResponse.json({ ...project, tables });
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
  }
}

// PATCH /api/projects/[id] - Update project
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, parentId } = body;

    const [existing] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id));

    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const updates: Partial<typeof schema.projects.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updates.name = name;
    if (parentId !== undefined) updates.parentId = parentId;

    await db
      .update(schema.projects)
      .set(updates)
      .where(eq(schema.projects.id, id));

    return NextResponse.json({ ...existing, ...updates });
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

// DELETE /api/projects/[id] - Delete project (cascades to tables)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Delete all child projects recursively
    await deleteProjectRecursive(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}

async function deleteProjectRecursive(projectId: string) {
  // Find all children
  const children = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.parentId, projectId));

  // Delete children first
  for (const child of children) {
    await deleteProjectRecursive(child.id);
  }

  // Delete tables associated with this project
  await db.delete(schema.tables).where(eq(schema.tables.projectId, projectId));

  // Delete the project itself
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
}
