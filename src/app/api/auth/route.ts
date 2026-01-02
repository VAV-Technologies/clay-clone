import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const DEVICE_TOKEN_COOKIE = 'dataflow_device_token';
const TOKEN_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

// Generate a unique device token
function generateDeviceToken(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  const randomPart2 = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomPart}-${randomPart2}`;
}

// POST /api/auth - Verify password and set device token
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    const sitePassword = process.env.SITE_PASSWORD;

    if (!sitePassword) {
      // No password set - allow access
      const token = generateDeviceToken();
      const cookieStore = await cookies();
      cookieStore.set(DEVICE_TOKEN_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: TOKEN_MAX_AGE,
        path: '/',
      });
      return NextResponse.json({ success: true });
    }

    if (password !== sitePassword) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }

    // Password correct - generate and set device token
    const token = generateDeviceToken();
    const cookieStore = await cookies();
    cookieStore.set(DEVICE_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: TOKEN_MAX_AGE,
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// GET /api/auth - Check if device is authenticated
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEVICE_TOKEN_COOKIE)?.value;

  return NextResponse.json({
    authenticated: !!token && token.length >= 32,
  });
}
