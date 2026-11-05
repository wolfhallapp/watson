// The Budget Construct: the what-if engine (public/budget-engine.js) and the server's note to the Oracle (server/sandbox.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simulate, solve, insights, fridayOnOrBefore } from '../public/budget-engine.js';
import { describeChanges, saveScenario, takeSandboxNote, snapshot, load, liveData } from '../server/sandbox.js';

// A small made-up plan (Thursday 2026-11-05 through Friday 11-20).
const live = {
  today: '2026-11-05', horizon: '2026-11-20', pool: 500, cushion: 100,
  categories: [{ key: 'Groceries', spent: 100 }, { key: 'FunMoney', spent: 30 }],
  phases: [{ from: '0000-01-01', targets: { Groceries: 140, FunMoney: 16 } }, { from: '2026-11-13', targets: { Groceries: 150, FunMoney: 50 } }],
  events: [
    { date: '2026-11-01', amount: -10, label: 'Google One', type: 'bill' }, // overdue: counts today
    { date: '2026-11-06', amount: 1216, label: "Taylor's paycheck", type: 'income' },
    { date: '2026-11-07', amount: -130, label: 'Starlink Internet', type: 'bill' },
    { date: '2026-11-13', amount: 1216, label: "Taylor's paycheck", type: 'income' },
    { date: '2026-11-13', amount: 1581, label: "Horace's zelle", type: 'income' },
    { date: '2026-11-16', amount: -1945, label: 'Debt Consolidation 2/2', type: 'bill' },
    { date: '2026-11-18', amount: -600, label: 'Christmas', type: 'goal' },
    { date: '2026-11-20', amount: 1216, label: "Taylor's paycheck", type: 'income' },
    { date: '2026-12-07', amount: -130, label: 'Starlink Internet', type: 'bill' },
  ],
};

// The worker's Spend Today formula, written out longhand.
function workerDaily(pool, events, today, end, cushion) {
  let cum = 0, n = 0, best = Infinity;
  for (let d = today; d <= end; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) {
    cum += events.filter((e) => (e.date < today ? today : e.date) === d).reduce((t, e) => t + e.amount, 0); n += 1;
    best = Math.min(best, (pool + cum - cushion) / n);
  }
  return Math.max(0, Math.floor(best * 100) / 100);
}

test('with no tweaks, safe-to-spend matches the worker formula', () => {
  const s = simulate(live, {});
  assert.equal(s.safeDaily, workerDaily(500, live.events, live.today, live.horizon, 100));
  assert.equal(s.days[0].net, -10); // the overdue bill lands today
  assert.equal(s.end, '2026-11-20');
});

test('the Pool line spends what is left this week, then each week evenly', () => {
  const s = simulate(live, {});
  assert.equal(fridayOnOrBefore('2026-11-05'), '2026-10-30');
  assert.equal(s.weekEnd, '2026-11-05');
  assert.equal(s.leftThisWeek, 40); // Groceries 140-100; Fun Money already over counts 0
  assert.equal(s.days[0].pool, 500 - 10 - 40);
  assert.equal(s.days[1].spend, Math.round(156 / 7 * 100) / 100); // phase 1 before 11/13
  assert.equal(s.days.find((d) => d.date === '2026-11-13').spend, Math.round(200 / 7 * 100) / 100); // phase 2
});

test('tweaks: weekly overrides, bill changes, goal dates, skipped events and extras', () => {
  const tw = {
    weekly: { FunMoney: { now: 6 }, 'Fast Food': { now: 25, custom: true, label: 'Fast Food' } },
    bills: { 'Starlink Internet': { amount: 100, shift: 2 } },
    goals: { Christmas: { amount: 400, date: '2026-11-19' } },
    off: { "2026-11-20|Taylor's paycheck": true },
    extras: [{ id: 'a', label: 'Side gig', amount: 50, date: '2026-11-08', repeat: 'weekly' }],
    taylorPay: 1300, horaceAdj: -100,
  };
  const s = simulate(live, tw);
  const ev = (label, date) => s.events.find((e) => e.label === label && (!date || e.date === date));
  assert.equal(s.weeklyNow.FunMoney, 6);
  assert.equal(s.weeklyNow['Fast Food'], 25);
  assert.equal(s.weeklyLater.FunMoney, 50); // a built-in category keeps the worker's later amount
  assert.equal(s.weeklyLater['Fast Food'], 25); // an added one carries on
  assert.equal(ev('Starlink Internet').date, '2026-11-09');
  assert.equal(ev('Starlink Internet').amount, -100);
  assert.equal(ev('Christmas').date, '2026-11-19');
  assert.equal(ev('Christmas').amount, -400);
  assert.equal(ev("Taylor's paycheck", '2026-11-06').amount, 1300);
  assert.equal(ev("Horace's zelle").amount, 1481);
  assert.ok(ev("Taylor's paycheck", '2026-11-20').off);
  assert.deepEqual(s.events.filter((e) => e.label === 'Side gig').map((e) => e.date), ['2026-11-08', '2026-11-15']);
});

test('Debt Consolidation is locked even in a what-if', () => {
  const s = simulate(live, { bills: { 'Debt Consolidation 2/2': { off: true, amount: 1, shift: 10 } }, off: { '2026-11-16|Debt Consolidation 2/2': true } });
  const dc = s.events.find((e) => /Debt/.test(e.label));
  assert.equal(dc.amount, -1945); assert.equal(dc.date, '2026-11-16'); assert.ok(!dc.off);
});

test('past the live horizon, paychecks are estimated', () => {
  const s = simulate(live, { horizon: '2026-12-15' });
  const est = s.events.filter((e) => e.est);
  assert.deepEqual(est.filter((e) => /Taylor/.test(e.label)).map((e) => e.date), ['2026-11-27', '2026-12-04', '2026-12-11']);
  assert.deepEqual(est.filter((e) => /Horace/.test(e.label)).map((e) => [e.date, e.amount]), [['2026-12-15', 1581]]);
});

test('solvers find the edge of the cushion', () => {
  const v = solve.extraWeekly(live, {});
  assert.ok(v > 0);
  assert.ok(simulate(live, { weekly: { x: { now: v, custom: true } } }).low.v >= 100);
  assert.ok(simulate(live, { weekly: { x: { now: v + 2, custom: true } } }).low.v < 100);
  const g = solve.goalMax(live, {}, 'Christmas');
  assert.ok(simulate(live, { goals: { Christmas: { amount: g } } }).low.v >= 100);
  const d = solve.earliest(live, {}, 300);
  assert.match(d, /^2026-11-\d\d$/);
  assert.ok(insights(live, {}).length >= 3);
});

test('the Oracle gets a plain-words note of what changed, once', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-')), 'sandbox.json');
  assert.equal(takeSandboxNote(file), '');
  saveScenario({ tweaks: { weekly: { FunMoney: { now: 6 } }, bills: { Water: { off: true } }, extras: [{ id: 'a', label: 'Tooth', amount: -800, date: '2026-12-01', repeat: 'once' }] }, summary: { low: { v: 150, date: '2026-12-03' }, baseLow: { v: 187, date: '2026-12-03' }, safeDaily: 40, weeklyNowTotal: 300, under: 0, cushion: 100, endPool: 900, end: '2026-12-25' } }, file);
  const note = takeSandboxNote(file);
  assert.match(note, /Weekly FunMoney: live value → \$6/);
  assert.match(note, /Bill "Water" turned off: no → yes/);
  assert.match(note, /Added what-if item "Tooth" -\$800 on 2026-12-01/);
  assert.match(note, /lowest Pool \$150 on 2026-12-03 \(live plan: \$187/);
  assert.equal(takeSandboxNote(file), ''); // nothing new since
  assert.deepEqual(Object.keys(snapshot('save', 'Plan A', file)), ['Plan A']);
  assert.deepEqual(load(file).snapshots['Plan A'].tweaks.weekly, { FunMoney: { now: 6 } });
  assert.deepEqual(describeChanges({ cushion: 100 }, {}), ['Cushion: $100 → live value']);
});

test('live data is read from GET /spend-today only', async () => {
  const asked = [];
  const d = await liveData({ fresh: true, get: async (p) => { asked.push(p); return { status: 200, body: JSON.stringify({ ok: true, today: '2026-11-05', events: [] }) }; } });
  assert.deepEqual(asked, ['/spend-today']);
  assert.ok(d.phases.length >= 1);
});
