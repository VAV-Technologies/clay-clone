// POST /api/enrichment/setup-and-run — CANONICAL FLOW for new AI enrichments.
//
// Mirrors what the EnrichmentPanel does in the UI as one atomic call:
//   1. Insert into enrichment_configs (model, prompt, outputColumns, temperature,
//      webSearchEnabled, etc.)
//   2. Insert into columns with type:'enrichment' and enrichmentConfigId set,
//      so the UI recognizes it (cell click → inspector, column header → run
//      dropdown, "Extract to column", etc.)
//   3. Run the enrichment over the requested rows via the shared runner —
//      same prompt building, same tool-calling loop, same metadata persistence.
//
// AI agents reading API-REFERENCE.md should use THIS endpoint when the user
// asks to enrich a column. The granular endpoints (POST /api/enrichment, POST
// /api/columns, POST /api/enrichment/run) remain for editing/iterating an
// existing config — not for setting one up from scratch.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { runEnrichmentJob } from '@/lib/enrichment-runner';

export const maxDuration = 120;

function generateId() {
  return nanoid(12);
}

interface SetupAndRunBody {
  tableId?: string;
  columnName?: string;
  prompt?: string;
  inputColumns?: string[];

  // Optional — sensible defaults when omitted
  model?: string;
  outputColumns?: string[];
  temperature?: number;
  webSearchEnabled?: boolean;
  webSearchProvider?: string;
  costLimitEnabled?: boolean;
  maxCostPerRow?: number | null;
  outputFormat?: 'text' | 'json';

  // Run scoping
  rowIds?: string[];
  onlyEmpty?: boolean;
  includeErrors?: boolean;
  forceRerun?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SetupAndRunBody;

    const {
      tableId,
      columnName,
      prompt,
      inputColumns,
      model = 'gpt-5-mini',
      outputColumns = [],
      temperature = 0.7,
      webSearchEnabled = false,
      webSearchProvider = 'spider',
      costLimitEnabled = false,
      maxCostPerRow = null,
      outputFormat = 'text',
      rowIds,
      onlyEmpty = false,
      includeErrors = false,
      forceRerun = false,
    } = body;

    if (!tableId || !columnName || !prompt || !Array.isArray(inputColumns) || inputColumns.length === 0) {
      return NextResponse.json(
        {
          error:
            'tableId, columnName, prompt, and inputColumns (non-empty array) are required',
        },
        { status: 400 }
      );
    }

    // Verify the table exists — fail fast with a clear error rather than
    // creating an orphan config.
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(eq(schema.tables.id, tableId));
    if (!table) {
      return NextResponse.json({ error: `Table ${tableId} not found` }, { status: 404 });
    }

    // 1. Create enrichment config
    const configId = generateId();
    const newConfig = {
      id: configId,
      name: columnName.trim(),
      model,
      prompt,
      inputColumns,
      outputColumns,
      outputFormat,
      temperature,
      costLimitEnabled,
      maxCostPerRow,
      webSearchEnabled: !!webSearchEnabled,
      webSearchProvider: webSearchProvider || 'spider',
      createdAt: new Date(),
    };
    await db.insert(schema.enrichmentConfigs).values(newConfig);

    // 2. Create the target column linked to the config. Order goes after the
    // current max to land on the right edge (matches UI behavior).
    const existingColumns = await db
      .select()
      .from(schema.columns)
      .where(eq(schema.columns.tableId, tableId));
    const maxOrder = existingColumns.reduce((max, col) => Math.max(max, col.order), 0);

    const targetColumnId = generateId();
    const newColumn = {
      id: targetColumnId,
      tableId,
      name: columnName.trim(),
      type: 'enrichment' as const,
      width: 150,
      order: maxOrder + 1,
      enrichmentConfigId: configId,
      formulaConfigId: null,
    };
    await db.insert(schema.columns).values(newColumn);

    // 3. Reload the freshly-inserted config so the runner gets the canonical
    // shape (booleans coerced, defaults applied by Drizzle).
    const [config] = await db
      .select()
      .from(schema.enrichmentConfigs)
      .where(eq(schema.enrichmentConfigs.id, configId));

    if (!config) {
      // Shouldn't happen — we just inserted — but fail safely
      return NextResponse.json(
        { error: 'Failed to read back enrichment config after insert' },
        { status: 500 }
      );
    }

    // 4. Run
    const runResult = await runEnrichmentJob({
      config,
      tableId,
      targetColumnId,
      rowIds,
      onlyEmpty,
      includeErrors,
      forceRerun,
    });

    return NextResponse.json(
      {
        configId,
        targetColumnId,
        targetColumn: newColumn,
        ...runResult,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in setup-and-run:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `setup-and-run failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
