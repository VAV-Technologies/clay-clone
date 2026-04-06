import { NextRequest, NextResponse } from 'next/server';
import { previewPeopleSearch, previewCompanySearch } from '@/lib/clay-api';
import type { ClaySearchFilters, ClayCompanySearchFilters } from '@/lib/clay-api';

export const runtime = 'nodejs';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// POST /api/add-data/preview — Get estimated total + 50 sample results before full search
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const searchType = body.searchType || 'people';

    if (!process.env.CLAY_EMAIL || !process.env.CLAY_PASSWORD) {
      return NextResponse.json({ error: 'Clay credentials not configured' }, { status: 500 });
    }
    if (!process.env.CLAY_WORKSPACE_ID) {
      return NextResponse.json({ error: 'CLAY_WORKSPACE_ID not configured' }, { status: 500 });
    }

    const logProgress = (msg: string) => console.log(`[preview] ${msg}`);

    if (searchType === 'companies') {
      const filters = (body.filters || {}) as ClayCompanySearchFilters;
      const result = await previewCompanySearch(filters, logProgress);

      return NextResponse.json({
        searchType: 'companies',
        estimatedTotal: result.estimatedTotal,
        previewCount: result.preview.length,
        preview: result.preview,
      });
    }

    // People search
    const filters = (body.filters || {}) as ClaySearchFilters;
    const domains = (body.domains || []) as string[];
    const result = await previewPeopleSearch(domains, filters, logProgress);

    return NextResponse.json({
      searchType: 'people',
      estimatedTotal: result.estimatedTotal,
      previewCount: result.preview.length,
      preview: result.preview,
      _debug: result._debugKeys || null,
    });
  } catch (error) {
    console.error('Preview search error:', error);
    const msg = error instanceof Error ? error.message : 'Preview failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
