import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/settings/test-ninja-key
 * Test if a MailNinja API key is valid by getting a token
 */
export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ valid: false, error: 'API key is required' }, { status: 400 });
    }

    // Try to get a token from MailNinja API
    const response = await fetch('https://api.mailtester.ninja/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        return NextResponse.json({ valid: true });
      }
    }

    return NextResponse.json({ valid: false, error: 'Invalid API key' }, { status: 400 });

  } catch (error) {
    console.error('Error testing MailNinja API key:', error);
    return NextResponse.json(
      { valid: false, error: 'Failed to test API key' },
      { status: 500 }
    );
  }
}
