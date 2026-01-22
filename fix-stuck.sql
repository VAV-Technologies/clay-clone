-- Run these in Drizzle Studio SQL tab:

-- 1. Cancel all jobs
UPDATE enrichment_jobs SET status = 'cancelled' WHERE status IN ('pending', 'running');

-- 2. Check which rows have stuck processing cells (view first)
SELECT id, data FROM rows WHERE data LIKE '%"processing"%' LIMIT 10;
