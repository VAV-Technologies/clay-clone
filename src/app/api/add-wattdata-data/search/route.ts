import { NextRequest, NextResponse } from 'next/server';
import { fullSearch } from '@/lib/wattdata-api';
import type { WattdataSearchFilters } from '@/lib/wattdata-api';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// POST /api/add-wattdata-data/search — Full audience search
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const limit = body.limit || 100;

    if (!process.env.WATTDATA_API_KEY) {
      return NextResponse.json({ error: 'WATTDATA_API_KEY not configured' }, { status: 500 });
    }

    const filters = (body.filters || {}) as WattdataSearchFilters;
    if (!filters.query?.trim()) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const logProgress = (msg: string) => console.log(`[wattdata-search] ${msg}`);
    console.log('[wattdata-search] Full search with filters:', JSON.stringify(filters));

    const result = await fullSearch(filters, limit, logProgress);
    console.log(`[wattdata-search] Found ${result.totalCount} people, fetched ${result.items.length}`);

    return NextResponse.json({
      people: result.items,
      totalCount: result.totalCount,
    });
  } catch (error) {
    console.error('[wattdata-search] Search error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Search failed' },
      { status: 500 }
    );
  }
}
