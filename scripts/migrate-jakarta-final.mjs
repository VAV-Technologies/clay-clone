// One-off migration: build "Final" sheet in "Jakarta Senior Executives (AI Ark)"
// from rows in "Ninjer Completed" + "Ninjer Not Run" where Email or TryKitt Email is non-empty.

const BASE = 'https://dataflow-pi.vercel.app';
const KEY = process.env.DATAFLOW_API_KEY;
if (!KEY) throw new Error('DATAFLOW_API_KEY env var required');

const WORKBOOK_ID = '9907668e-1b24-4983-acd6-27dd694d8095';
const NINJER_COMPLETED = 'aa6fcc6c-4109-4ade-9f74-9e2a174323e5';
const NINJER_NOT_RUN = 'f36798cb-83af-4793-a67a-b46871bbcba6';

const KEEP = [
  { name: 'First Name', type: 'text' },
  { name: 'Last Name', type: 'text' },
  { name: 'Full Name', type: 'text' },
  { name: 'Job Title', type: 'text' },
  { name: 'Headline', type: 'text' },
  { name: 'Seniority', type: 'text' },
  { name: 'Location', type: 'text' },
  { name: 'Country', type: 'text' },
  { name: 'Company Name', type: 'text' },
  { name: 'Company Domain', type: 'url' },
  { name: 'Company Industry', type: 'text' },
  { name: 'LinkedIn URL', type: 'url' },
  { name: 'Twitter', type: 'url' },
  { name: 'Skills', type: 'text' },
  { name: 'Email', type: 'email' },
];

async function api(path, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function getColumns(tableId) {
  return api(`/api/columns?tableId=${tableId}`);
}

async function getAllRows(tableId) {
  return api(`/api/rows?tableId=${tableId}&limit=100000`);
}

function buildNameIndex(cols) {
  const m = {};
  for (const c of cols) m[c.name] = c.id;
  return m;
}

function cellValue(row, colId) {
  const c = row.data?.[colId];
  if (!c) return '';
  const v = c.value;
  if (v == null) return '';
  return String(v);
}

async function main() {
  console.log('Fetching source columns...');
  const [completedCols, notRunCols] = await Promise.all([
    getColumns(NINJER_COMPLETED),
    getColumns(NINJER_NOT_RUN),
  ]);
  const completedIdx = buildNameIndex(completedCols);
  const notRunIdx = buildNameIndex(notRunCols);

  console.log('Creating "Final" sheet...');
  const finalTable = await api('/api/tables', {
    method: 'POST',
    body: JSON.stringify({
      projectId: WORKBOOK_ID,
      name: 'Final',
      columns: KEEP,
    }),
  });
  const finalIdx = buildNameIndex(finalTable.columns);
  console.log(`  tableId=${finalTable.id}`);

  console.log('Fetching rows from Ninjer Completed...');
  const completedRows = await getAllRows(NINJER_COMPLETED);
  console.log(`  ${completedRows.length} rows`);

  console.log('Fetching rows from Ninjer Not Run...');
  const notRunRows = await getAllRows(NINJER_NOT_RUN);
  console.log(`  ${notRunRows.length} rows`);

  const migrate = (rows, idx, label) => {
    const out = [];
    let kept = 0, skipped = 0;
    for (const row of rows) {
      const ninjerEmail = cellValue(row, idx['Email']).trim();
      const trykittEmail = cellValue(row, idx['TryKitt Email']).trim();
      const finalEmail = ninjerEmail || trykittEmail;
      if (!finalEmail) { skipped++; continue; }
      const data = {};
      for (const { name } of KEEP) {
        const srcId = idx[name];
        const dstId = finalIdx[name];
        if (!dstId) continue;
        if (name === 'Email') {
          data[dstId] = { value: finalEmail, status: 'complete' };
        } else if (srcId && row.data?.[srcId]) {
          data[dstId] = row.data[srcId];
        }
      }
      out.push(data);
      kept++;
    }
    console.log(`  ${label}: kept ${kept}, skipped ${skipped}`);
    return out;
  };

  const toInsert = [
    ...migrate(completedRows, completedIdx, 'Ninjer Completed'),
    ...migrate(notRunRows, notRunIdx, 'Ninjer Not Run'),
  ];
  console.log(`Total to insert: ${toInsert.length}`);

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    await api('/api/rows', {
      method: 'POST',
      body: JSON.stringify({ tableId: finalTable.id, rows: batch }),
    });
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${toInsert.length}`);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
