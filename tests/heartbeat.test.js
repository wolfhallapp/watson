// House PC heartbeat (Night Shift #114): mocked worker; no real requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sendBeat, beatLogLine, startHeartbeat, EVERY_MS } from '../server/heartbeat.js';
import { WORKER_URL } from '../server/knowledge.js';

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a beat posts to /house/heartbeat with the master key and an empty body', async () => {
  const calls = [];
  const res = await sendBeat({ key: 'k', fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(200, { ok: true, at: '2026-11-24T21:12:00.000Z' }); } });
  assert.deepEqual(res, { ok: true, status: 200, at: '2026-11-24T21:12:00.000Z' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, WORKER_URL + '/house/heartbeat');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Worker-Key'], 'k');
  assert.equal(calls[0].init.body, '{}');
});

test('a stopping beat says so; the key can be a function', async () => {
  let body = null, hdr = null;
  await sendBeat({ stopping: true, key: () => 'kk', fetchImpl: async (u, init) => { body = init.body; hdr = init.headers['X-Worker-Key']; return reply(200, { ok: true }); } });
  assert.equal(body, '{"stopping":true}');
  assert.equal(hdr, 'kk');
});

test('failures resolve (never throw): 404 before v362, 500, network down, missing key', async () => {
  assert.deepEqual(await sendBeat({ key: 'k', fetchImpl: async () => reply(404, { error: 'not found' }) }), { ok: false, status: 404, error: 'not found' });
  assert.equal((await sendBeat({ key: 'k', fetchImpl: async () => reply(500, {}) })).error, 'HTTP 500');
  const net = await sendBeat({ key: 'k', fetchImpl: async () => { throw new Error('fetch failed'); } });
  assert.deepEqual(net, { ok: false, status: 0, error: 'fetch failed' });
  const nokey = await sendBeat({ key: () => { throw new Error('No Wolf Hall key'); }, fetchImpl: async () => reply(200, { ok: true }) });
  assert.equal(nokey.ok, false);
});

test('the log speaks only when the outcome changes', () => {
  let r = beatLogLine(null, { ok: true });
  assert.deepEqual(r, { kind: 'ok', line: null }, 'first good beat: quiet');
  r = beatLogLine('ok', { ok: true });
  assert.equal(r.line, null);
  r = beatLogLine('ok', { ok: false, status: 404 });
  assert.match(r.line, /v362 not deployed/);
  assert.equal(beatLogLine('missing', { ok: false, status: 404 }).line, null, 'not every 5 minutes');
  r = beatLogLine('missing', { ok: false, status: 0, error: 'fetch failed' });
  assert.equal(r.line, '  Heartbeat failed: fetch failed');
  assert.equal(beatLogLine('error', { ok: false, status: 0, error: 'again' }).line, null);
  assert.equal(beatLogLine('error', { ok: true }).line, '  Heartbeat: the worker hears the PC again');
});

test('startHeartbeat: beats on its timer, logs changes, and stop() sends one stopping beat then no more', async () => {
  const sent = [], lines = [];
  let n = 0;
  const send = async (o = {}) => { sent.push(o.stopping ? 'stop' : 'beat'); n++; return n === 2 ? { ok: false, status: 0, error: 'offline' } : { ok: true }; };
  const hb = startHeartbeat({ every: 20, firstAfter: 1, send, log: (l) => lines.push(l) });
  await new Promise((r) => setTimeout(r, 70));
  await hb.stop();
  const count = sent.length;
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(count >= 3, `beats sent: ${sent.join(',')}`);
  assert.equal(sent[count - 1], 'stop');
  assert.equal(sent.filter((s) => s === 'stop').length, 1);
  assert.equal(sent.length, count, 'nothing after stop');
  assert.deepEqual(lines.slice(0, 2), ['  Heartbeat failed: offline', '  Heartbeat: the worker hears the PC again']);
  await hb.stop();
  assert.equal(sent.length, count, 'a second stop does nothing');
});

test('every 5 minutes, and index.js starts it and stops it cleanly on shutdown', () => {
  assert.equal(EVERY_MS, 5 * 60 * 1000);
  const src = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ startHeartbeat \} from '\.\/heartbeat\.js';/);
  assert.match(src, /const heartbeat = startHeartbeat\(\);/);
  assert.match(src, /heartbeat\.stop\(\)\.finally\(\(\) => setTimeout\(\(\) => process\.exit\(0\), 500\)\.unref\(\)\)/);
});
