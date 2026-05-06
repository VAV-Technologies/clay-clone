import { eq } from 'drizzle-orm';
import { db, schema } from './index';
import type { Project } from './schema';

export const MAX_FOLDER_DEPTH = 5;

export async function getDepth(folderId: string | null): Promise<number> {
  let depth = 0;
  let cursor: string | null = folderId;
  while (cursor) {
    const [parent] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, cursor));
    if (!parent) break;
    depth += 1;
    cursor = parent.parentId;
    if (depth > MAX_FOLDER_DEPTH + 2) break;
  }
  return depth;
}

export async function getSubtreeDepth(rootId: string): Promise<number> {
  const children = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.parentId, rootId));
  if (children.length === 0) return 0;
  let max = 0;
  for (const child of children) {
    const d = await getSubtreeDepth(child.id);
    if (d + 1 > max) max = d + 1;
  }
  return max;
}

export async function isDescendantOf(maybeAncestorId: string, startId: string): Promise<boolean> {
  let cursor: string | null = startId;
  let hops = 0;
  while (cursor) {
    if (cursor === maybeAncestorId) return true;
    const rows: Project[] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, cursor));
    const row = rows[0];
    if (!row) return false;
    cursor = row.parentId;
    hops += 1;
    if (hops > MAX_FOLDER_DEPTH + 2) return false;
  }
  return false;
}
