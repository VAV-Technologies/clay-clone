import { NextRequest, NextResponse } from 'next/server';
import { previewSearch } from '@/lib/wattdata-api';
import type { WattdataSearchFilters } from '@/lib/wattdata-api';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// POST /api/add-wattdata-data/preview — Get estimated total + sample results
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!process.env.WATTDATA_API_KEY) {
      return NextResponse.json({ error: 'WATTDATA_API_KEY not configured' }, { status: 500 });
    }

    const filters = (body.filters || {}) as WattdataSearchFilters;
    if (!filters.query?.trim()) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const logProgress = (msg: string) => console.log(`[wattdata-preview] ${msg}`);
    const result = await previewSearch(filters, logProgress);

    return NextResponse.json({
      estimatedTotal: result.estimatedTotal,
      previewCount: result.preview.length,
      preview: result.preview,
      traits: result.traits,
      expression: result.expression,
    });
  } catch (error) {
    console.error('Wattdata preview error:', error);
    const msg = error instanceof Error ? error.message : 'Preview failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
