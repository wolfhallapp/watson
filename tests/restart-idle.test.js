// scripts/restart-when-all-idle.sh (2026-11-26): the idle check reads busy-all's whole output instead of
// piping it into `grep -q` (which closed the pipe early and crashed busy-all with EPIPE), and a check that
// fails or prints nothing counts as busy, so it never restarts the server in the middle of someone's work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
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
  for (const f of ['restart-when-all-idle.sh', 'server-pid.sh']) copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
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

// 2026-11-26: the restart found its target with `pgrep -f '^node server/index.js'`, which matches every
// Oracle on the PC, so a run from a test copy or ~/night/watson could kill -9 the live one (three exit 137
// kills in data/server.log that morning). server_pid only gives the server running from this folder.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidFrom = async (dir) => (await run('bash', ['-c', '. scripts/server-pid.sh; server_pid'], { cwd: dir, timeout: 5000 })).stdout.trim();

test('the restart only ever kills the server running from its own folder', async (t) => {
  const own = sandbox(['oracle: idle', 'architect: idle']);  // a fake Oracle runs from here
  const other = sandbox(['oracle: idle', 'architect: idle']); // a test copy with no server of its own
  mkdirSync(path.join(own, 'server'));
  writeFileSync(path.join(own, 'server', 'index.js'), 'setInterval(() => {}, 1000);\n');
  const fake = spawn(process.execPath, ['server/index.js'], { cwd: own, argv0: 'node', stdio: 'ignore' });
  t.after(() => { try { fake.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 300));

  assert.equal(await pidFrom(own), String(fake.pid), 'finds the server in its own folder');
  // Nothing in `other`, so not the fake one and not the live Oracle. The full runs below kill only what
  // server_pid prints, so they only go ahead once this has held.
  assert.equal(await pidFrom(other), '', 'finds nothing for a folder with no server');

  // Fast full runs: a sandbox HOME skips nvm, and a no-op `sleep` on PATH skips the 60 s waits.
  const bin = path.join(other, 'bin'); mkdirSync(bin);
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, HOME: other, PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}` };
  const full = (dir) => run('bash', ['scripts/restart-when-all-idle.sh'], { cwd: dir, env, timeout: 20000 }).then((r) => ({ code: 0, ...r }), (e) => e);

  const r1 = await full(other);
  assert.equal(r1.code, 1);
  assert.match(r1.stdout, /no server is running from .*nothing to restart/);
  assert.ok(alive(fake.pid), "a run from another folder leaves this folder's server alone");

  const r2 = await full(own);
  assert.match(r2.stdout, new RegExp(`all idle; restarting \\(pid ${fake.pid}\\)`));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!alive(fake.pid) || fake.exitCode !== null || fake.signalCode === 'SIGKILL', 'its own server is restarted');
});

test('restart-when-idle.sh uses the same own-folder check', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(path.join(ROOT, 'scripts', 'restart-when-idle.sh'), 'utf8');
  assert.match(src, /\. scripts\/server-pid\.sh/);
  assert.match(src, /pid=\$\(server_pid\)/);
  assert.doesNotMatch(src, /pid=\$\(pgrep/);
});
