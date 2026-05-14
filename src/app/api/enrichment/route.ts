import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId } from '@/lib/utils';

// GET /api/enrichment - Get all enrichment configs
export async function GET() {
  try {
    const configs = await db.select().from(schema.enrichmentConfigs);
    return NextResponse.json(configs);
  } catch (error) {
    console.error('Error fetching enrichment configs:', error);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
}

// POST /api/enrichment - Create enrichment config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      model = 'gemini-1.5-flash',
      prompt,
      inputColumns,
      outputColumns,
      temperature = 0.7,
      costLimitEnabled = false,
      maxCostPerRow = null,
      webSearchEnabled = false,
      webSearchProvider = 'spider',
    } = body;

    if (!name || !prompt || !inputColumns) {
      return NextResponse.json(
        { error: 'name, prompt, and inputColumns are required' },
        { status: 400 }
      );
    }

    // Smart default: structured output when outputColumns is set, plain text otherwise.
    const outputFormat: 'json' | 'text' =
      body.outputFormat ?? ((outputColumns?.length ?? 0) > 0 ? 'json' : 'text');

    const config = {
      id: generateId(),
      name,
      model,
      prompt,
      inputColumns,
      outputColumns: outputColumns || [],
      outputFormat,
      temperature,
      costLimitEnabled,
      maxCostPerRow,
      webSearchEnabled: !!webSearchEnabled,
      webSearchProvider: webSearchProvider || 'spider',
      createdAt: new Date(),
    };

    await db.insert(schema.enrichmentConfigs).values(config);

    return NextResponse.json(config, { status: 201 });
  } catch (error) {
    console.error('Error creating enrichment config:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to create config: ${errorMessage}` }, { status: 500 });
  }
}
