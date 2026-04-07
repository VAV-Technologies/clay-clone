import { NextRequest, NextResponse } from 'next/server';
import { previewPeopleSearch, previewCompanySearch } from '@/lib/aiarc-api';
import type { AiArcPeopleFilters, AiArcCompanyFilters } from '@/lib/aiarc-api';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// POST /api/add-aiarc-data/preview — Get estimated total + 20 sample results
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const searchType = body.searchType || 'people';

    if (!process.env.AI_ARC_API_KEY) {
      return NextResponse.json({ error: 'AI_ARC_API_KEY not configured' }, { status: 500 });
    }

    const logProgress = (msg: string) => console.log(`[aiarc-preview] ${msg}`);

    if (searchType === 'companies') {
      const filters = (body.filters || {}) as AiArcCompanyFilters;
      const result = await previewCompanySearch(filters, logProgress);

      return NextResponse.json({
        searchType: 'companies',
        estimatedTotal: result.estimatedTotal,
        previewCount: result.preview.length,
        preview: result.preview,
      });
    }

    // People search
    const filters = (body.filters || {}) as AiArcPeopleFilters;
    const result = await previewPeopleSearch(filters, logProgress);

    return NextResponse.json({
      searchType: 'people',
      estimatedTotal: result.estimatedTotal,
      previewCount: result.preview.length,
      preview: result.preview,
    });
  } catch (error) {
    console.error('AI Ark preview error:', error);
    const msg = error instanceof Error ? error.message : 'Preview failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
