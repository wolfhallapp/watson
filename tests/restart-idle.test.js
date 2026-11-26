// scripts/restart-when-all-idle.sh (2026-11-26): the idle check reads busy-all's whole output instead of
// piping it into `grep -q` (which closed the pipe early and crashed busy-all with EPIPE), and a check that
// fails or prints nothing counts as busy, so it never restarts the server in the middle of someone's work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A throwaway copy of the script with a fake busy-all.mjs that prints `lines` and exits with `code`.
function sandbox(lines, code = 0) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oracle-idle-'));
  mkdirSync(path.join(dir, 'scripts'));
  copyFileSync(path.join(ROOT, 'scripts', 'restart-when-all-idle.sh'), path.join(dir, 'scripts', 'restart-when-all-idle.sh'));
  writeFileSync(path.join(dir, 'scripts', 'busy-all.mjs'),
    `for (const l of ${JSON.stringify(lines)}) console.log(l);\nprocess.exit(${code});\n`);
  return dir;
}
const idle = (dir) => run('bash', ['-c', '. scripts/restart-when-all-idle.sh; all_idle && echo IDLE || echo BUSY'],
  { cwd: dir, env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` } });

test('all_idle: idle only when every agent says idle', async () => {
  assert.equal((await idle(sandbox(['oracle: idle', 'architect: idle', 'trinity: idle', 'morpheus: idle']))).stdout.trim(), 'IDLE');
  assert.equal((await idle(sandbox(['oracle: BUSY', 'architect: idle', 'trinity: idle', 'morpheus: idle']))).stdout.trim(), 'BUSY');
  assert.equal((await idle(sandbox(['oracle: idle', 'architect: no answer']))).stdout.trim(), 'BUSY');
  assert.equal((await idle(sandbox(['oracle: idle', 'morpheus: error']))).stdout.trim(), 'BUSY');
});

test('all_idle: a busy first line no longer crashes busy-all with EPIPE', async () => {
  const r = await idle(sandbox(['oracle: BUSY', 'architect: idle', 'trinity: idle', 'morpheus: idle']));
  assert.equal(r.stdout.trim(), 'BUSY');
  assert.doesNotMatch(r.stderr, /EPIPE|Unhandled/);
});

test('all_idle: a check that fails or says nothing counts as busy (never restart mid-work)', async () => {
  assert.equal((await idle(sandbox([]))).stdout.trim(), 'BUSY');
  assert.equal((await idle(sandbox(['oracle: idle'], 1))).stdout.trim(), 'BUSY');
});

test('sourcing the script runs only the helper (no loop, no restart)', async () => {
  const r = await run('bash', ['-c', '. scripts/restart-when-all-idle.sh; echo sourced'], { cwd: sandbox(['oracle: idle']), timeout: 5000 });
  assert.equal(r.stdout.trim(), 'sourced');
});
