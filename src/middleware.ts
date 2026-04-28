import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const DEVICE_TOKEN_COOKIE = 'dataflow_device_token';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth required
  if (
    pathname === '/auth' ||
    pathname === '/api-docs' ||
    pathname.startsWith('/api/docs/') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/fix-stuck') ||
    pathname.startsWith('/api/nuke-table') ||
    pathname.startsWith('/api/find-email/ai-ark/webhook') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // API Key auth — check Authorization: Bearer <key> header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7);
    const validKey = process.env.DATAFLOW_API_KEY;
    if (validKey && apiKey === validKey) {
      return NextResponse.next();
    }
    // Invalid API key — return 401 for API requests
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }
  }

  // Cookie auth — check device token (for browser/UI access)
  const deviceToken = request.cookies.get(DEVICE_TOKEN_COOKIE)?.value;

  if (!deviceToken || deviceToken.length < 32) {
    // API requests get 401, page requests get redirected to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required. Use Authorization: Bearer <API_KEY> header.' }, { status: 401 });
    }
    const authUrl = new URL('/auth', request.url);
    authUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(authUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth).*)',
  ],
};
