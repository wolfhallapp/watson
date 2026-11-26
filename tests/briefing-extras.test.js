// The morning briefing's extra lines (Night Shift #53, 11/23): The Land, Taylor's Ram, Jake's Accountant, red pill.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { landLine, ramLine, ramDue, accountantLine, redPillLine, prepareBriefingExtras, extrasPrompt, centralDay, tripWeatherDue, tripWeatherUnavailable, TRIP_TOWN } from '../server/briefing-extras.js';
import { ROUTINES } from '../server/routines.js';
import { WEATHER_UNAVAILABLE } from '../server/weather.js';

const TODAY = '2026-11-23';
const care = (id, job, last, due) => ({ id, job, last, due, inSeason: true, dueOn: TODAY });

test('The Land: quiet when nothing is going on, and never-ticked care jobs stay out', () => {
  assert.equal(landLine({ ok: true, guard: [], care: [care('ac', 'Change the A/C filter', null, true), care('smoke', 'Test the smoke detectors', null, true)] }, TODAY), null);
  assert.equal(landLine(null, TODAY), null);
  assert.equal(landLine({ ok: false, error: 'x' }, TODAY), null);
  // A quiet fire picture (no ban, no alerts) says nothing either.
  assert.equal(landLine({ ok: true, guard: [], care: [], fire: { burnBan: false, alerts: [], level: 'ok', line: 'No burn ban in Williamson County. Drought index 391 of 800 (moderate).' } }, TODAY), null);
});

test('The Land: guard warnings, a burn ban and care jobs that came due again', () => {
  const line = landLine({ ok: true,
    guard: [{ title: '❄️ Freeze tonight' }, { title: '🔥 Red Flag Warning' }],
    fire: { burnBan: true, alerts: [{ event: 'Red Flag Warning' }], level: 'bad', line: 'Burn ban in Williamson County: no outdoor burning. Red Flag Warning now. Drought index 610 of 800 (severe).' },
    care: [care('ac', 'Change the A/C filter', '2026-10-20', true), care('dryer', 'Clean out the dryer vent', null, true), care('gut', 'Clean the gutters', '2026-05-01', false)] }, TODAY);
  assert.match(line, /^🌳 The Land: Burn ban in Williamson County: no outdoor burning\. Red Flag Warning now/);
  assert.match(line, /Freeze tonight/);
  assert.doesNotMatch(line, /🔥|Red Flag Warning\. .*Red Flag Warning/); // the guard's fire alert isn't said twice
  assert.match(line, /care due: Change the A\/C filter\.$/);
  assert.doesNotMatch(line, /dryer|gutters|Drought/);
});

const ram = (extra = {}) => ({ name: "Taylor's Truck (2012 Dodge Ram 1500)", year: 2012, make: 'Dodge', model: 'Ram 1500', vin: '1C6RD6FTXCS000000',
  mileage: 140000, health: { reasons: [] }, maintenanceHistory: [], ...extra });

test("Taylor's Ram: quiet with nothing logged (as the card) and with today's live shape", () => {
  assert.equal(ramLine([ram()], TODAY), null);
  // 11/23 live: miles on file (136,169) older than the last oil log, two oil changes, no schedule items logged.
  const live = ram({ mileage: 136169, health: { reasons: [{ level: 'bad', text: 'Registration expired 2025-12-31' }, { level: 'warn', text: 'Mileage on file is older than the last oil change' }] },
    maintenanceHistory: [{ serviceName: 'Oil Change', serviceType: 'Oil Change', date: '2026-10-26', mileage: 139450 }, { serviceName: 'Oil Change', serviceType: 'Oil Change', date: '2026-09-29', mileage: 138451 }] });
  assert.equal(ramLine([live], TODAY), null);
  assert.equal(ramLine([], TODAY), null);
  assert.equal(ramLine([{ ...ram(), year: 2015 }], TODAY), null); // not the Ram schedule
});

test("Taylor's Ram: overdue, due by time, coming up, and oil", () => {
  const v = ram({ mileage: 140000, maintenanceHistory: [
    { serviceName: 'Brake inspection', serviceType: 'Brake Inspection', date: '2026-06-01', mileage: 123000 }, // 139,000: overdue by 1,000
    { serviceName: 'Spark plugs replaced', serviceType: 'Other', date: '2024-11-01', mileage: 130000 },     // 24 months up 11/1/2026
    { serviceName: 'Engine air filter replaced', serviceType: 'Air Filter', date: '2026-01-01', mileage: 108500 }, // 140,500: 500 mi to go
    { serviceName: 'Cabin air filter', serviceType: 'Air Filter', date: '2020-01-01', mileage: 50000 },    // cabin: not the engine filter
    { serviceName: 'Oil Change', serviceType: 'Oil Change', date: '2026-05-01', mileage: 139000 },        // 6 months up 11/1
  ] });
  const due = ramDue(v, TODAY);
  assert.deepEqual(due.map((d) => [d.key, d.level]), [['oil', 'bad'], ['brakes', 'bad'], ['plugs', 'bad'], ['air', 'warn']]);
  const line = ramLine([v], TODAY);
  assert.match(line, /^🛻 Taylor's Ram: oil change due; brake and front-end check overdue by 1,000 mi; spark plugs due now\. coming up: engine air filter in 500 mi\.$/);
  // Oil from the worker's own check.
  assert.match(ramLine([ram({ health: { reasons: [{ level: 'warn', text: 'Oil change due' }] } })], TODAY), /oil change due\.$/);
  // Within 30 days by date only.
  assert.match(ramLine([ram({ mileage: null, maintenanceHistory: [{ serviceName: 'Brake check', serviceType: 'Brake Inspection', date: '2025-12-10', mileage: null }] })], TODAY), /coming up: brake and front-end check by Dec 10\./);
});

test("Jake's Accountant: says only what changed, never his chats", () => {
  const live = { ok: true, profile: { finishedAt: '2026-11-23T02:27:32Z', level: 10 }, draft: null, count: 34, earned: 0, chats: [{ q: 'SECRET QUESTION', a: 'SECRET ANSWER' }] };
  const first = accountantLine(live, undefined);
  assert.equal(first.line, "💼 Jake's Accountant: Jake finished the Initiation, his tree has 34 strategies.");
  assert.doesNotMatch(JSON.stringify(first), /SECRET/);
  const again = accountantLine(live, first.seen);
  assert.equal(again.line, null);
  const paid = accountantLine({ ...live, count: 35, earned: 42.5 }, first.seen);
  assert.equal(paid.line, "💼 Jake's Accountant: His tree has 35 strategies, $42.5 earned so far (+$42.5 since the last briefing).");
  const mid = accountantLine({ ok: true, profile: null, draft: { level: 4 }, count: 0, earned: 0 }, { level: 2, finished: false, count: 0, earned: 0 });
  assert.equal(mid.line, "💼 Jake's Accountant: Jake finished level 4 of 10 of the Initiation.");
  assert.equal(accountantLine({ ok: false }, first.seen).line, null);
});

test('red pill: count per repo and the oldest waiting', () => {
  assert.equal(redPillLine([], TODAY), null);
  const line = redPillLine([{ repo: 'wolf-hall', branch: 'oracle/night-2026-11-23-fire', date: '2026-11-23' }, { repo: 'oracle', branch: 'oracle/night-2026-10-30', date: '2026-10-30' },
    { repo: 'wolf-hall', branch: 'oracle/night-2026-11-12', date: '2026-11-12' }], TODAY);
  assert.equal(line, '🔴 Red pill: 3 night branches waiting on you (2 Wolf Hall, 1 Oracle); the oldest has waited 24 days (Oracle, Oct 30).');
  assert.match(redPillLine([{ repo: 'wolf-hall', branch: 'x', date: '2026-11-22' }], TODAY), /1 night branch waiting on you \(1 Wolf Hall\); the oldest has waited 1 day \(/);
});

test('prepareBriefingExtras: read-only GETs only, a failed source is skipped, state remembers the Accountant', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-')), statePath = path.join(dir, 'state.json'), asked = [], logs = [];
  const get = async (p) => {
    asked.push(p);
    if (p === '/property') return { status: 500, body: '{"ok":false}' };
    if (p === '/vehicles') return { status: 200, body: JSON.stringify({ ok: true, vehicles: [ram({ health: { reasons: [{ text: 'Oil change due' }] } })] }) };
    if (p === '/accountant') return { status: 200, body: JSON.stringify({ ok: true, profile: { finishedAt: 'x' }, count: 34, earned: 0 }) };
    throw new Error('unexpected ' + p);
  };
  const now = new Date('2026-11-23T12:40:00Z');
  const lines = await prepareBriefingExtras({ construct: () => null, get, branches: () => [{ repo: 'oracle', branch: 'b', date: '2026-11-20' }], statePath, now, log: (m) => logs.push(m) });
  assert.deepEqual(asked, ['/property', '/away', '/vehicles', '/accountant']);
  // #63: the weather line is always first; with /property down it says NWS didn't answer instead of leaving a gap.
  assert.equal(lines.length, 4);
  assert.equal(lines[0], WEATHER_UNAVAILABLE);
  assert.match(lines[1], /^🛻/); assert.match(lines[2], /^💼/); assert.match(lines[3], /^🔴/);
  assert.match(logs.join('\n'), /\/property skipped/);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).accountant, { level: 10, finished: true, count: 34, earned: 0, on: '2026-11-23' });
  // The next morning: the Accountant has nothing new to say.
  const next = await prepareBriefingExtras({ construct: () => null, get, branches: () => [], statePath, now: new Date('2026-11-24T12:40:00Z'), log: () => {} });
  assert.deepEqual(next.slice(1).map((l) => l.slice(0, 2)), ['🛻']);
  // Everything failing still never throws.
  assert.deepEqual(await prepareBriefingExtras({ construct: () => null, get: async () => { throw new Error('offline'); }, branches: () => { throw new Error('no git'); }, statePath, now, log: () => {} }), [WEATHER_UNAVAILABLE]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('trip town weather: due while away and on the leaving day, never when Away mode is off or done', () => {
  const away = (o) => ({ ok: true, on: true, phase: 'away', leave: '2026-11-25T12:00', back: '2026-11-29T19:00', ...o });
  assert.equal(tripWeatherDue(away(), '2026-11-26'), true);
  assert.equal(tripWeatherDue(away({ phase: 'before' }), '2026-11-25'), true); // leaving today, before noon
  assert.equal(tripWeatherDue(away({ phase: 'before' }), '2026-11-24'), false); // the day before
  assert.equal(tripWeatherDue(away({ phase: 'home' }), '2026-11-29'), false); // back home Sunday evening
  assert.equal(tripWeatherDue(away({ on: false, phase: 'off' }), '2026-11-26'), false);
  assert.equal(tripWeatherDue({ ok: false, error: 'x' }, '2026-11-26'), false);
  assert.equal(tripWeatherDue(null, '2026-11-26'), false);
  assert.equal(TRIP_TOWN, process.env.WATSON_TRIP_TOWN || 'Hugo, OK');
});

test('prepareBriefingExtras: the trip town line sits under the house line, and a miss says NWS did not answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-')), statePath = path.join(dir, 'state.json');
  const prop = { ok: true, guard: [], care: [], weather: { ok: true, alerts: [], periods: [
    { name: 'Today', startTime: '2026-11-26T06:00:00-06:00', isDaytime: true, temperature: 58, shortForecast: 'Sunny', probabilityOfPrecipitation: { value: 0 } },
    { name: 'Tonight', startTime: '2026-11-26T18:00:00-06:00', isDaytime: false, temperature: 35, shortForecast: 'Clear', probabilityOfPrecipitation: { value: 0 } }] } };
  const mk = (awayBody) => { const asked = []; return { asked, get: async (p) => {
    asked.push(p);
    if (p === '/property') return { status: 200, body: JSON.stringify(prop) };
    if (p === '/away') return { status: 200, body: JSON.stringify(awayBody) };
    throw new Error('offline');
  } }; };
  const now = new Date('2026-11-26T12:40:00Z'), towns = [];
  const place = async (town, o) => { towns.push(town); assert.equal(o.now, now); return { line: `🌤️ Weather in ${town} (National Weather Service): Today high 49, sunny.` }; };
  // Away: house line first, then the town, both before everything else; only GETs were asked.
  const a = mk({ ok: true, on: true, phase: 'away', leave: '2026-11-25T12:00' });
  const lines = await prepareBriefingExtras({ get: a.get, branches: () => [], statePath, now, log: () => {}, place });
  assert.match(lines[0], /^\S+ Weather at the house/);
  assert.equal(lines[1], `🌤️ Weather in ${TRIP_TOWN} (National Weather Service): Today high 49, sunny.`);
  assert.equal(lines.length, 2);
  assert.deepEqual(towns, [TRIP_TOWN]);
  assert.ok(a.asked.includes('/away'));
  // Away mode off: no town line and the town isn't looked up at all.
  towns.length = 0;
  const off = await prepareBriefingExtras({ get: mk({ ok: true, on: false, phase: 'off' }).get, branches: () => [], statePath, now, log: () => {}, place });
  assert.equal(off.length, 1); assert.deepEqual(towns, []);
  // Due, but NWS (or the geocoder) failed: a plain line, never a gap.
  const logs = [];
  const miss = await prepareBriefingExtras({ get: mk({ ok: true, on: true, phase: 'away' }).get, branches: () => [], statePath, now, log: (m) => logs.push(m),
    place: async () => { throw new Error('api.weather.gov HTTP 503'); } });
  assert.equal(miss[1], tripWeatherUnavailable(TRIP_TOWN));
  assert.match(logs.join('\n'), /trip weather \(api\.weather\.gov HTTP 503\)/);
  // /away itself down: just skipped, like any other extra.
  const down = await prepareBriefingExtras({ get: async (p) => { if (p === '/property') return { status: 200, body: JSON.stringify(prop) }; return { status: 500, body: '{}' }; },
    branches: () => [], statePath, now, log: () => {}, place });
  assert.equal(down.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the briefing routine adds the extras through its extra hook', () => {
  const brief = ROUTINES.find((r) => r.key === 'morningBriefing');
  assert.equal(typeof brief.extra, 'function');
  assert.equal(typeof brief.prompt, 'string');
  assert.equal(extrasPrompt([]), '');
  assert.match(extrasPrompt(['🔴 Red pill: 1 night branch']), /word for word[\s\S]*\n🔴 Red pill/);
  assert.equal(centralDay(new Date('2026-11-24T05:30:00Z')), '2026-11-23'); // 11:30 PM Central is still the 23rd
});

// Night Shift #124 (11/24): the briefing signs off with a Matrix quote and the ESV verse of the day.
test('sign-off: a Matrix quote and the same ESV verse the kitchen TV shows', async () => {
  const { signOffLines, signOffPrompt, MATRIX_QUOTES, matrixQuoteOfDay } = await import('../server/briefing-extras.js');
  const { verseOfDay } = await import('../server/tv.js');
  const day = new Date(2026, 10, 24, 6, 40);
  const [q, v] = signOffLines(day);
  assert.match(q, /^🕶️ ".+" \(.+, The Matrix( Reloaded| Revolutions)?\)$/);
  assert.equal(v, `📖 ${verseOfDay(day).ref} (ESV): ${verseOfDay(day).text}`);
  assert.ok(MATRIX_QUOTES.every(([t]) => t.length <= 90), 'quotes stay short');
  assert.deepEqual(signOffLines(new Date(2026, 10, 24, 23, 59)), signOffLines(day), 'same pair all day');
  const days = Array.from({ length: 12 }, (_, i) => matrixQuoteOfDay(new Date(2026, 10, 24 + i)).text);
  assert.equal(new Set(days).size, 12, 'a different quote each day for 12 days');
  const p = signOffPrompt(day);
  assert.match(p, /last two lines/);
  assert.ok(p.endsWith(q + '\n' + v));
  assert.ok(!/\$|pool|bill/i.test(q + v), 'nothing about money');
});

test('sign-off: the morning briefing adds it after the extras, even when there are none', async () => {
  const brief = ROUTINES.find((r) => r.key === 'morningBriefing');
  assert.match(brief.extra.toString(), /extrasPrompt\(await prepareBriefingExtras\(\)\), signOffPrompt\(\)\]\.filter\(Boolean\)/);
  const { signOffPrompt } = await import('../server/briefing-extras.js');
  assert.equal([extrasPrompt([]), signOffPrompt()].filter(Boolean).join('\n\n'), signOffPrompt());
});

test('the Oracle calls Horace Neo', async () => {
  const src = fs.readFileSync(new URL('../server/agent.js', import.meta.url), 'utf8');
  assert.match(src, /His handle is Neo[^\n]*call him Neo/);
});
