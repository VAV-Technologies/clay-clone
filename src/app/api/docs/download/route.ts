import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'API-REFERENCE.md');
    const content = await readFile(filePath, 'utf-8');

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="DATAFLOW-API-REFERENCE.md"',
      },
    });
  } catch {
    return NextResponse.json({ error: 'API reference file not found' }, { status: 404 });
  }
}
