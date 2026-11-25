// Clock-ahead check (night shift 2026-11-25, the same check Wolf Hall got that night). Read-only: runs each
// tests/*.test.js as if it were N days later and lists the tests that would start failing on their own as the
// calendar moves. A test listed here usually needs its clock pinned or its fixture dates built from today.
// usage: node scripts/clock-ahead.mjs [days ...]   (default 1 7 14 30 60 120 365)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = path.join(ROOT, 'scripts', 'clock-shift.mjs');
const days = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n));
const DAYS = days.length ? days : [1, 7, 14, 30, 60, 120, 365];
const tests = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.js')).sort();

const runOne = (file, d) => new Promise(resolve => {
  // git runs outside the shifted process, so commits a test makes (evening-note's fake repo) get the shifted date too
  const when = new Date(Date.now() + d * 86400000).toISOString();
  const env = { ...process.env, CLOCK_SHIFT_DAYS: String(d), NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --import ' + PRELOAD).trim(),
    ...(d ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}) };
  const p = spawn(process.execPath, ['--test', path.join('tests', file)], { cwd: ROOT, env, stdio: 'ignore' });
  const t = setTimeout(() => p.kill('SIGKILL'), 180000);
  p.on('exit', code => { clearTimeout(t); resolve(code === 0); });
});
const runAll = async (d) => {
  const failed = [], queue = tests.slice(), workers = Math.max(2, Math.min(6, os.cpus().length));
  await Promise.all(Array.from({ length: workers }, async () => { for (let f; (f = queue.shift());) if (!(await runOne(f, d))) failed.push(f); }));
  return failed.sort();
};

let worst = 0;
const base = await runAll(0);
if (base.length) console.log(`today: ${base.length} already failing (not counted below): ${base.join(', ')}`);
for (const d of DAYS) {
  const failed = (await runAll(d)).filter(f => !base.includes(f));
  worst = Math.max(worst, failed.length);
  console.log(`+${d} day${d === 1 ? '' : 's'}: ${failed.length ? failed.length + ' would fail: ' + failed.join(', ') : 'all pass'}`);
}
process.exit(worst ? 1 : 0);
