// The reading plan Horace and Taylor share (Night Shift #75): Trinity writes the week, code uploads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planMonday, prepareReadingPlan, readingPlanPrompt, readPlan, uploadReadingPlan, planFile } from '../server/reading-plan.js';
import { ROUTINES, routineDue } from '../server/routines.js';

// Central noon on a day (UTC 18:00 in November).
const at = (iso, hhmm = '12:00') => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.parse(iso + 'T00:00:00Z') + ((h + 6) * 60 + m) * 60000); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));
const week = (start) => ({ start, sermon: 'Hard Sayings 1 (Kirk)', passage: 'Luke 10:25-37', theme: 'Be the neighbor.',
  days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: new Date(Date.parse(start + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10), passage: 'John 6', note: '' })) });
const memStore = () => { let s = {}; return { get: () => s, set: (x) => { s = { ...s, ...x }; } }; };
const quiet = { log() {} };

test('the plan is for next Monday on Sunday, and this Monday on other days (Central time)', () => {
  assert.equal(planMonday(at('2026-11-29', '21:00')), '2026-11-30'); // Sunday night
  assert.equal(planMonday(at('2026-11-30')), '2026-11-30');           // Monday
  assert.equal(planMonday(at('2026-12-05', '23:30')), '2026-11-30'); // Saturday late (already Sunday in UTC)
  assert.equal(planMonday(at('2026-11-25')), '2026-11-23');           // Wednesday
});

test('prepare: nothing to do once the week is written; otherwise the file and dates for Trinity', () => {
  const dir = tmp();
  const p = prepareReadingPlan({ now: at('2026-11-29', '21:00'), dir });
  assert.deepEqual({ start: p.start, end: p.end, sunday: p.sunday }, { start: '2026-11-30', end: '2026-12-06', sunday: '2026-11-29' });
  assert.equal(p.file, planFile('2026-11-30', dir));
  const prompt = readingPlanPrompt(p);
  assert.match(prompt, /ESV/);
  assert.match(prompt, /Sermon notes/);
  assert.match(prompt, /no names of members, nothing from anyone's email/);
  assert.ok(prompt.includes(p.file) && prompt.includes('"start": "2026-11-30"'));
  assert.match(prompt, /don't call Wolf Hall yourself/);
  fs.writeFileSync(p.file, JSON.stringify(week('2026-11-30')));
  assert.equal(prepareReadingPlan({ now: at('2026-11-29', '21:30'), dir }), null);
  assert.equal(readingPlanPrompt(null), null);
});

test('readPlan refuses broken files', () => {
  const dir = tmp(), f = path.join(dir, 'x.json');
  fs.writeFileSync(f, '{not json'); assert.equal(readPlan(f), null);
  fs.writeFileSync(f, JSON.stringify({ start: 'soon', days: [{}] })); assert.equal(readPlan(f), null);
  fs.writeFileSync(f, JSON.stringify({ start: '2026-11-30', days: [] })); assert.equal(readPlan(f), null);
  assert.equal(readPlan(path.join(dir, 'missing.json')), null);
  fs.writeFileSync(f, JSON.stringify(week('2026-11-30'))); assert.equal(readPlan(f).start, '2026-11-30');
});

test('upload: this week and next, each once until it changes, with the master key', async () => {
  const dir = tmp(), store = memStore(), calls = [];
  const fetchFn = async (url, opts) => { calls.push({ url, opts }); const b = JSON.parse(opts.body); return new Response(JSON.stringify({ ok: true, week: b.week.start, days: b.week.days.length }), { status: 200 }); };
  fs.writeFileSync(planFile('2026-11-23', dir), JSON.stringify(week('2026-11-23')));
  fs.writeFileSync(planFile('2026-11-30', dir), JSON.stringify(week('2026-11-30')));
  fs.writeFileSync(planFile('2026-11-16', dir), JSON.stringify(week('2026-11-16'))); // last week: left alone
  const now = at('2026-11-29', '22:30'); // Sunday night: this week (Nov 23) and next (Nov 30)
  let r = await uploadReadingPlan({ dir, fetchFn, key: () => 'k', store, now, log: quiet });
  assert.deepEqual(r.map((x) => [x.start, x.ok]), [['2026-11-23', true], ['2026-11-30', true]]);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/reading-plan/feed') && calls[0].opts.headers['X-Worker-Key'] === 'k' && calls[0].opts.method === 'POST');
  assert.equal(JSON.parse(calls[1].opts.body).week.start, '2026-11-30');
  r = await uploadReadingPlan({ dir, fetchFn, key: () => 'k', store, now, log: quiet });
  assert.ok(r.every((x) => x.unchanged) && calls.length === 2, 'unchanged weeks are not sent again');
  fs.writeFileSync(planFile('2026-11-30', dir), JSON.stringify({ ...week('2026-11-30'), theme: 'Rewritten' }));
  r = await uploadReadingPlan({ dir, fetchFn, key: () => 'k', store, now, log: quiet });
  assert.equal(calls.length, 3, 'a rewritten week goes again');
  assert.ok(Object.keys(store.get().readingPlan).length <= 4);
});

test('upload: a refused week is not marked sent, and a mismatched file is skipped', async () => {
  const dir = tmp(), store = memStore();
  fs.writeFileSync(planFile('2026-11-23', dir), JSON.stringify(week('2026-11-23')));
  fs.writeFileSync(planFile('2026-11-30', dir), JSON.stringify(week('2026-12-07')));
  const fetchFn = async () => new Response(JSON.stringify({ error: 'week needs a start date' }), { status: 400 });
  const r = await uploadReadingPlan({ dir, fetchFn, key: () => 'k', store, now: at('2026-11-29', '22:30'), log: quiet });
  assert.deepEqual(r.map((x) => [x.start, x.ok, x.error]), [['2026-11-23', false, 'week needs a start date'], ['2026-11-30', false, "start date inside the file doesn't match its name"]]);
  assert.equal(store.get().readingPlan, undefined);
  const down = await uploadReadingPlan({ dir, fetchFn: async () => { throw new Error('offline'); }, key: () => 'k', store, now: at('2026-11-29', '22:30'), log: quiet });
  assert.equal(down[0].error, 'offline');
  assert.deepEqual(await uploadReadingPlan({ dir: tmp(), fetchFn, key: () => 'k', store, now: at('2026-11-29', '22:30'), log: quiet }), []);
});

test('the routines: Trinity at 9 PM after the sermon notes; the upload at 4 AM and 10:30 PM, code only', () => {
  const rp = ROUTINES.find((r) => r.key === 'readingPlan'), up = ROUTINES.find((r) => r.key === 'readingPlanUpload');
  assert.equal(rp.agent, 'trinity');
  assert.ok(ROUTINES.indexOf(rp) > ROUTINES.findIndex((r) => r.key === 'sermonNotes'));
  assert.equal(routineDue(rp, at('2026-11-29', '20:59'), null), null);
  assert.equal(routineDue(rp, at('2026-11-29', '21:00'), null), '2026-11-29');
  assert.ok(typeof up.run === 'function' && !up.agent);
  assert.equal(routineDue(up, at('2026-11-30', '04:00'), null), '2026-11-30@04:00');
  assert.equal(routineDue(up, at('2026-11-29', '22:31'), null), '2026-11-29@22:30');
  assert.equal(routineDue(up, at('2026-11-30', '03:59'), null), null);
});
