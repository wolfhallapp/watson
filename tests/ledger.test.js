// The Ledger of the week (night shift 2026-10-30): numbers from past weeks only, honest about untracked weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLedger, formatLedger, topMerchants, eatingOut, merchantOf, fetchLedgerWeeks, prepareWeeklyLedger } from '../server/ledger.js';
import { ROUTINES, routineDue } from '../server/routines.js';

const B = (o = {}) => ({ Groceries: 0, Cigs: 0, C4: 0, GasTaylor: 0, GasHorace: 0, Tithing: 0, FunMoney: 0, Pet: 0, Kids: 0, Other: 0, Gambling: 0, ...o });
const cat = (key, spent, cap) => ({ key, spent, cap });
// Shaped like the live 10/23-10/29 week.
const lastWeek = {
  ok: true, label: 'Oct 23 – Oct 29', weekStart: '2026-10-23', weekEnd: '2026-10-29', totalSpent: 622.68, totalCap: 355,
  categories: [cat('Groceries', 225.9, 150), cat('Cigs', 53.87, 55), cat('C4', 26.07, 60), cat('GasTaylor', 0, 0), cat('Tithing', 42.5, 40),
    cat('FunMoney', 144.37, 50), cat('Pet', 42.41, 0), cat('Kids', 6.48, 0), cat('Other', 61.08, 0), cat('Gambling', 20, 0)],
  receipts: [
    { name: 'Cigs — Horace — 2026-10-28', total: 26.39, date: '2026-10-28', buckets: B({ Cigs: 26.39 }) },
    { name: 'Tacos — Horace — 2026-10-27', total: 20, date: '2026-10-27', buckets: B({ Groceries: 20 }) },
    { name: 'The Boat Crawfish & Seafood — Taylor — 2026-10-27', total: 33.35, date: '2026-10-27', buckets: B({ FunMoney: 28.15 }) },
    { name: 'Cigs — Horace — 2026-10-25', total: 27.48, date: '2026-10-25', buckets: B({ Cigs: 27.48 }) },
    { name: 'Walmart — Horace — 2026-10-25', total: 93.76, date: '2026-10-25', buckets: B({ Pet: 40.83, Other: 52.93 }) },
    { name: 'Cicis Pizza — Horace — 2026-10-25', total: 59.22, date: '2026-10-25', buckets: B({ FunMoney: 52.74, Kids: 6.48 }) },
    { name: 'HEB — Taylor — 2026-10-24', total: 221.98, date: '2026-10-24', buckets: B({ Groceries: 188.68, C4: 26.07 }) },
    { name: 'DQ Grill & Chill — Horace — 2026-10-23', total: 27.87, date: '2026-10-23', buckets: B({ FunMoney: 27.87 }) },
    { name: 'DQ Grill & Chill — Horace — 2026-10-23', total: 35.61, date: '2026-10-23', buckets: B({ FunMoney: 35.61 }) },
  ],
};
const empty = (ws, we) => ({ ok: true, label: ws, weekStart: ws, weekEnd: we, totalSpent: 0, totalCap: 355, categories: [cat('Groceries', 0, 150)], receipts: [] });
const tracked = (ws, fm) => ({ ...empty(ws, ws), totalSpent: fm, receipts: [{ name: `Sonic — Taylor — ${ws}`, total: fm, date: ws, buckets: B({ FunMoney: fm }) }] });

test('merchants are grouped by store and ranked by money spent', () => {
  assert.equal(merchantOf('HEB — Taylor — 2026-10-24'), 'HEB');
  const top = topMerchants(lastWeek.receipts);
  assert.equal(top.length, 5);
  assert.deepEqual(top.map((m) => m.merchant), ['HEB', 'Walmart', 'DQ Grill & Chill', 'Cicis Pizza', 'Cigs']);
  assert.deepEqual([top[2].total, top[2].visits], [63.48, 2]);
  assert.equal(top[4].handLogged, true); // "Cigs" is a hand-logged category, not a store
});

test('eating out is the Fun Money bucket, and restaurant receipts logged elsewhere are flagged', () => {
  const e = eatingOut(lastWeek.receipts);
  assert.equal(e.funMoney, 144.37);
  assert.deepEqual(e.elsewhere.map((x) => x.merchant), ['Tacos']);
});

test('untracked weeks are left out of the trend instead of counting as $0', () => {
  const l = buildLedger([lastWeek, tracked('2026-10-16', 40), empty('2026-10-09', '2026-10-15'), tracked('2026-10-02', 60), empty('2026-09-25', '2026-10-01')]);
  assert.equal(l.eatingOut.priorAverage, 50);
  assert.equal(l.eatingOut.vsAverage, 94.37);
  assert.equal(l.eatingOut.untrackedPriorWeeks, 2);
  assert.deepEqual(l.overTarget.map((c) => [c.key, c.over]), [['FunMoney', 94.37], ['Groceries', 75.9], ['Tithing', 2.5]]);
  const t = formatLedger(l);
  assert.match(t, /\$622\.68 spent against \$355\.00/);
  assert.match(t, /Fun Money \(eating out\): \$144\.37 of \$50\.00 \(\$94\.37 over\)/);
  assert.match(t, /Cigs: \$53\.87 of \$55\.00 \(\$1\.13 under\)/);
  assert.match(t, /2 of the 4 earlier weeks had no receipts/);
  assert.match(t, /Tacos \$20\.00/);
});

test('no earlier tracked weeks means no trend, and an empty week says so', () => {
  const l = buildLedger([lastWeek, empty('a', 'a'), empty('b', 'b'), empty('c', 'c'), empty('d', 'd')]);
  assert.equal(l.eatingOut.priorAverage, null);
  assert.match(formatLedger(l), /no trend yet/);
  assert.match(formatLedger(buildLedger([empty('x', 'y')])), /No receipts were logged/);
  assert.throws(() => buildLedger([{ ok: false, error: 'Notion down' }]), /Notion down/);
});

test('it only ever reads past weeks (never offset 0, which writes rollovers)', async () => {
  const asked = [];
  await fetchLedgerWeeks(async (p) => { asked.push(p); return { status: 200, body: JSON.stringify(lastWeek) }; });
  assert.deepEqual(asked, ['/week-budget?offset=-1', '/week-budget?offset=-2', '/week-budget?offset=-3', '/week-budget?offset=-4', '/week-budget?offset=-5']);
  await assert.rejects(fetchLedgerWeeks(async () => ({ status: 500, body: '{}' })), /HTTP 500/);
});

test('prepare saves the numbers, and on a mismatch or failure leaves a 📊 line for the briefing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const weeks = [lastWeek, empty('2026-10-16', '2026-10-22'), empty('2026-10-09', '2026-10-15'), empty('2026-10-02', '2026-10-08'), empty('2026-09-25', '2026-10-01')];
  const get = async (p) => ({ status: 200, body: JSON.stringify(weeks[Number(p.split('-').pop()) - 1]) });
  const fri = new Date('2026-10-30T05:20:00Z'); // 12:20 AM CDT Friday
  const r = await prepareWeeklyLedger({ now: fri, get, dir });
  assert.equal(r.today, '2026-10-30');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '2026-10-30.json'), 'utf8')).totalSpent, 622.68);
  assert.match(r.facts, /Oct 23/);
  // A week later the worker would still be answering for 10/29: refuse rather than report the wrong week.
  await assert.rejects(prepareWeeklyLedger({ now: new Date('2026-11-06T06:20:00Z'), get, dir }), /not yesterday/);
  assert.match(fs.readFileSync(path.join(dir, '2026-11-06.md'), 'utf8'), /^📊 Ledger of the week: couldn't build it/);
  fs.rmSync(dir, { recursive: true });
});

test('the Ledger runs once, early Friday (12:20-6 AM Central), ahead of the Night Shift', () => {
  const r = ROUTINES.find((x) => x.key === 'weeklyLedger');
  assert.ok(ROUTINES.indexOf(r) < ROUTINES.findIndex((x) => x.key === 'nightShift'));
  assert.equal(routineDue(r, new Date('2026-10-30T05:19:00Z'), null), null);            // Fri 12:19 AM CDT
  assert.equal(routineDue(r, new Date('2026-10-30T05:20:00Z'), null), '2026-10-30');    // Fri 12:20 AM CDT
  assert.equal(routineDue(r, new Date('2026-10-30T09:00:00Z'), '2026-10-30'), null);    // already ran
  assert.equal(routineDue(r, new Date('2026-10-30T11:00:00Z'), null), null);            // 6 AM: too late
  assert.equal(routineDue(r, new Date('2026-10-29T05:20:00Z'), null), null);            // Thursday
  assert.equal(routineDue(r, new Date('2026-11-06T06:30:00Z'), '2026-10-30'), '2026-11-06'); // 12:30 AM CST
  const p = r.prompt({ facts: 'FACTS', file: '/x/2026-10-30.md', today: '2026-10-30' });
  assert.match(p, /FACTS/);
  assert.match(p, /📊 Ledger:/);
  assert.match(p, /NEGATIVE offset only/);
  assert.match(p, /Never guess a price/);
  assert.match(ROUTINES.find((x) => x.key === 'morningBriefing').prompt, /On Fridays, .*ledger\/<today>\.md/);
});
