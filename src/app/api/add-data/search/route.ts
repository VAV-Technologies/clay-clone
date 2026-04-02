import { NextRequest, NextResponse } from 'next/server';
import { searchPeople, searchCompanies, type ClaySearchFilters, type ClayCompanySearchFilters } from '@/lib/clay-api';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const searchType = body.searchType || 'people';

    if (!process.env.CLAY_EMAIL || !process.env.CLAY_PASSWORD) {
      return NextResponse.json({ error: 'Clay credentials not configured (CLAY_EMAIL, CLAY_PASSWORD)' }, { status: 500 });
    }

    if (!process.env.CLAY_WORKSPACE_ID) {
      return NextResponse.json({ error: 'CLAY_WORKSPACE_ID not configured' }, { status: 500 });
    }

    const logProgress = (msg: string) => console.log(`[add-data] ${msg}`);

    if (searchType === 'companies') {
      const filters = (body.filters || {}) as ClayCompanySearchFilters;
      console.log('[add-data] Company search with filters:', JSON.stringify(filters));

      const result = await searchCompanies(filters, logProgress);
      console.log(`[add-data] Found ${result.totalCount} companies`);

      return NextResponse.json(result);
    }

    // People search
    const domains = body.domains as string[];
    const filters = (body.filters || {}) as ClaySearchFilters;

    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return NextResponse.json({ error: 'At least one domain is required for people search' }, { status: 400 });
    }

    const cleanDomains = domains
      .map((d: string) => d.trim().toLowerCase())
      .filter((d: string) => d.length > 0)
      .map((d: string) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''));

    const uniqueDomains = [...new Set(cleanDomains)];
    console.log(`[add-data] People search: ${uniqueDomains.length} domains, filters:`, JSON.stringify(filters));

    const result = await searchPeople(uniqueDomains, filters, logProgress);
    console.log(`[add-data] Found ${result.totalCount} people (mode: ${result.mode})`);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[add-data] Search error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Search failed' },
      { status: 500 }
    );
  }
}
