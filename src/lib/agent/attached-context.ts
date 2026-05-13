// Build the `injectedContext` block the planner sees when a workbook or
// CSV is attached to the conversation. Lives next to planner.ts so both
// /api/agent/conversations and [id]/turn routes can call it.

import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import type { AttachedCsv } from '@/lib/db/schema';

export interface BuiltContext {
  // What gets prepended to the planner's `injectedContext`. Multi-line markdown.
  contextText: string;
  // Echoed back so the route can reuse without refetching.
  attachedWorkbookId?: string;
  attachedCsv?: AttachedCsv;
}

export async function buildAttachedContext(
  attachedWorkbookId: string | null | undefined,
  attachedCsv: AttachedCsv | null | undefined,
): Promise<BuiltContext> {
  const sections: string[] = [];

  if (attachedWorkbookId) {
    const [wb] = await db.select().from(schema.projects)
      .where(eq(schema.projects.id, attachedWorkbookId)).limit(1);
    if (wb) {
      const sheets = await db.select().from(schema.tables)
        .where(eq(schema.tables.projectId, wb.id));
      const lines: string[] = [];
      lines.push(`ATTACHED WORKBOOK`);
      lines.push(`workbookId: ${wb.id}`);
      lines.push(`name: ${wb.name}`);
      lines.push(`sheets:`);
      for (const s of sheets) {
        const cols = await db.select().from(schema.columns)
          .where(eq(schema.columns.tableId, s.id));
        const colSummary = cols
          .sort((a, b) => a.order - b.order)
          .map(c => `"${c.name}"(${c.type})`)
          .join(', ');
        lines.push(`  - "${s.name}"  sheetId: ${s.id}`);
        lines.push(`    columns: [${colSummary}]`);
      }
      lines.push(`Use \`use_existing_workbook { "workbookId": "${wb.id}" }\` as the first step.`);
      lines.push(`Bind sheets you need with \`use_existing_sheet { "sheet": "<name>", "sheetId": "<id from above>" }\`.`);
      lines.push(`DO NOT create_sheet for sheets that already exist above.`);
      sections.push(lines.join('\n'));
    } else {
      sections.push(`ATTACHED WORKBOOK\n(workbookId ${attachedWorkbookId} not found in DB — treat as fresh build)`);
    }
  }

  if (attachedCsv && Array.isArray(attachedCsv.rows) && attachedCsv.rows.length > 0) {
    const lines: string[] = [];
    lines.push(`ATTACHED CSV`);
    lines.push(`file name: ${attachedCsv.name}`);
    lines.push(`row count: ${attachedCsv.rowCount}`);
    lines.push(`headers: ${JSON.stringify(attachedCsv.headers)}`);
    const sample = attachedCsv.rows.slice(0, 3);
    lines.push(`first 3 rows:`);
    for (const row of sample) {
      lines.push(`  ${JSON.stringify(row)}`);
    }
    lines.push(`Use \`import_csv { "sheet": "${sanitizeSheetName(attachedCsv.name)}", "data": "__PLACEHOLDER__" }\` to ingest. The launch endpoint replaces __PLACEHOLDER__ with the full rows from the conversation — do not embed rows in planJson.`);
    sections.push(lines.join('\n'));
  }

  return {
    contextText: sections.join('\n\n'),
    attachedWorkbookId: attachedWorkbookId ?? undefined,
    attachedCsv: attachedCsv ?? undefined,
  };
}

function sanitizeSheetName(filename: string): string {
  return filename.replace(/\.(csv|tsv|txt)$/i, '').slice(0, 40) || 'Imported';
}
