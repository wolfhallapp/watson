// Run the private Notion backup once now (the Oracle also runs it every night after 3 AM).
// Usage (in WSL): node scripts/notion-backup.mjs   -> C:\Users\Owner\Documents\Wolf Hall backups\<today>\
// Read-only: it only GETs the worker's /system/backup with the master key (Wolf Hall v300 and later).
import { runBackup, BACKUP_DIR } from '../server/notion-backup.js';
const r = await runBackup();
if (r.waiting) { console.log(`/system/backup is not live yet (HTTP ${r.status}). Deploy Wolf Hall v300 first.`); process.exit(2); }
for (const [name, n] of Object.entries(r.counts)) console.log(`${name.padEnd(22)} ${n}`);
for (const [name, e] of Object.entries(r.errors)) console.log(`${name.padEnd(22)} FAILED: ${e}`);
console.log(`\n${Object.keys(r.counts).length} tables, ${Object.values(r.counts).reduce((a, b) => a + b, 0)} rows -> ${BACKUP_DIR}/${r.day}${r.pruned.length ? `; removed ${r.pruned.join(', ')}` : ''}`);
process.exit(r.ok ? 0 : 1);
