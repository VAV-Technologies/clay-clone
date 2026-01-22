const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function cancelAllJobs() {
  console.log('Fetching active jobs...');
  
  // Get active jobs
  const jobs = await db.execute(`
    SELECT id, status, table_id, target_column_id, processed_count, current_index, 
           json_array_length(row_ids) as total_rows
    FROM enrichment_jobs 
    WHERE status IN ('pending', 'running')
  `);
  
  console.log(`Found ${jobs.rows.length} active jobs:`);
  jobs.rows.forEach(job => {
    console.log(`  - Job ${job.id}: ${job.status}, processed ${job.processed_count}/${job.total_rows}`);
  });
  
  if (jobs.rows.length > 0) {
    // Cancel all active jobs
    await db.execute(`
      UPDATE enrichment_jobs 
      SET status = 'cancelled', updated_at = unixepoch() * 1000
      WHERE status IN ('pending', 'running')
    `);
    console.log('All active jobs cancelled.');
  }
  
  // Reset any cells stuck in 'processing' status
  console.log('\nChecking for stuck processing cells...');
  const rows = await db.execute(`SELECT id, data FROM rows LIMIT 100`);
  
  let stuckCount = 0;
  for (const row of rows.rows) {
    try {
      const data = JSON.parse(row.data);
      let hasStuck = false;
      
      for (const [colId, cell] of Object.entries(data)) {
        if (cell && cell.status === 'processing') {
          hasStuck = true;
          stuckCount++;
          // Reset to pending
          data[colId] = { value: null, status: 'pending' };
        }
      }
      
      if (hasStuck) {
        await db.execute({
          sql: `UPDATE rows SET data = ? WHERE id = ?`,
          args: [JSON.stringify(data), row.id]
        });
      }
    } catch (e) {
      // Skip invalid JSON
    }
  }
  
  console.log(`Reset ${stuckCount} stuck cells to 'pending' status.`);
  console.log('\nDone! You can now re-run the enrichment.');
}

cancelAllJobs().catch(console.error);
