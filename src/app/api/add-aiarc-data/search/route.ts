import { NextRequest, NextResponse } from 'next/server';
import { searchPeople, searchCompanies } from '@/lib/aiarc-api';
import type { AiArcPeopleFilters, AiArcCompanyFilters } from '@/lib/aiarc-api';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// POST /api/add-aiarc-data/search — Full paginated search
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const searchType = body.searchType || 'people';
    const limit = body.limit || 100;

    if (!process.env.AI_ARC_API_KEY) {
      return NextResponse.json({ error: 'AI_ARC_API_KEY not configured' }, { status: 500 });
    }

    const logProgress = (msg: string) => console.log(`[aiarc-search] ${msg}`);

    if (searchType === 'companies') {
      const filters = (body.filters || {}) as AiArcCompanyFilters;
      console.log('[aiarc-search] Company search with filters:', JSON.stringify(filters));

      const result = await searchCompanies(filters, limit, logProgress);
      console.log(`[aiarc-search] Found ${result.totalCount} companies, fetched ${result.items.length}`);

      return NextResponse.json({
        companies: result.items,
        totalCount: result.totalCount,
      });
    }

    // People search
    const filters = (body.filters || {}) as AiArcPeopleFilters;
    console.log('[aiarc-search] People search with filters:', JSON.stringify(filters));

    const result = await searchPeople(filters, limit, logProgress);
    console.log(`[aiarc-search] Found ${result.totalCount} people, fetched ${result.items.length}`);

    return NextResponse.json({
      people: result.items,
      totalCount: result.totalCount,
    });
  } catch (error) {
    console.error('[aiarc-search] Search error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Search failed' },
      { status: 500 }
    );
  }
}
