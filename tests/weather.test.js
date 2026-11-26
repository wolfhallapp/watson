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

// Weather in a named town (self-chosen Night Shift, 11/26).
import { parsePlace, pickPlace, placeWeather } from '../server/weather.js';

test('parsePlace: "Town, ST", "Town State", two-word towns and states, no state', () => {
  assert.deepEqual(parsePlace('Hugo, OK'), { town: 'Hugo', state: 'Oklahoma' });
  assert.deepEqual(parsePlace('Hugo Oklahoma'), { town: 'Hugo', state: 'Oklahoma' });
  assert.deepEqual(parsePlace('Round Rock TX'), { town: 'Round Rock', state: 'Texas' });
  assert.deepEqual(parsePlace('Santa Fe New Mexico'), { town: 'Santa Fe', state: 'New Mexico' });
  assert.deepEqual(parsePlace('Pflugerville, Texas.'), { town: 'Pflugerville', state: 'Texas' });
  assert.deepEqual(parsePlace('Oklahoma City'), { town: 'Oklahoma City', state: null });
  assert.deepEqual(parsePlace('Texas City'), { town: 'Texas City', state: null });
  assert.deepEqual(parsePlace('  '), { town: '', state: null });
});

const GEO = [
  { name: 'Hugo', admin1: 'Minnesota', country_code: 'US', latitude: 45.16, longitude: -92.99, population: 14388 },
  { name: 'Hugo', admin1: 'Oklahoma', country_code: 'US', latitude: 34.01066, longitude: -95.50968, population: 5224 },
  { name: 'Hugoton', admin1: 'Kansas', country_code: 'US', latitude: 37.17, longitude: -101.35, population: 3964 },
];
test('pickPlace: the named state wins; with none, Oklahoma or Texas beats a bigger town elsewhere; exact names only', () => {
  assert.equal(pickPlace(GEO, { town: 'Hugo', state: 'Minnesota' }).admin1, 'Minnesota');
  assert.equal(pickPlace(GEO, { town: 'hugo', state: null }).admin1, 'Oklahoma');
  assert.equal(pickPlace(GEO, { town: 'Hugo', state: 'Kansas' }), null); // Hugoton isn't Hugo
  assert.equal(pickPlace([], { town: 'Hugo', state: null }), null);
});

function fakeFetch({ alertsFail = false, features = [] } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, ua: opts?.headers?.['User-Agent'] });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.startsWith('https://geocoding-api.open-meteo.com/')) return ok({ results: GEO });
    if (url.startsWith('https://api.weather.gov/points/')) return ok({ properties: { forecast: 'https://api.weather.gov/gridpoints/TSA/58,9/forecast', timeZone: 'America/Chicago' } });
    if (url.endsWith('/forecast')) return ok({ properties: { periods: MORNING } });
    if (url.startsWith('https://api.weather.gov/alerts/')) return alertsFail ? { ok: false, status: 503, json: async () => ({}) } : ok({ features });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

test('placeWeather: Hugo, OK gets the same NWS line, named for the town, from the town\'s own point', async () => {
  const f = fakeFetch();
  const r = await placeWeather('Hugo, OK', { fetchImpl: f, now: at('2026-11-23T12:40:00Z') });
  assert.equal(r.line, '☀️ Weather in Hugo, OK (National Weather Service): Today high 58, mostly sunny, 0% rain. Tonight low 41. Tuesday high 53, 20% rain. No alerts.');
  assert.equal(r.where, 'Hugo, OK');
  assert.match(f.calls[0].url, /name=Hugo&/);
  assert.match(f.calls[1].url, /points\/34\.0107,-95\.5097$/);
  assert.ok(f.calls.filter((c) => c.url.includes('weather.gov')).every((c) => c.ua), 'NWS calls carry a User-Agent');
  assert.ok(f.calls.every((c) => !/gmail|@/.test(c.ua || '')), 'no email address goes out');
  assert.ok(!f.calls.some((c) => c.url.includes('/property')), 'never touches the house lookup');
});

test('placeWeather: alerts are named; a failed alerts read says so instead of "No alerts"', async () => {
  const w = await placeWeather('Hugo', { fetchImpl: fakeFetch({ features: [{ properties: { event: 'Wind Advisory' } }] }), now: at('2026-11-23T12:40:00Z') });
  assert.match(w.line, /NWS alert: Wind Advisory\.$/);
  const miss = await placeWeather('Hugo', { fetchImpl: fakeFetch({ alertsFail: true }), now: at('2026-11-23T12:40:00Z') });
  assert.match(miss.line, /Tuesday high 53, 20% rain\. \(Alerts didn't load\.\)$/);
  assert.doesNotMatch(miss.line, /No alerts/);
});

test('placeWeather: an unknown town, an empty place and an NWS outage throw plain reasons', async () => {
  await assert.rejects(placeWeather('Nowhereville, TX', { fetchImpl: fakeFetch() }), /couldn't find Nowhereville, Texas/);
  await assert.rejects(placeWeather('', { fetchImpl: fakeFetch() }), /no town given/);
  const down = async (url) => (url.includes('open-meteo') ? { ok: true, status: 200, json: async () => ({ results: GEO }) } : { ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(placeWeather('Hugo, OK', { fetchImpl: down }), /api\.weather\.gov HTTP 500/);
});

test('weatherLine: the town\'s own time zone decides "today" (a Mountain town at 11:30 PM Central is still on its evening)', () => {
  const mt = [per('Tonight', '2026-11-23T18:00:00-07:00', false, 30, 'Clear', 0), per('Tuesday', '2026-11-24T06:00:00-07:00', true, 50, 'Sunny', 0)];
  const line = weatherLine(mt, [], at('2026-11-24T05:30:00Z'), { label: 'Weather in Santa Fe, NM', tz: 'America/Denver' });
  assert.match(line, /^☀️ Weather in Santa Fe, NM \(National Weather Service\): Tonight low 30, clear\. Tuesday high 50\. No alerts\.$/);
});
