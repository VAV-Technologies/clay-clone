import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { nanoid } from 'nanoid';

function generateId() {
  return nanoid(12);
}

// GET /api/formula - Get all formula configs
export async function GET() {
  try {
    const configs = await db.select().from(schema.formulaConfigs);
    return NextResponse.json(configs);
  } catch (error) {
    console.error('Error fetching formula configs:', error);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
}

// POST /api/formula - Create a new formula config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, formula } = body;

    if (!name || !formula) {
      return NextResponse.json(
        { error: 'name and formula are required' },
        { status: 400 }
      );
    }

    const now = new Date();
    const config = {
      id: generateId(),
      name,
      formula,
      createdAt: now,
    };

    await db.insert(schema.formulaConfigs).values(config);

    return NextResponse.json(config);
  } catch (error) {
    console.error('Error creating formula config:', error);
    return NextResponse.json({ error: 'Failed to create config' }, { status: 500 });
  }
}
