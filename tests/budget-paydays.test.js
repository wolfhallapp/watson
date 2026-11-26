// The Budget Construct's estimated paychecks past the live horizon land on Horace's real paydays (Wolf Hall v343):
// the 14th and the 29th (last day of the month when there's no 29th), the business day before on a weekend or bank holiday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simulate, horacePayday } from '../public/budget-engine.js';

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const paydays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) { const h = horacePayday(d); if (h) out.push([d, h]); } return out; };

test('his 2026 paychecks from the Best Ring history', () => {
  const got = paydays('2026-01-01', '2026-12-31').map(([d]) => d);
  for (const d of ['2026-02-13', '2026-02-27', '2026-03-13', '2026-03-27', '2026-06-12', '2026-08-28', '2026-11-13', '2026-11-27', '2026-12-14', '2026-12-29']) {
    assert.ok(got.includes(d), d);
  }
  assert.equal(got.length, 24); // two a month, never doubled or dropped
  assert.equal(horacePayday('2026-11-27'), 'H1'); // the 29th check is December's "1st check"
  assert.equal(horacePayday('2026-12-14'), 'H15');
  assert.equal(horacePayday('2026-12-01'), null);
  assert.equal(horacePayday('2026-12-15'), null);
});

test('bank holidays move a check back', () => {
  assert.equal(horacePayday('2028-05-26'), 'H1'); // Memorial Day Mon 5/29/2028
  assert.equal(horacePayday('2028-05-29'), null);
  assert.equal(horacePayday('2030-10-11'), 'H15'); // Columbus Day Mon 10/14/2030
  assert.equal(horacePayday('2027-02-26'), 'H1'); // no 29th: Sun 2/28/2027 -> Fri 2/26
  assert.equal(horacePayday('2028-02-29'), 'H1'); // leap year: Tue 2/29/2028
});

// Same answers as the worker's own rule, when the Wolf Hall repo is on this PC.
const worker = path.join(os.homedir(), 'projects/wolf-hall-app/cloudflare-worker.js');
test('matches Wolf Hall horacePayDate() for 2026-2032', { skip: !fs.existsSync(worker) }, async () => {
  const src = fs.readFileSync(worker, 'utf8');
  const a = src.indexOf('const hpIso'), b = src.indexOf('// Every check landing from');
  assert.ok(a > 0 && b > a, 'worker payday rule not found');
  const body = src.slice(a, b).replace(/export function/g, 'function');
  const horacePayDate = new Function(body + '; return horacePayDate;')();
  const want = [];
  for (let y = 2025; y <= 2033; y++) for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    want.push([horacePayDate(`${y}-${mm}-15`), 'H15'], [horacePayDate(`${y}-${mm}-01`), 'H1']);
  }
  const got = paydays('2025-12-01', '2032-12-31');
  const wantSorted = want.filter(([d]) => d >= '2025-12-01' && d <= '2032-12-31').sort((x, y) => x[0].localeCompare(y[0]));
  assert.deepEqual(got, wantSorted);
});

test('long what-ifs estimate his zelle on the 27th, 14th and 29th, each at its half-month amount', () => {
  const live = {
    today: '2026-11-05', horizon: '2026-11-20', pool: 500, cushion: 100, categories: [], phases: [{ from: '0000-01-01', targets: {} }],
    events: [
      { date: '2026-10-29', amount: 1600, label: "Horace's zelle", type: 'income' }, // past, but sets the "1st check" amount
      { date: '2026-11-13', amount: 1581, label: "Horace's zelle", type: 'income' },
    ],
  };
  const est = simulate(live, { horizon: '2027-01-02' }).events.filter((e) => e.est && /Horace/.test(e.label)).map((e) => [e.date, e.amount]);
  assert.deepEqual(est, [['2026-11-27', 1600], ['2026-12-14', 1581], ['2026-12-29', 1600]]);
  const adj = simulate(live, { horizon: '2027-01-02', horaceAdj: -100 }).events.filter((e) => e.est && /Horace/.test(e.label)).map((e) => e.amount);
  assert.deepEqual(adj, [1500, 1481, 1500]);
});
