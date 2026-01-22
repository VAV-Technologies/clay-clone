import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, isNull } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

export const maxDuration = 60;

// GET /api/projects - Get all projects in tree structure
export async function GET() {
  try {
    // Fetch projects and tables in parallel with reasonable limits to prevent timeouts
    const [allProjects, allTables] = await Promise.all([
      db.select().from(schema.projects).limit(1000),
      db.select({
        id: schema.tables.id,
        projectId: schema.tables.projectId,
        name: schema.tables.name,
        createdAt: schema.tables.createdAt,
        updatedAt: schema.tables.updatedAt,
      }).from(schema.tables).limit(5000),
    ]);

    type ProjectWithTree = typeof allProjects[0] & {
      children: ProjectWithTree[];
      tables: typeof allTables;
    };

    // Build tree structure
    const projectMap = new Map<string, ProjectWithTree>();
    allProjects.forEach((p) => {
      projectMap.set(p.id, { ...p, children: [], tables: [] });
    });

    // Add tables to their projects
    allTables.forEach((table) => {
      if (table.projectId) {
        const project = projectMap.get(table.projectId);
        if (project) {
          project.tables.push(table);
        }
      }
    });

    // Build tree
    const rootProjects: ProjectWithTree[] = [];
    projectMap.forEach((project) => {
      if (project.parentId) {
        const parent = projectMap.get(project.parentId);
        if (parent) {
          parent.children.push(project);
        }
      } else {
        rootProjects.push(project);
      }
    });

    return NextResponse.json(rootProjects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

// POST /api/projects - Create a new project or folder
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, parentId, type } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 });
    }

    const now = new Date();
    const project = {
      id: generateId(),
      name,
      parentId: parentId || null,
      type: type as 'folder' | 'workbook' | 'table',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.projects).values(project);

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
