// The house TV (11/23): GET /tv/state shows only what anyone walking by may see. No money, no bills, nothing private.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tvState, publicLines, countdowns, churchNext, verseOfDay, tripPanel } from '../server/tv.js';

const day = { ok: true, today: { lines: [
  { k: 'weather', t: 'Weather: tonight 41°F' }, { k: 'bills', t: 'Bills tomorrow: T-Mobile $228' },
  { k: 'care', t: 'Care jobs due: Change the A/C filter' }, { k: 'church', t: 'Ephesians class tonight' },
  { k: 'x', t: 'Pool is low' }, { k: 'x', t: 'Taylor\'s payday Friday' } ] },
  week: { lines: [{ k: 'weather', t: 'Weather: Tue 52°' }, { k: 'money', t: 'Spend $40 on gas' }, { k: 'trash', t: 'Trash goes out Thursday' }] } };
const away = { ok: true, on: true, phase: 'before', leave: '2026-11-25T12:00', back: '2026-11-29T19:00', freezes: [{ name: 'Wednesday Night', low: 32 }],
  checklist: [{ item: 'Thermostat' }] };
const get = async (p) => ({ status: 200, body: JSON.stringify(p === '/dayahead' ? day : away) });

test('no money or bills ever reach the TV', async () => {
  const s = await tvState({ get, weather: async () => ({ short: '41°F, partly cloudy' }), now: new Date(2026, 10, 23, 20) });
  const all = JSON.stringify(s);
  assert.doesNotMatch(all, /\$|T-Mobile|Pool|payday|Spend/);
  assert.deepEqual(s.today, ['Ephesians class tonight']);
  assert.deepEqual(s.weekLines, ['Trash goes out Thursday']);
  assert.equal(s.weather, '41°F, partly cloudy');
  assert.equal(s.week, 'Weather: Tue 52°');
  assert.equal(s.trip.phase, 'before');
  assert.equal(s.trip.checklist, undefined, 'the away checklist stays off the TV');
  assert.deepEqual(s.trip.freezes, ['Wednesday Night: low 32°F']);
});

test('publicLines drops private kinds and words', () => {
  assert.deepEqual(publicLines([{ k: 'health', t: 'x' }, { k: 'gifts', t: 'y' }, { k: 'a', t: 'Jake\'s meds at 8' }, { k: 'a', t: 'Feed the dogs' }]), ['Feed the dogs']);
});

test('countdowns: Thanksgiving 2026 is Thu 11/26, soonest first', () => {
  const c = countdowns(new Date(2026, 10, 23, 20));
  assert.equal(c[0].name, 'Thanksgiving'); assert.equal(c[0].days, 3); assert.equal(c[0].date, '2026-11-26');
  assert.equal(c[1].name, 'Christmas'); assert.equal(c[1].days, 32);
});

test('church: Monday night shows Ephesians first', () => {
  const c = churchNext(new Date(2026, 10, 23, 20));
  assert.equal(c[0].when, 'Today'); assert.equal(c[0].what, 'Ephesians class');
  assert.equal(c[1].what, 'Wednesday night service');
});

test('a verse every day and no trip panel when Away is off', () => {
  assert.match(verseOfDay(new Date(2026, 10, 23)).ref, /\d+:\d+/);
  assert.equal(tripPanel({ ok: true, on: false }), null);
});

test('packing, what shipped and commercials stay public', async () => {
  const { tripTodo, shippedFrom, commercials } = await import('../server/tv.js');
  assert.deepEqual(tripTodo({ ok: true, on: true, phase: 'before', checklist: [{ item: 'Thermostat set for an empty house (heat no lower than 55°F)', done: false }, { item: 'Pay the $40 bill', done: false }, { item: 'Lock up', done: true }] }), ['Thermostat set for an empty house']);
  assert.deepEqual(tripTodo({ ok: true, on: true, phase: 'away', checklist: [{ item: 'x' }] }), []);
  const p = '# Progress\n## 2026-11-23 (agents) - v343 deployed: day-ahead, Land walk fix, Ram stall help, real paydays\n- x\n## 2026-11-22 - v339 deployed: older';
  assert.deepEqual(shippedFrom(p), { version: 'v343', items: ['day-ahead', 'Land walk fix', 'Ram stall help'] });
  assert.equal(shippedFrom('nothing here'), null);
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-'));
  fs.mkdirSync(path.join(d, 'pappy-skillet')); fs.writeFileSync(path.join(d, 'pappy-skillet', 'pappy-skillet.mp4'), 'x');
  fs.mkdirSync(path.join(d, 'empty'));
  assert.deepEqual(commercials(d), ['pappy-skillet']);
});
