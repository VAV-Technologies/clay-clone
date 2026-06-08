import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { MAX_FOLDER_DEPTH, getDepth, getSubtreeDepth, isDescendantOf } from '@/lib/db/folderTree';
import { collectAzureFileIdsForTable, deleteTableDependents, purgeAzureFiles } from '@/lib/db/cascade';

export const maxDuration = 60;

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

    // Get tables for this project
    const tables = await db
      .select()
      .from(schema.tables)
      .where(eq(schema.tables.projectId, id));

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

    if (parentId !== undefined) {
      if (parentId === id) {
        return NextResponse.json({ error: 'cannotBeOwnParent' }, { status: 400 });
      }
      if (parentId !== null) {
        const [parent] = await db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, parentId));
        if (!parent) {
          return NextResponse.json({ error: 'parentNotFound' }, { status: 400 });
        }
        if (parent.type !== 'folder') {
          return NextResponse.json({ error: 'parentNotFolder' }, { status: 400 });
        }
        if (await isDescendantOf(id, parentId)) {
          return NextResponse.json({ error: 'wouldCreateCycle' }, { status: 400 });
        }
        const parentDepth = await getDepth(parentId);
        const subtreeDepth = await getSubtreeDepth(id);
        if (parentDepth + 1 + subtreeDepth > MAX_FOLDER_DEPTH) {
          return NextResponse.json({ error: 'maxDepthExceeded', maxDepth: MAX_FOLDER_DEPTH }, { status: 400 });
        }
      }
      updates.parentId = parentId;
    }

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

    const [project] = await db
      .select({ id: schema.projects.id, type: schema.projects.type })
      .from(schema.projects)
      .where(eq(schema.projects.id, id));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // A folder must be emptied before it can be deleted — we never silently
    // nuke its contents. Block while it still holds sub-folders or workbooks
    // so the user deletes those first.
    if (project.type === 'folder') {
      const childProjects = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.parentId, id));
      if (childProjects.length > 0) {
        return NextResponse.json(
          { error: 'folderNotEmpty', childCount: childProjects.length },
          { status: 409 }
        );
      }
    }

    // Empty folder or a workbook/table: safe to delete. The recursive helper
    // cascades a workbook's sheets and their dependents; for an empty folder it
    // just removes the folder row.
    const azureFileIds: string[] = [];
    await deleteProjectRecursive(id, azureFileIds);
    await purgeAzureFiles(azureFileIds);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}

// Deletes a project and everything under it. Uses ONE transaction PER PROJECT
// node (not one for the whole subtree): Turso is single-writer and a folder can
// hold most of the dataset, so a subtree-wide tx would hold the write lock for
// the entire cascade and risk the 60s maxDuration. Each node's delete is
// internally consistent and the operation is delete-only / safely re-runnable.
async function deleteProjectRecursive(projectId: string, azureFileIds: string[]) {
  // Find all children
  const children = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.parentId, projectId));

  // Delete children first
  for (const child of children) {
    await deleteProjectRecursive(child.id, azureFileIds);
  }

  // Tables directly under this project.
  const projectTables = await db
    .select({ id: schema.tables.id })
    .from(schema.tables)
    .where(eq(schema.tables.projectId, projectId));
  const tableIds = projectTables.map((t) => t.id);

  // Collect Azure file ids before anything is deleted.
  for (const tid of tableIds) {
    azureFileIds.push(...(await collectAzureFileIdsForTable(db, tid)));
  }

  await db.transaction(async (tx) => {
    // Per-table non-cascading dependents (jobs, columns, orphaned configs).
    for (const tid of tableIds) {
      await deleteTableDependents(tx, tid);
    }
    // Rows for all of this project's tables.
    if (tableIds.length) {
      await tx.delete(schema.rows).where(inArray(schema.rows.tableId, tableIds));
    }
    // Campaigns are keyed to a workbook (project) id with no FK — clean them too.
    await tx.delete(schema.campaigns).where(eq(schema.campaigns.workbookId, projectId));
    // Tables, then the project itself.
    await tx.delete(schema.tables).where(eq(schema.tables.projectId, projectId));
    await tx.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });
}
