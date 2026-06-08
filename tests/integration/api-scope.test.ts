import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as projectsPOST } from '@/app/api/projects/route';
import { POST as tablesPOST } from '@/app/api/tables/route';
import { POST as columnsPOST } from '@/app/api/columns/route';
import { GET as rowsGET, POST as rowsPOST } from '@/app/api/rows/route';

// In-process integration: calls the REAL route handlers against an isolated
// :memory: SQLite DB (DATAFLOW_DB_PATH, set in vitest.config). Middleware/auth
// don't run here, so handlers are exercised directly. Locks in the column/table
// scope guards (WRITE-PATH-NO-SCOPE / column-scope) hermetically in CI.

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
async function call(handler: Handler, opts: { url?: string; method?: string; body?: unknown }) {
  const { url = 'http://localhost/api/x', method = 'POST', body } = opts;
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await handler(new NextRequest(url, init));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  return { status: res.status, json };
}

let seq = 0;
const uniq = () => `it-${process.pid}-${++seq}`;

async function makeWorkbook() {
  const wb = (await call(projectsPOST, { body: { name: uniq(), type: 'workbook' } })).json;
  return wb.id as string;
}
async function makeSheet(projectId: string, name = 'S') {
  return (await call(tablesPOST, { body: { projectId, name } })).json.id as string;
}
async function makeColumn(tableId: string, name = 'Domain') {
  return (await call(columnsPOST, { body: { tableId, name, type: 'text' } })).json.id as string;
}

describe('row API scope guards (in-process, :memory:)', () => {
  it("GET /api/rows rejects a filter using another sheet's columnId", async () => {
    const wb = await makeWorkbook();
    const s1 = await makeSheet(wb, 'S1');
    const s2 = await makeSheet(wb, 'S2');
    const foreign = await makeColumn(s1);
    await makeColumn(s2);
    const filters = encodeURIComponent(JSON.stringify([{ columnId: foreign, operator: 'is_empty', value: '' }]));
    const res = await call(rowsGET, { url: `http://localhost/api/rows?tableId=${s2}&filters=${filters}`, method: 'GET' });
    expect(res.status).toBe(400);
    expect(res.json.invalidColumnIds).toContain(foreign);
  });

  it('POST /api/rows rejects a foreign columnId in cell data', async () => {
    const wb = await makeWorkbook();
    const s1 = await makeSheet(wb, 'S1');
    const s2 = await makeSheet(wb, 'S2');
    const foreign = await makeColumn(s1);
    const res = await call(rowsPOST, { body: { tableId: s2, rows: [{ [foreign]: { value: 'orphan' } }] } });
    expect(res.status).toBe(400);
    expect(res.json.invalidColumnIds).toContain(foreign);
  });

  it('POST /api/rows accepts a valid columnId and persists it', async () => {
    const wb = await makeWorkbook();
    const s = await makeSheet(wb);
    const col = await makeColumn(s, 'Name');
    const created = await call(rowsPOST, { body: { tableId: s, rows: [{ [col]: { value: 'Jane' } }] } });
    expect(created.status).toBe(201);
    const got = await call(rowsGET, { url: `http://localhost/api/rows?tableId=${s}`, method: 'GET' });
    expect(got.status).toBe(200);
    expect(got.json[0].data[col].value).toBe('Jane');
  });

  it('GET /api/rows 404s on an unknown table', async () => {
    const res = await call(rowsGET, { url: 'http://localhost/api/rows?tableId=00000000-0000-0000-0000-000000000000', method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/rows requires a tableId', async () => {
    const { DELETE: rowsDELETE } = await import('@/app/api/rows/route');
    const res = await call(rowsDELETE as Handler, { method: 'DELETE', body: { ids: ['x'] } });
    expect(res.status).toBe(400);
  });
});
