// scripts/run.sh (2026-11-26): a window whose server can't get the port because another Oracle already
// answers on it stops, instead of crashing with EADDRINUSE and restarting every 5 seconds forever
// (data/server.log had 54,165 of those). A real crash with nothing on the port still restarts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A throwaway copy of the launcher with a fake server/index.js (no git remote, no nvm).
function sandbox(serverJs, dotEnv) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oracle-run-'));
  mkdirSync(path.join(dir, 'scripts')); mkdirSync(path.join(dir, 'server'));
  for (const f of ['run.sh', 'run-lib.sh']) copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
  writeFileSync(path.join(dir, 'server', 'index.js'), serverJs);
  if (dotEnv) writeFileSync(path.join(dir, '.env'), dotEnv);
  return dir;
}
const env = (dir, extra) => ({ ...process.env, HOME: dir, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, GIT_DIR: path.join(dir, 'no-git'), ...extra });
const listen = () => new Promise((res) => { const s = http.createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', () => res(s)); });
// run.sh ends on `read` ("Press Enter to close"), which fails on a closed stdin; its output is what counts.
const runSh = (dir, port) => run('bash', ['-c', 'bash scripts/run.sh </dev/null'], { cwd: dir, env: env(dir, { WATSON_PORT: port }), timeout: 20000 }).catch((e) => { if (e.killed) throw e; return e; });
const lib = (dir, cmd, extra) => run('bash', ['-c', `. scripts/run-lib.sh; ${cmd}`], { cwd: dir, env: env(dir, extra) });

test('oracle_port: WATSON_PORT, then .env, then 8787 (as server/config.js)', async () => {
  const bare = sandbox('');
  assert.equal((await lib(bare, 'oracle_port', { WATSON_PORT: '' })).stdout.trim(), '8787');
  const withEnv = sandbox('', 'OTHER=1\nWATSON_PORT=9123\n');
  assert.equal((await lib(withEnv, 'oracle_port', { WATSON_PORT: '' })).stdout.trim(), '9123');
  assert.equal((await lib(withEnv, 'oracle_port', { WATSON_PORT: '9555' })).stdout.trim(), '9555');
});

test('oracle_should_restart: never after a clean stop or Ctrl+C; after a crash only when the port is free', async () => {
  const srv = await listen();
  const busy = String(srv.address().port);
  const free = await listen(); const freePort = String(free.address().port); await new Promise((r) => free.close(r));
  const dir = sandbox('');
  const ask = async (code, port) => (await lib(dir, `oracle_should_restart ${code} && echo yes || echo no`, { WATSON_PORT: port })).stdout.trim();
  try {
    assert.equal(await ask(0, freePort), 'no');
    assert.equal(await ask(130, freePort), 'no');
    assert.equal(await ask(1, freePort), 'yes');
    assert.equal(await ask(137, freePort), 'yes', 'the watchdog kills a frozen server with -9; it must come back');
    assert.equal(await ask(1, busy), 'no', 'another Oracle answers on the port');
  } finally { srv.close(); }
});

test('run.sh: a duplicate window stops after one EADDRINUSE instead of looping', async () => {
  const srv = await listen();
  const port = String(srv.address().port);
  // The fake server does what the real one does: listen on the port, and crash when it's taken.
  const dir = sandbox(`require('fs').appendFileSync('runs', 'x');
    require('http').createServer().listen(+process.env.WATSON_PORT, '127.0.0.1', () => process.exit(0))
      .on('error', (e) => { console.error('Error: listen ' + e.code); process.exit(1); });`);
  writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
  try {
    const t0 = Date.now();
    const r = await runSh(dir, port);
    assert.equal(readFileSync(path.join(dir, 'runs'), 'utf8'), 'x', 'the server was started once');
    assert.match(r.stdout, /Another Oracle is already running on port \d+, so this window stops/);
    assert.doesNotMatch(r.stdout, /Restarting in 5 seconds/);
    assert.ok(Date.now() - t0 < 5000, 'no 5-second restart wait');
    assert.match(readFileSync(path.join(dir, 'data', 'server.log'), 'utf8'), /EADDRINUSE[\s\S]*Another Oracle is already running/);
  } finally { srv.close(); }
});

test('run.sh: a real crash with nothing on the port still restarts, and a clean stop ends it', async () => {
  const free = await listen(); const port = String(free.address().port); await new Promise((r) => free.close(r));
  // Crashes the first time, stops cleanly the second.
  const dir = sandbox(`const fs = require('fs'); fs.appendFileSync('runs', 'x');
    process.exit(fs.readFileSync('runs', 'utf8').length === 1 ? 1 : 0);`);
  writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
  const r = await runSh(dir, port);
  assert.equal(readFileSync(path.join(dir, 'runs'), 'utf8'), 'xx', 'started again after the crash');
  assert.match(r.stdout, /stopped unexpectedly \(exit 1\)\. Restarting in 5 seconds/);
  assert.doesNotMatch(r.stdout, /Another Oracle/);
  assert.ok(existsSync(path.join(dir, 'data', 'server.log')));
});
