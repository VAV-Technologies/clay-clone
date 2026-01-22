const { createClient } = require('@libsql/client');
const client = createClient({
  url: "libsql://dataflow-vav-technologies.aws-ap-northeast-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NjY4OTUzNjUsImlkIjoiNDg5ZjQ5YWQtMDJmMC00NjQ1LWFkMjktMGEyM2MxNTM3MTljIiwicmlkIjoiODVjYzNkMmEtNDM5Yi00YWVlLThiOTUtZWY0OWQ4MGYwNjFkIn0.4bD18MAWazjADXVqZzMVlgpTtsK-gauOJxm15bZhkhCV9c2kSrPVZ49RiSFhXT07Ehvej2LA7xyUyTV_QmWZDQ",
});

client.execute(`UPDATE enrichment_jobs SET status = 'complete' WHERE status IN ('pending', 'running')`)
  .then(() => console.log('Jobs fixed!'))
  .catch(e => console.error(e));
