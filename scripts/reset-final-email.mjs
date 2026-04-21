// Reset Final Email formula columns on both Jakarta sheets.
//
// Because POST /api/formula/run's backfill runs in-memory and dies on
// Vercel's 60s serverless timeout, we create the formula column then
// fill every row's value client-side via PATCH /api/rows (bulk update).
//
// PATCH does SELECT+UPDATE per row serially, so batches must be small.
// We also run batches concurrently (multiple lambdas in parallel) to
// speed it up, and skip rows whose final email is empty (no-op).
//
// Idempotent: if a "Final Email" column already exists on a sheet, reuse it.

const BASE = 'https://dataflow-pi.vercel.app';
const KEY = process.env.DATAFLOW_API_KEY;
if (!KEY) throw new Error('DATAFLOW_API_KEY env var required');

const FORMULA = '{{Email}} || {{TryKitt Email}} || ""';
const BATCH_SIZE = 25;
const CONCURRENCY = 6;

const SHEETS = [
  {
    name: 'Ninjer Completed',
    tableId: 'aa6fcc6c-4109-4ade-9f74-9e2a174323e5',
    emailColId: '0622530a-17ae-4223-9ce3-5a5d9a0fe310',
    trykittColId: '7a9c88d4-04e1-476e-a8bf-eec4730695df',
  },
  {
    name: 'Ninjer Not Run',
    tableId: 'f36798cb-83af-4793-a67a-b46871bbcba6',
    emailColId: 'a01e6275-6a34-48ca-8482-cfe27ab8c536',
    trykittColId: '8eb67c18-26ca-4e57-8576-a1140703f737',
  },
];

async function api(path, init = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(BASE + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      if (!r.ok) {
        const body = await r.text();
        if ((r.status === 504 || r.status === 502) && attempt < retries) {
          console.warn(`  ${init.method || 'GET'} ${path} -> ${r.status}, retrying (${attempt + 1}/${retries})`);
          await new Promise((res) => setTimeout(res, 1500));
          continue;
        }
        throw new Error(`${init.method || 'GET'} ${path} -> ${r.status} ${body}`);
      }
      return r.json();
    } catch (e) {
      if (attempt >= retries) throw e;
      console.warn(`  fetch error on ${path}: ${e.message}, retrying`);
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
}

function cellValue(row, colId) {
  const c = row.data?.[colId];
  if (!c) return '';
  const v = c.value;
  if (v == null) return '';
  return String(v).trim();
}

async function findOrCreateFinalColumn(sheet) {
  const cols = await api(`/api/columns?tableId=${sheet.tableId}`);
  const existing = cols.find((c) => c.name === 'Final Email');
  if (existing) {
    console.log(`[${sheet.name}] reusing existing Final Email column ${existing.id} (type=${existing.type})`);
    return existing.id;
  }
  console.log(`[${sheet.name}] creating Final Email formula column...`);
  const created = await api('/api/formula/run', {
    method: 'POST',
    body: JSON.stringify({
      tableId: sheet.tableId,
      formula: FORMULA,
      outputColumnName: 'Final Email',
    }),
  });
  console.log(`[${sheet.name}] created columnId=${created.columnId}`);
  return created.columnId;
}

async function processSheet(sheet) {
  console.log(`\n=== ${sheet.name} ===`);
  const finalColId = await findOrCreateFinalColumn(sheet);

  console.log(`[${sheet.name}] fetching rows...`);
  const rows = await api(`/api/rows?tableId=${sheet.tableId}&limit=100000`);
  console.log(`[${sheet.name}] ${rows.length} rows`);

  const updates = [];
  let haveEmail = 0;
  let alreadyCorrect = 0;
  for (const row of rows) {
    const ninjer = cellValue(row, sheet.emailColId);
    const trykitt = cellValue(row, sheet.trykittColId);
    const final = ninjer || trykitt || '';
    if (!final) continue;
    haveEmail++;
    const current = cellValue(row, finalColId);
    if (current === final) { alreadyCorrect++; continue; }
    updates.push({
      id: row.id,
      data: { [finalColId]: { value: final, status: 'complete' } },
    });
  }
  console.log(`[${sheet.name}] ${haveEmail} rows with an email, ${alreadyCorrect} already correct, ${updates.length} to patch`);

  const batches = [];
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    batches.push(updates.slice(i, i + BATCH_SIZE));
  }

  let done = 0;
  let idx = 0;
  async function worker() {
    while (idx < batches.length) {
      const myIdx = idx++;
      const batch = batches[myIdx];
      await api('/api/rows', { method: 'PATCH', body: JSON.stringify({ updates: batch }) });
      done += batch.length;
      if (myIdx % 10 === 0 || done === updates.length) {
        console.log(`[${sheet.name}] patched ${done}/${updates.length}`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  console.log(`[${sheet.name}] done`);
}

for (const sheet of SHEETS) {
  await processSheet(sheet);
}
console.log('\nAll sheets done.');
