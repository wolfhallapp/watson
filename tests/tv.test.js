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

test('the TV page has no inline style or script (the Oracle\'s security policy blocks them)', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../public/tv.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<style|<script>(?!<\/script>)|<script(?![^>]*\bsrc=)/);
  assert.match(html, /href="tv\.css"/); assert.match(html, /src="tv-app\.js"/);
});

// 11/24 (Horace: "more verses, more informative data")
import { versesOfDay, factsOfDay, sunTimes, moonPhase, forecastCard, schoolCard, VERSES, FACTS } from '../server/tv.js';
test('three different verses and three facts a day, and tomorrow is different', () => {
  const a = versesOfDay(new Date(2026, 10, 24)), b = versesOfDay(new Date(2026, 10, 25));
  assert.equal(new Set(a.map((v) => v.ref)).size, 3);
  assert.notDeepEqual(a.map((v) => v.ref), b.map((v) => v.ref));
  assert.ok(VERSES.length >= 40 && FACTS.length >= 25);
  assert.equal(new Set(factsOfDay(new Date(2026, 10, 24))).size, 3);
  for (const f of FACTS) assert.doesNotMatch(f, /\$|bill|pool|budget|money|casino|health|gift/i);
});
test('sunrise and sunset for central Texas on Nov 24 are about 7:03 AM and 5:32 PM', () => {
  const s = sunTimes(new Date(2026, 10, 24, 12));
  assert.match(s.sunrise, /^7:0\d AM$/); assert.match(s.sunset, /^5:3\d PM$/);
});
test('the moon: Nov 24, 2026 is a full moon', () => { assert.equal(moonPhase(new Date(Date.UTC(2026, 10, 24, 18))).name, 'Full moon'); });
test('forecast and school cards carry only weather and the school calendar, never attendance', () => {
  assert.equal(forecastCard([{ name: 'Today', temperature: 53, shortForecast: 'Showers', isDaytime: true, probabilityOfPrecipitation: { value: 22 } }]).periods[0].rain, 22);
  assert.equal(forecastCard([]), null);
  const c = schoolCard({ ok: true, day: { school: false, why: 'Thanksgiving Break' }, back: '2026-11-30', upcoming: [{ when: 'Mon Dec 21 - Fri Jan 1', title: 'Christmas Break' }], alerts: [{ student: 'Katana', kind: 'absent' }] });
  assert.equal(c.today, 'No school today (Thanksgiving Break)');
  assert.ok(!JSON.stringify(c).includes('absent') && !JSON.stringify(c).includes('Katana'));
  assert.equal(schoolCard({ ok: true, yearOver: true }), null);
});
