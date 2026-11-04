// Read-only GET from the Wolf Hall worker using the Oracle's own key (never printed).
// Usage (in WSL): node scripts/worker-get.mjs /upcoming [/bills2 ...]   Refuses paths that write (/forecast, current /week-budget).
import { workerGet, workerGetWrites } from '../server/knowledge.js';
for (const p of process.argv.slice(2)) {
  if (workerGetWrites(p)) { console.log(`${p}: skipped (this path writes to Notion)`); continue; }
  const { status, body } = await workerGet(p);
  console.log(`=== ${p} (HTTP ${status})\n${body}`);
}
process.exit(0);
