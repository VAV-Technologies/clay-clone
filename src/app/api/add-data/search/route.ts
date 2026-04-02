import { NextRequest, NextResponse } from 'next/server';
import { searchPeople, type ClaySearchFilters } from '@/lib/clay-api';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { domains, filters } = await request.json() as {
      domains: string[];
      filters: ClaySearchFilters;
    };

    if (!domains || !Array.isArray(domains) || domains.length === 0) {
      return NextResponse.json({ error: 'At least one domain is required' }, { status: 400 });
    }

    if (!process.env.CLAY_EMAIL || !process.env.CLAY_PASSWORD) {
      return NextResponse.json({ error: 'Clay credentials not configured (CLAY_EMAIL, CLAY_PASSWORD)' }, { status: 500 });
    }

    if (!process.env.CLAY_WORKSPACE_ID) {
      return NextResponse.json({ error: 'CLAY_WORKSPACE_ID not configured' }, { status: 500 });
    }

    // Clean domains
    const cleanDomains = domains
      .map(d => d.trim().toLowerCase())
      .filter(d => d.length > 0)
      .map(d => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''));

    const uniqueDomains = [...new Set(cleanDomains)];

    console.log(`[add-data] Searching ${uniqueDomains.length} domains with filters:`, JSON.stringify(filters));

    const result = await searchPeople(uniqueDomains, filters || {}, (msg) => {
      console.log(`[add-data] ${msg}`);
    });

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
