const { createClient } = require('@libsql/client');

const client = createClient({
  url: "libsql://dataflow-vav-technologies.aws-ap-northeast-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NjY4OTUzNjUsImlkIjoiNDg5ZjQ5YWQtMDJmMC00NjQ1LWFkMjktMGEyM2MxNTM3MTljIiwicmlkIjoiODVjYzNkMmEtNDM5Yi00YWVlLThiOTUtZWY0OWQ4MGYwNjFkIn0.4bD18MAWazjADXVqZzMVlgpTtsK-gauOJxm15bZhkhCV9c2kSrPVZ49RiSFhXT07Ehvej2LA7xyUyTV_QmWZDQ",
});

async function fix() {
  await client.execute(`UPDATE enrichment_jobs SET status = 'complete', completed_at = ${Math.floor(Date.now()/1000)} WHERE id = '6wXIsexJ3_cW'`);
  console.log('Job marked as complete!');

  const result = await client.execute(`SELECT status FROM enrichment_jobs WHERE id = '6wXIsexJ3_cW'`);
  console.log('New status:', result.rows[0].status);
}

fix().catch(console.error);
