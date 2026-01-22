const { createClient } = require('@libsql/client');

const client = createClient({
  url: "libsql://dataflow-vav-technologies.aws-ap-northeast-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NjY4OTUzNjUsImlkIjoiNDg5ZjQ5YWQtMDJmMC00NjQ1LWFkMjktMGEyM2MxNTM3MTljIiwicmlkIjoiODVjYzNkMmEtNDM5Yi00YWVlLThiOTUtZWY0OWQ4MGYwNjFkIn0.4bD18MAWazjADXVqZzMVlgpTtsK-gauOJxm15bZhkhCV9c2kSrPVZ49RiSFhXT07Ehvej2LA7xyUyTV_QmWZDQ",
});

async function check() {
  // First, force complete any stuck jobs
  console.log('Force completing stuck jobs...');
  await client.execute(`UPDATE enrichment_jobs SET status = 'complete', completed_at = ${Math.floor(Date.now()/1000)} WHERE status IN ('pending', 'running')`);
  console.log('Done!\n');

  // Get enrichment column ID
  const cols = await client.execute(`SELECT id, name, type FROM columns WHERE table_id = '312a8ea6-6be7-4947-b514-ad1bc9b3f488' AND type = 'enrichment'`);
  console.log('Enrichment columns:', cols.rows);

  if (cols.rows.length === 0) {
    console.log('No enrichment columns found');
    return;
  }

  const enrichColId = cols.rows[0].id;
  console.log('Checking column:', enrichColId);

  // Get ALL rows and check for errors
  const rows = await client.execute(`SELECT id, data FROM rows WHERE table_id = '312a8ea6-6be7-4947-b514-ad1bc9b3f488'`);

  let errorCount = 0;
  let completeCount = 0;
  let processingCount = 0;
  let otherCount = 0;

  for (const row of rows.rows) {
    const data = JSON.parse(row.data);
    const cellValue = data[enrichColId];
    if (cellValue?.status === 'error') {
      errorCount++;
      if (errorCount <= 3) {
        console.log('Error row sample:', row.id, cellValue.error?.substring(0, 80));
      }
    } else if (cellValue?.status === 'complete') {
      completeCount++;
    } else if (cellValue?.status === 'processing') {
      processingCount++;
    } else {
      otherCount++;
    }
  }

  console.log('\nStatus counts (ALL rows):');
  console.log('- Complete:', completeCount);
  console.log('- Error:', errorCount);
  console.log('- Processing:', processingCount);
  console.log('- Other/Empty:', otherCount);
  console.log('- Total:', rows.rows.length);

  // Check for active jobs again
  const jobs = await client.execute(`SELECT id, status FROM enrichment_jobs WHERE status IN ('pending', 'running')`);
  console.log('\nActive jobs after fix:', jobs.rows.length === 0 ? 'None (good!)' : jobs.rows);
}

check().catch(console.error);
