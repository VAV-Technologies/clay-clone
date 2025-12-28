import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ valid: false, error: 'No API key provided' }, { status: 400 });
    }

    // Test the API key with a minimal Google Generative AI request
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    );

    if (response.ok) {
      return NextResponse.json({ valid: true });
    } else {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json(
        { valid: false, error: error.error?.message || 'Invalid API key' },
        { status: 400 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { valid: false, error: 'Connection failed' },
      { status: 500 }
    );
  }
}
