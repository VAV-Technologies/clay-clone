import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  cleanFullName,
  combineNames,
  cleanDomain,
  getVerificationToken,
  findEmail,
} from '@/lib/ninja-email';

/**
 * POST /api/ninja-email/run
 * Test run on a single row (synchronous)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tableId,
      rowId,
      inputMode,
      fullNameColumnId,
      firstNameColumnId,
      lastNameColumnId,
      domainColumnId,
    } = body;

    // Validate required fields
    if (!tableId || !rowId || !inputMode || !domainColumnId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get API key from env variable
    const apiKey = process.env.MAILNINJA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'MailNinja API key not configured on server' },
        { status: 500 }
      );
    }

    // Get the row
    const [row] = await db
      .select()
      .from(schema.rows)
      .where(
        and(
          eq(schema.rows.id, rowId),
          eq(schema.rows.tableId, tableId)
        )
      );

    if (!row) {
      return NextResponse.json(
        { error: 'Row not found' },
        { status: 404 }
      );
    }

    // Extract name
    let name: string;
    if (inputMode === 'fullName') {
      const fullNameValue = row.data[fullNameColumnId]?.value;
      name = cleanFullName(String(fullNameValue || ''));
    } else {
      const firstName = row.data[firstNameColumnId]?.value;
      const lastName = row.data[lastNameColumnId]?.value;
      name = combineNames(String(firstName || ''), String(lastName || ''));
    }

    // Extract domain
    const domainValue = row.data[domainColumnId]?.value;
    const domain = cleanDomain(String(domainValue || ''));

    if (!name) {
      return NextResponse.json({
        success: false,
        error: 'No valid name found in row',
      });
    }

    if (!domain) {
      return NextResponse.json({
        success: false,
        error: 'No valid domain found in row',
      });
    }

    // Get API token
    const token = await getVerificationToken(apiKey);

    // Find email
    const result = await findEmail(name, domain, token);

    if (result.success) {
      return NextResponse.json({
        success: true,
        email: result.email,
        status: result.status,
        confidence: result.confidence,
        name,
        domain,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error || 'No valid email found',
        name,
        domain,
      });
    }

  } catch (error) {
    console.error('Error running ninja email test:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Test failed' },
      { status: 500 }
    );
  }
}
