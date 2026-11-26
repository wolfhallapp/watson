// Weather at the house (Night Shift #63, 11/23): one NWS source for the briefing, the ticker and the weather tool.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherLine, weatherShort, houseWeather, WEATHER_UNAVAILABLE } from '../server/weather.js';
import { prepareBriefingExtras } from '../server/briefing-extras.js';
import { ROUTINES } from '../server/routines.js';

const per = (name, start, isDaytime, temperature, shortForecast, pop = 0) =>
  ({ name, startTime: start, isDaytime, temperature, shortForecast, probabilityOfPrecipitation: { value: pop } });
// The real 11/23 forecast shape (times carry the Central offset).
const MORNING = [
  per('Today', '2026-11-23T06:00:00-06:00', true, 58, 'Mostly Sunny', 0),
  per('Tonight', '2026-11-23T18:00:00-06:00', false, 41, 'Partly Cloudy', 2),
  per('Tuesday', '2026-11-24T06:00:00-06:00', true, 53, 'Slight Chance Rain Showers then Partly Sunny', 20),
  per('Tuesday Night', '2026-11-24T18:00:00-06:00', false, 34, 'Partly Cloudy', 16),
];
const at = (iso) => new Date(iso);

test('a 6:40 AM read: today\'s high, tonight\'s low, tomorrow, no alerts', () => {
  const line = weatherLine(MORNING, [], at('2026-11-23T12:40:00Z'));
  assert.equal(line, '☀️ Weather at the house (National Weather Service): Today high 58, mostly sunny, 0% rain. Tonight low 41. Tuesday high 53, 20% rain. No alerts.');
});

test('a 4 AM read (Tuesday briefing): the first period is the overnight low, but the line still leads with today\'s high', () => {
  const early = [per('Overnight', '2026-11-24T03:00:00-06:00', false, 36, 'Partly Cloudy', 5), ...MORNING.slice(2)];
  const line = weatherLine(early, [], at('2026-11-24T09:15:00Z')); // 3:15 AM Central
  assert.match(line, /Today high 53, slight chance rain showers then partly sunny, 20% rain\. Tonight low 34\./);
  assert.doesNotMatch(line, /36/);
});

test('an evening read: tonight\'s low first, then tomorrow; never "Today high" from a night period', () => {
  const line = weatherLine(MORNING.slice(1), [], at('2026-11-24T01:00:00Z')); // 7 PM Central on the 23rd
  assert.match(line, /: Tonight low 41, partly cloudy\. Tuesday high 53, 20% rain\. No alerts\.$/);
  assert.doesNotMatch(line, /Today/);
});

test('the day is Central, not UTC: 7 PM on the 23rd is still the 23rd', () => {
  // At 01:00Z on the 24th a UTC date would think "today" is Tuesday and call Tuesday's high "Today".
  assert.doesNotMatch(weatherLine(MORNING.slice(1), [], at('2026-11-24T01:00:00Z')), /Today high 53/);
});

test('alerts are named once each; storms get the storm icon', () => {
  const wet = [per('Today', '2026-11-15T06:00:00-06:00', true, 52, 'Showers And Thunderstorms', 97), per('Tonight', '2026-11-15T18:00:00-06:00', false, 45, 'Showers And Thunderstorms Likely', 70)];
  const line = weatherLine(wet, [{ event: 'Flood Watch' }, { event: 'Flood Watch' }, { event: 'Wind Advisory' }], at('2026-11-15T12:40:00Z'));
  assert.match(line, /^⛈️ /);
  assert.match(line, /Tonight low 45, 70% rain\. NWS alert: Flood Watch, Wind Advisory\.$/);
});

test('missing rain chance reads as 0%; no periods means no line', () => {
  const p = [{ ...MORNING[0], probabilityOfPrecipitation: { value: null } }];
  assert.match(weatherLine(p, [], at('2026-11-23T12:40:00Z')), /Today high 58, mostly sunny, 0% rain\. No alerts\.$/);
  assert.equal(weatherLine([], [], new Date()), null);
  assert.equal(weatherLine(null, [], new Date()), null);
});

test('the ticker keeps the named current period', () => {
  assert.equal(weatherShort(MORNING), 'Today: 58°, Mostly Sunny');
  assert.equal(weatherShort([MORNING[2]]), 'Tuesday: 53°, Slight Chance Rain Showers then Partly Sunny, 20% rain');
  assert.equal(weatherShort([]), null);
});

const propGet = (body, status = 200) => async (p) => { assert.equal(p, '/property'); return { status, body: JSON.stringify(body) }; };

test('houseWeather reads only GET /property and fails loudly when NWS didn\'t answer', async () => {
  const w = await houseWeather({ get: propGet({ ok: true, weather: { ok: true, periods: MORNING, alerts: [] } }), now: at('2026-11-23T12:40:00Z') });
  assert.match(w.line, /Today high 58/);
  assert.equal(w.short, 'Today: 58°, Mostly Sunny');
  await assert.rejects(houseWeather({ get: propGet({ ok: true, weather: { ok: false, error: 'timeout', periods: [] } }) }), /timeout/);
  await assert.rejects(houseWeather({ get: propGet({}, 500) }), /HTTP 500/);
});

test('the briefing extras always carry the weather line, or say plainly that NWS didn\'t answer', async () => {
  const opts = { branches: () => [], statePath: '/nonexistent/x.json', now: at('2026-11-23T12:40:00Z'), log: () => {} };
  const ok = await prepareBriefingExtras({ construct: () => null, ...opts, get: async (p) => ({ status: 200, body: JSON.stringify(p === '/property' ? { ok: true, guard: [], care: [], weather: { ok: true, periods: MORNING, alerts: [] } } : {}) }) });
  assert.equal(ok.filter((l) => /Weather at the house/.test(l)).length, 1);
  const down = await prepareBriefingExtras({ construct: () => null, ...opts, get: async () => ({ status: 502, body: '' }) });
  assert.ok(down.includes(WEATHER_UNAVAILABLE));
});

test('the briefing routine no longer asks for a web search for Thrall weather', () => {
  const r = ROUTINES.find((x) => x.key === 'morningBriefing');
  assert.doesNotMatch(r.prompt, /weather for Thrall/);
  assert.match(r.prompt, /never search the web/);
});
