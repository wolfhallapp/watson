// Uptime watch (Night Shift #21): mocked worker, site and internet; no real requests, no real pushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { step, queueNotices, noticeText, appendLog, runOnce, emptyState, minutesText, SITE_URL, CONTROL_URL } from '../server/uptime.js';
import { WORKER_URL } from '../server/knowledge.js';

const UP = { ok: true }, DOWN = { ok: false };
const t = (min) => new Date(Date.UTC(2026, 10, 23, 15, 0) + min * 60000).toISOString(); // 9:00 AM Central + min

test('one miss is quiet; two in a row alerts once; recovery says so once', () => {
  let r = step(emptyState(), { worker: DOWN, site: UP }, t(0));
  assert.deepEqual(r.notices, []);
  r = step(r.state, { worker: DOWN, site: UP }, t(15));
  assert.equal(r.notices.length, 1);
  assert.deepEqual(r.notices[0], { kind: 'down', targets: ['worker'], since: t(0) });
  r = step(r.state, { worker: DOWN, site: UP }, t(30));
  assert.deepEqual(r.notices, [], 'no second down push');
  r = step(r.state, { worker: UP, site: UP }, t(45));
  assert.deepEqual(r.notices, [{ kind: 'back', targets: ['worker'], since: t(0), until: t(45) }]);
  r = step(r.state, { worker: UP, site: UP }, t(60));
  assert.deepEqual(r.notices, []);
});

test('a single blip that recovers makes no notice at all', () => {
  let r = step(emptyState(), { worker: UP, site: DOWN }, t(0));
  r = step(r.state, { worker: UP, site: UP }, t(15));
  assert.deepEqual(r.notices, []);
  r = step(r.state, { worker: UP, site: DOWN }, t(30));
  assert.deepEqual(r.notices, [], 'the miss count started over');
});

test('the house internet being out never counts as Wolf Hall down', () => {
  let r = step(emptyState(), { worker: DOWN, site: DOWN, offline: true }, t(0));
  r = step(r.state, { worker: DOWN, site: DOWN, offline: true }, t(15));
  r = step(r.state, { worker: DOWN, site: DOWN, offline: true }, t(30));
  assert.deepEqual(r.notices, []);
  assert.equal(r.state.worker.misses, 0);
});

test('both down at once is one push naming both', () => {
  let r = step(emptyState(), { worker: DOWN, site: DOWN }, t(0));
  r = step(r.state, { worker: DOWN, site: DOWN }, t(15));
  assert.equal(r.notices.length, 1);
  assert.match(noticeText(r.notices[0], new Date(t(15))), /^Wolf Hall is down: worker and site, since 9:00 AM\.$/);
});

test('a down push that could not go folds into one "was down, back now"', () => {
  const q = queueNotices([{ kind: 'down', targets: ['worker'], since: t(0) }], [{ kind: 'back', targets: ['worker'], since: t(0), until: t(45) }]);
  assert.equal(q.length, 1);
  assert.equal(noticeText(q[0], new Date(t(45))), "Wolf Hall was down: worker, 9:00 AM to 9:45 AM. It's back now.");
  assert.equal(noticeText({ kind: 'back', targets: ['site'], since: t(0), until: t(90) }, new Date(t(90))), 'Wolf Hall is back: site answering again (down 1 h 30 min).');
  assert.equal(minutesText(20 * 60000), '20 min');
});

test('the log keeps 7 days', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-'));
  const file = path.join(dir, 'log.jsonl');
  const now = new Date(t(0));
  fs.writeFileSync(file, [JSON.stringify({ at: new Date(now - 8 * 86400000).toISOString() }), JSON.stringify({ at: new Date(now - 6 * 86400000).toISOString() }), 'junk'].join('\n') + '\n');
  assert.equal(appendLog({ at: now.toISOString() }, { file, now }), 2);
  fs.rmSync(dir, { recursive: true });
});

// A fake internet: each URL answers from the table; records every request.
function fakeNet(table) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    const h = table[url];
    if (!h || h === 'fail') throw new Error('fetch failed');
    return h(opts);
  };
  return { calls, fetchImpl };
}
const json = (status, body) => () => ({ ok: status < 300, status, json: async () => body });

test('runOnce: reads /health with the key, pushes Horace only after the second miss, and only through /push/send', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-'));
  const files = { stateFile: path.join(dir, 's.json'), logFile: path.join(dir, 'l.jsonl') };
  const toasts = [];
  const table = {
    [WORKER_URL + '/health']: json(200, { ok: true, version: 'v296', notion: true }),
    [SITE_URL]: json(503, {}),
    [WORKER_URL + '/push/send']: json(200, { ok: true, sent: 1 }),
  };
  const net = fakeNet(table);
  let min = 0;
  const run = () => runOnce({ ...net, key: 'k-test', now: () => new Date(t(min)), toast: async (x) => toasts.push(x), ...files });
  let r = await run();
  assert.equal(r.sent.length, 0);
  assert.equal(net.calls.find((c) => c.url.endsWith('/health')).headers['X-Worker-Key'], 'k-test');
  min = 15; r = await run();
  assert.equal(r.sent.length, 1);
  const pushes = net.calls.filter((c) => c.url.endsWith('/push/send'));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].method, 'POST');
  const body = JSON.parse(pushes[0].body);
  assert.equal(body.person, 'Horace');
  assert.match(body.body, /^Wolf Hall is down: site, since 9:00 AM\.$/);
  assert.equal(toasts.length, 1);
  // Every other request is a GET; nothing but /push/send is ever posted.
  assert.ok(net.calls.filter((c) => !c.url.endsWith('/push/send')).every((c) => c.method === 'GET'));
  min = 30; r = await run();
  assert.equal(r.sent.length, 0, 'still down: quiet');
  table[SITE_URL] = json(200, {});
  min = 45; r = await run();
  assert.equal(r.sent.length, 1);
  assert.match(JSON.parse(net.calls.filter((c) => c.url.endsWith('/push/send')).pop().body).body, /back: site.*down 45 min/);
  assert.equal(fs.readFileSync(files.logFile, 'utf8').trim().split('\n').length, 4);
  fs.rmSync(dir, { recursive: true });
});

test('runOnce: worker down means the push waits, then one combined push when it is back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-'));
  const files = { stateFile: path.join(dir, 's.json'), logFile: path.join(dir, 'l.jsonl') };
  const table = { [WORKER_URL + '/health']: 'fail', [SITE_URL]: json(200, {}), [WORKER_URL + '/push/send']: json(200, { ok: true, sent: 2 }) };
  const net = fakeNet(table);
  let min = 0;
  const run = () => runOnce({ ...net, key: 'k', now: () => new Date(t(min)), toast: async () => {}, ...files });
  await run(); min = 15; let r = await run();
  assert.equal(r.sent.length, 0);
  assert.equal(r.state.pending.length, 1, 'the down notice waits for the worker');
  assert.equal(net.calls.filter((c) => c.url.endsWith('/push/send')).length, 0);
  table[WORKER_URL + '/health'] = json(200, { ok: true });
  min = 30; r = await run();
  const pushes = net.calls.filter((c) => c.url.endsWith('/push/send'));
  assert.equal(pushes.length, 1);
  assert.equal(JSON.parse(pushes[0].body).body, "Wolf Hall was down: worker, 9:00 AM to 9:30 AM. It's back now.");
  assert.equal(r.state.pending.length, 0);
  fs.rmSync(dir, { recursive: true });
});

test('runOnce: both fail and the control page fails too = offline, nothing counted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-'));
  const files = { stateFile: path.join(dir, 's.json'), logFile: path.join(dir, 'l.jsonl') };
  const net = fakeNet({ [CONTROL_URL]: 'fail' });
  for (let i = 0; i < 3; i++) {
    const r = await runOnce({ ...net, key: 'k', now: () => new Date(t(i * 15)), toast: async () => assert.fail('no toast'), ...files });
    assert.equal(r.res.offline, true);
    assert.equal(r.notices.length, 0);
  }
  fs.rmSync(dir, { recursive: true });
});

test('a /health that answers 200 but not ok:true counts as a miss', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-'));
  const net = fakeNet({ [WORKER_URL + '/health']: json(200, { error: 'boom' }), [SITE_URL]: json(200, {}) });
  const r = await runOnce({ ...net, key: 'k', now: () => new Date(t(0)), toast: async () => {}, stateFile: path.join(dir, 's.json'), logFile: path.join(dir, 'l.jsonl') });
  assert.equal(r.res.worker.ok, false);
  assert.equal(r.state.worker.misses, 1);
  fs.rmSync(dir, { recursive: true });
});
