import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Device token cookie name
const DEVICE_TOKEN_COOKIE = 'dataflow_device_token';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow access to auth page, cron endpoints, and other public routes
  if (
    pathname === '/auth' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/fix-stuck') ||
    pathname.startsWith('/api/nuke-table') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // Check for device token
  const deviceToken = request.cookies.get(DEVICE_TOKEN_COOKIE)?.value;

  // If no valid device token, redirect to auth page
  if (!deviceToken) {
    const authUrl = new URL('/auth', request.url);
    authUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(authUrl);
  }

  // Verify token format (simple check - token should be a hash)
  if (deviceToken.length < 32) {
    const authUrl = new URL('/auth', request.url);
    authUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(authUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth).*)',
  ],
};
