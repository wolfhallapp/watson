// The Sunday week in review (night shift 2026-10-30): Saturday night's Morning Log boiled down for the Sunday briefing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeMorningWeek, formatTrends, prepareWeeklyTrends } from '../server/trends.js';
import { ROUTINES, routineDue } from '../server/routines.js';

const day = (d, o = {}) => ({ day: d, checkedIn: false, sleepHours: null, sleepQuality: null, energy: null, mood: null, weight: null, ...o });
// Shaped like the live GET /morning response, read on Saturday 10/31 (days = Sun 10/25 .. Sat 10/31).
const morning = {
  ok: true, person: 'Horace', today: '2026-10-31', streak: 6,
  week: { checkIns: 6, topsDone: 7, topsSet: 12 },
  days: [
    day('2026-10-25'),
    day('2026-10-26', { checkedIn: true, sleepQuality: 5, energy: 5, mood: 5, weight: 296.2 }),
    day('2026-10-27', { checkedIn: true, sleepHours: 5.5, sleepQuality: 3, energy: 2, mood: 4, weight: 292.8 }),
    day('2026-10-28', { checkedIn: true, sleepHours: 5.75, sleepQuality: 3, energy: 2, mood: 2, weight: 298.5 }),
    day('2026-10-29', { checkedIn: true, sleepHours: 6.25, sleepQuality: 4, energy: 4, mood: 4, weight: 300.6 }),
    day('2026-10-30', { checkedIn: true, sleepHours: 7, sleepQuality: 4, energy: 3, mood: 4 }),
    day('2026-10-31', { checkedIn: true, sleepHours: 6.5, sleepQuality: 3, energy: 3, mood: 3 }),
  ],
};

test('the week is averaged over the days that have numbers, never counting blanks as zero', () => {
  const w = summarizeMorningWeek(morning);
  assert.deepEqual([w.weekStart, w.weekEnd, w.checkIns, w.streak], ['2026-10-25', '2026-10-31', 6, 6]);
  assert.equal(w.sleepHours, 6.2);   // 31 / 5 nights
  assert.equal(w.sleepQuality, 3.7); // 22 / 6
  assert.equal(w.mood, 3.7);
  assert.equal(w.energy, 3.2);
  assert.deepEqual([w.weighIns, w.weightFirst, w.weightLast, w.weightChange], [4, 296.2, 300.6, 4.4]);
  assert.deepEqual([w.topsDone, w.topsSet], [7, 12]);
  assert.equal(w.bestDay.day, '2026-10-26');
  assert.throws(() => summarizeMorningWeek({ ok: false, error: 'Notion down' }), /Notion down/);
});

test('the briefing line gives real numbers, compares with last week, and states weight plainly', () => {
  const w = summarizeMorningWeek(morning);
  const prev = { weekStart: '2026-10-18', sleepHours: 5.8, mood: 3.7, energy: 3.5 };
  const t = formatTrends(w, prev);
  const first = t.split('\n')[0];
  assert.match(first, /^📈 Week \(Oct 25 to Oct 31\): 6 of 7 check-ins \(streak 6\)/);
  assert.match(first, /sleep 6\.2 h a night, up 0\.4 h from last week, quality 3\.7 of 5/);
  assert.match(first, /mood 3\.7, same as last week/);
  assert.match(first, /energy 3\.2, down 0\.3 from last week/);
  assert.match(first, /weight 296\.2 to 300\.6 lb over 4 weigh-ins/);
  assert.match(first, /top 3: 7 of 12 done\. Best day: Monday\.$/);
  assert.doesNotMatch(first, /should|need to|try to/i); // encourage, never nag
  assert.match(t, /\| Mon Oct 26 \| yes \| {2}\| 5 \| 5 \| 5 \| 296\.2 \|/);
  assert.match(formatTrends(w), /No earlier week saved yet/);
  assert.doesNotMatch(formatTrends(w).split('\n')[0], /last week/);
});

test('an empty week says so instead of making numbers up', () => {
  const blank = { ...morning, streak: 0, week: { topsDone: 0, topsSet: 0 }, days: morning.days.map((d) => day(d.day)) };
  assert.match(formatTrends(summarizeMorningWeek(blank)), /^📈 Week: nothing was logged/);
});

test('it runs Saturday 11 PM Central, once, with no agent and only a read of /morning', async () => {
  const r = ROUTINES.find((x) => x.key === 'weeklyTrends');
  assert.equal(typeof r.run, 'function');
  assert.equal(r.prompt, undefined);
  assert.equal(routineDue(r, new Date('2026-11-01T03:59:00Z'), null), null);           // Sat 10:59 PM CDT
  assert.equal(routineDue(r, new Date('2026-11-01T04:00:00Z'), null), '2026-10-31');   // Sat 11:00 PM CDT
  assert.equal(routineDue(r, new Date('2026-11-01T04:30:00Z'), '2026-10-31'), null);   // already ran
  assert.equal(routineDue(r, new Date('2026-11-01T05:30:00Z'), null), null);           // Sunday: too late
  assert.equal(routineDue(r, new Date('2026-11-08T05:30:00Z'), null), '2026-11-07');   // Sat 11:30 PM CST
  const brief = ROUTINES.find((x) => x.key === 'morningBriefing');
  assert.match(brief.prompt, /On Sundays, .*trends\/<today>\.md.*📈 Week/);
});

test('prepare saves Sunday\'s file, compares with last Sunday, and leaves a 📈 line on failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trends-'));
  fs.writeFileSync(path.join(dir, '2026-10-25.json'), JSON.stringify({ weekStart: '2026-10-18', mood: 3 }));
  const asked = [];
  const get = async (p) => { asked.push(p); return { status: 200, body: JSON.stringify(morning) }; };
  const sat = new Date('2026-11-01T04:05:00Z'); // 11:05 PM CDT Saturday 10/31
  const out = await prepareWeeklyTrends({ now: sat, get, dir });
  assert.deepEqual(asked, ['/morning?person=Horace']);
  assert.equal(out.sunday, '2026-11-01');
  const md = fs.readFileSync(path.join(dir, '2026-11-01.md'), 'utf8');
  assert.match(md.split('\n')[0], /mood 3\.7, up 0\.7 from last week/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '2026-11-01.json'), 'utf8')).checkIns, 6);
  // The worker's day must be Saturday, or the 7 days aren't Sunday to Saturday.
  await assert.rejects(prepareWeeklyTrends({ now: new Date('2026-11-08T04:05:00Z'), get, dir }), /not 2026-11-07/);
  assert.match(fs.readFileSync(path.join(dir, '2026-11-08.md'), 'utf8'), /^📈 Week: couldn't build/);
  await assert.rejects(prepareWeeklyTrends({ now: sat, get: async () => ({ status: 500, body: '' }), dir }), /HTTP 500/);
});
