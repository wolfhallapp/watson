// Nightly Notion backup (Night Shift #22): a mocked worker and a temp folder; no real requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBackup, prune, central, doneToday, README, keepMonthly } from '../server/notion-backup.js';

const KEY = 'k'.repeat(32);
const NOW = new Date('2026-11-23T09:30:00Z'); // 3:30 AM Central, Mon 11/23
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whbk-'));

/** A fake /system/backup: tables of N rows, served 100 at a time. */
function fakeWorker(tables, { status = 200, fail = {} } = {}) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', key: opts.headers?.['X-Worker-Key'] });
    const u = new URL(url);
    const res = (code, body) => new Response(JSON.stringify(body), { status: code });
    if (u.pathname !== '/system/backup') return res(404, { error: 'Not found' });
    if (status !== 200) return res(status, { error: 'nope' });
    const db = u.searchParams.get('db');
    if (!db) return res(200, { databases: Object.keys(tables) });
    if (fail[db]) return res(500, { error: fail[db] });
    const n = tables[db], start = Number(u.searchParams.get('cursor') || 0);
    const rows = Array.from({ length: Math.max(0, Math.min(100, n - start)) }, (_, i) => ({ id: `${db}-${start + i}`, properties: { N: { number: start + i } } }));
    const more = start + 100 < n;
    return res(200, { db, id: 'id-' + db, rows, has_more: more, next_cursor: more ? String(start + 100) : null });
  };
  return { fetchFn, calls };
}

test('backs up every table, paging through, with the master key on every call and only GETs', async () => {
  const dir = tmp();
  const w = fakeWorker({ 'bills-one-time': 250, 'receipt-log': 0, 'wishlist': 7 });
  const r = await runBackup({ fetchFn: w.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.day, '2026-11-23');
  assert.deepEqual(r.counts, { 'bills-one-time': 250, 'receipt-log': 0, 'wishlist': 7 });
  assert.ok(w.calls.every(c => c.key === KEY && c.method === 'GET'), 'master key, GET only');
  assert.equal(w.calls.filter(c => c.url.includes('db=bills-one-time')).length, 3, '250 rows = 3 pages');
  const f = JSON.parse(fs.readFileSync(path.join(dir, '2026-11-23', 'bills-one-time.json'), 'utf8'));
  assert.equal(f.count, 250);
  assert.equal(new Set(f.rows.map(x => x.id)).size, 250);
  assert.equal(f.id, 'id-bills-one-time');
  const s = JSON.parse(fs.readFileSync(path.join(dir, '2026-11-23', '_summary.json'), 'utf8'));
  assert.equal(s.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), README);
  assert.ok(!fs.readdirSync(path.join(dir, '2026-11-23')).some(n => n.endsWith('.part')), 'no half files left');
  assert.equal(doneToday(dir, NOW), true);
});

test('a failed table is reported, the others are still saved, and the day is not marked done', async () => {
  const dir = tmp();
  const w = fakeWorker({ 'bills-one-time': 3, 'snake-scores': 2 }, { fail: { 'snake-scores': 'Notion API error' } });
  const r = await runBackup({ fetchFn: w.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: NOW });
  assert.equal(r.ok, false);
  assert.deepEqual(r.counts, { 'bills-one-time': 3 });
  assert.match(r.errors['snake-scores'], /HTTP 500: Notion API error/);
  assert.ok(!fs.existsSync(path.join(dir, '2026-11-23', 'snake-scores.json')));
  assert.equal(doneToday(dir, NOW), false, 'a retry will run');
});

test('before v300 is deployed (404) or with a refused key (403) it waits and writes nothing', async () => {
  for (const status of [404, 403]) {
    const dir = tmp();
    const w = fakeWorker({ 'bills-one-time': 3 }, { status });
    const r = await runBackup({ fetchFn: w.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: NOW });
    assert.equal(r.waiting, true);
    assert.equal(w.calls.length, 1);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
});

test('keeps 14 days: older day folders go, other files and folders are never touched', () => {
  const dir = tmp();
  for (const d of ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-22', '2026-11-23']) fs.mkdirSync(path.join(dir, d));
  fs.mkdirSync(path.join(dir, 'keep me'));
  fs.writeFileSync(path.join(dir, '2026-01-01'), 'a file, not a day folder');
  const gone = prune(dir, '2026-11-23', 14);
  assert.deepEqual(gone.sort(), ['2026-11-08', '2026-11-09']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-01-01', '2026-11-10', '2026-11-22', '2026-11-23', 'keep me']);
});

test('a strange database name from the worker is never used as a file name', async () => {
  const dir = tmp();
  const w = fakeWorker({ '../evil': 1, 'wishlist': 1 });
  const r = await runBackup({ fetchFn: w.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: NOW });
  assert.equal(r.errors['../evil'], 'bad name');
  assert.ok(!w.calls.some(c => c.url.includes('evil')));
  assert.ok(!fs.existsSync(path.join(dir, 'evil.json')));
});

test('the day is Central time', () => {
  assert.deepEqual(central(new Date('2026-11-23T05:30:00Z')), { day: '2026-11-22', hour: 23 });
  assert.deepEqual(central(new Date('2026-11-23T09:00:00Z')), { day: '2026-11-23', hour: 3 });
});

test('monthly copy (#120): the first complete backup of a month goes to monthly/YYYY-MM, once', async () => {
  const dir = tmp();
  const w = fakeWorker({ 'wishlist': 7 });
  const r1 = await runBackup({ fetchFn: w.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: new Date('2026-12-01T09:30:00Z') });
  assert.deepEqual(r1.monthly, { copied: '2026-12', pruned: [] });
  const f = JSON.parse(fs.readFileSync(path.join(dir, 'monthly', '2026-12', 'wishlist.json'), 'utf8'));
  assert.equal(f.count, 7);
  assert.ok(fs.existsSync(path.join(dir, 'monthly', '2026-12', '_summary.json')));
  const r2 = await runBackup({ fetchFn: w.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: new Date('2026-12-02T09:30:00Z') });
  assert.equal(r2.monthly.copied, null, 'the 2nd does not replace the 1st');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'monthly', '2026-12', '_summary.json'), 'utf8')).day, '2026-12-01');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'monthly')), ['2026-12']);
});

test('monthly copy: a failed 1st is skipped and the next complete day of the month is used', async () => {
  const dir = tmp();
  const bad = fakeWorker({ 'wishlist': 2, 'snake-scores': 1 }, { fail: { 'snake-scores': 'boom' } });
  const r1 = await runBackup({ fetchFn: bad.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: new Date('2027-01-01T09:30:00Z') });
  assert.equal(r1.monthly, null);
  assert.ok(!fs.existsSync(path.join(dir, 'monthly', '2027-01')));
  const good = fakeWorker({ 'wishlist': 2, 'snake-scores': 1 });
  const r2 = await runBackup({ fetchFn: good.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: new Date('2027-01-02T09:30:00Z') });
  assert.equal(r2.monthly.copied, '2027-01');
  assert.ok(!fs.readdirSync(path.join(dir, 'monthly')).some(n => n.endsWith('.part')));
});

test('monthly copy keeps 12 months; the 14-day prune never touches the monthly folder', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '2027-03-01'), { recursive: true });
  fs.writeFileSync(path.join(dir, '2027-03-01', '_summary.json'), '{}');
  for (const m of ['2026-02', '2026-03', '2026-04', '2027-02']) fs.mkdirSync(path.join(dir, 'monthly', m), { recursive: true });
  fs.writeFileSync(path.join(dir, 'monthly', 'notes.txt'), 'keep');
  const r = keepMonthly(dir, '2027-03-01', 12);
  assert.equal(r.copied, '2027-03');
  assert.deepEqual(r.pruned.sort(), ['2026-02', '2026-03']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'monthly')).sort(), ['2026-04', '2027-02', '2027-03', 'notes.txt']);
  assert.deepEqual(prune(dir, '2027-04-30', 14), ['2027-03-01']);
  assert.ok(fs.existsSync(path.join(dir, 'monthly', '2027-03', '_summary.json')));
});

test('the README tells Horace only the monthly folder is meant for Drive', () => {
  assert.match(README, /monthly\\YYYY-MM/);
  assert.match(README, /Google Drive for desktop/);
});

test('a monthly copy error is reported but never loses the night\'s backup', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'monthly'), 'a file where the folder should be');
  const w = fakeWorker({ 'wishlist': 1 });
  const r = await runBackup({ fetchFn: w.fetchFn, workerUrl: 'https://w.test', key: KEY, dir, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.monthly.copied, null);
  assert.ok(r.monthly.error);
  assert.equal(doneToday(dir, NOW), true);
});
