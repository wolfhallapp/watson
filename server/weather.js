// Weather at the house (Night Shift #63, 11/23). Horace said the morning briefing's weather wasn't accurate:
// the routine searched the web for "Thrall, TX" and then called the National Weather Service at whatever town
// point it picked that morning, about 11 miles from the land. Now every Oracle weather line comes from one
// place: Wolf Hall's read-only GET /property, whose NWS forecast and alerts are for the middle of the saved
// land boundary (kept in Notion, never in the code). The Oracle never sees or stores the coordinates.
import { workerGet } from './knowledge.js';

const TZ = 'America/Chicago';
const localDay = (d, tz = TZ) => d.toLocaleDateString('en-CA', { timeZone: tz });
// NWS period times carry their own Central offset ("2026-11-23T18:00:00-06:00"), so the first 10 characters are the local day.
const dayOf = (p) => String(p?.startTime || '').slice(0, 10);
const pop = (p) => { const v = p?.probabilityOfPrecipitation?.value; return Number.isFinite(Number(v)) && v !== null ? Number(v) : 0; };
const lc = (s) => String(s || '').trim().toLowerCase(); // NWS writes Title Case
const rain = (p) => `${pop(p)}% rain`;
function icon(text, wet) {
  if (/thunder|storm/i.test(text)) return '⛈️';
  if (/snow|sleet|freezing|ice/i.test(text)) return '🌨️';
  if (wet >= 50 || (/rain|showers|drizzle/i.test(text) && wet >= 30)) return '🌧️';
  if (/fog/i.test(text)) return '🌫️';
  if (/^(sunny|clear|mostly sunny|mostly clear)$/i.test(text.trim())) return '☀️';
  return '🌤️';
}

/**
 * One plain briefing line from NWS periods + alerts, or null when there's no forecast.
 * Today's HIGH is always the daytime period that starts today and its LOW the night after it, so a 4 AM read
 * (first period "Overnight") or a 7 PM read (first period "Tonight") never passes a low off as the day's weather.
 */
export function weatherLine(periods, alerts = [], now = new Date(), { label = 'Weather at the house', tz = TZ } = {}) {
  const ps = (periods || []).filter((p) => p && Number.isFinite(Number(p.temperature)) && dayOf(p));
  if (!ps.length) return null;
  const today = localDay(now, tz);
  const dayIdx = ps.findIndex((p) => p.isDaytime && dayOf(p) === today);
  const bits = [];
  let lead, nextDay;
  if (dayIdx >= 0) {
    const d = ps[dayIdx], night = ps.slice(dayIdx + 1).find((p) => !p.isDaytime);
    lead = d;
    bits.push(`Today high ${d.temperature}, ${lc(d.shortForecast)}, ${rain(d)}`);
    if (night) bits.push(`Tonight low ${night.temperature}${pop(night) >= 20 ? `, ${rain(night)}` : ''}`);
    nextDay = ps.slice(dayIdx + 1).find((p) => p.isDaytime);
  } else {
    // Evening (or a forecast that starts tonight): tonight's low, then tomorrow.
    const night = ps.find((p) => !p.isDaytime);
    lead = night || ps[0];
    if (night) bits.push(`Tonight low ${night.temperature}, ${lc(night.shortForecast)}${pop(night) >= 20 ? `, ${rain(night)}` : ''}`);
    nextDay = ps.find((p) => p.isDaytime);
  }
  if (nextDay) bits.push(`${nextDay.name} high ${nextDay.temperature}${pop(nextDay) >= 20 ? `, ${rain(nextDay)}` : ''}`);
  const events = [...new Set((alerts || []).map((a) => String(a?.event || '').trim()).filter(Boolean))];
  bits.push(events.length ? `NWS alert: ${events.join(', ')}` : 'No alerts');
  return `${icon(String(lead.shortForecast || ''), pop(lead))} ${label} (National Weather Service): ${bits.join('. ')}.`;
}

/** The short ticker form: the current period, named, as before ("Tonight: 41°, Partly Cloudy, 20% rain"). */
export function weatherShort(periods) {
  const p = (periods || [])[0];
  if (!p || !Number.isFinite(Number(p.temperature))) return null;
  return `${p.name}: ${p.temperature}°, ${p.shortForecast}${pop(p) ? `, ${pop(p)}% rain` : ''}`;
}

/** GET /property -> { line, short }; throws when the worker or the weather service didn't answer. */
export async function houseWeather({ get = workerGet, now = new Date() } = {}) {
  const r = await get('/property');
  if (r.status !== 200) throw new Error(`/property HTTP ${r.status}`);
  const d = JSON.parse(r.body);
  if (!d.ok || !d.weather?.ok) throw new Error(d.weather?.error || d.error || 'no forecast');
  const line = weatherLine(d.weather.periods, d.weather.alerts, now);
  if (!line) throw new Error('no forecast periods');
  return { line, short: weatherShort(d.weather.periods), periods: d.weather.periods || [], alerts: d.weather.alerts || [] };
}

/** Said instead when NWS (or the worker) didn't answer, so the briefing never fills the gap with a web guess. */
export const WEATHER_UNAVAILABLE = '🌤️ Weather: the National Weather Service didn\'t answer this morning; check the weather app.';

// Weather in a named town (self-chosen Night Shift, 11/26): the Oklahoma trip, Sunday's drive home, church in
// Pflugerville, the Tuesday office. Same NWS forecast and the same line as the house; only public town points.
// The town's point comes from Open-Meteo's free geocoder (no key); the house is never looked up this way.
const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const HOME_STATES = ['Texas', 'Oklahoma']; // with no state given, a Texas or Oklahoma town wins (home and Taylor's folks)
const NWS_HEADERS = { 'User-Agent': '(the-oracle home assistant)', Accept: 'application/geo+json' };

/** "Hugo, OK" / "Hugo Oklahoma" / "hugo" -> { town, state|null } (state is the full name). */
export function parsePlace(place) {
  const s = String(place || '').trim().replace(/\s+/g, ' ');
  if (!s) return { town: '', state: null };
  const lower = s.toLowerCase().replace(/[,.]+$/, '');
  // The state is the last word (an abbreviation) or the end of the text (a full name, "New Mexico" included).
  for (const [ab, full] of Object.entries(STATES)) {
    for (const tail of [ab.toLowerCase(), full.toLowerCase()]) {
      if (lower.length > tail.length + 1 && lower.endsWith(tail) && /[,\s]/.test(lower[lower.length - tail.length - 1])) {
        const town = s.slice(0, lower.length - tail.length).replace(/[,\s]+$/, '').trim();
        if (town) return { town, state: full };
      }
    }
  }
  return { town: s.replace(/,$/, ''), state: null };
}

/** Picks the geocoder result: exact town name, in the state if one was given, else Texas/Oklahoma first, then the biggest. */
export function pickPlace(results, { town, state }) {
  const same = (results || []).filter((r) => r && r.country_code === 'US' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
    && String(r.name || '').toLowerCase() === town.toLowerCase());
  const pool = state ? same.filter((r) => r.admin1 === state) : same;
  if (!pool.length) return null;
  const rank = (r) => (state ? 0 : (HOME_STATES.indexOf(r.admin1) + 1 || 9));
  return [...pool].sort((a, b) => rank(a) - rank(b) || (b.population || 0) - (a.population || 0))[0];
}

async function getJson(fetchImpl, url, headers) {
  const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  return r.json();
}

/** Weather in a named US town -> { line, short, where }; throws with a plain reason when it can't. */
export async function placeWeather(place, { fetchImpl = fetch, now = new Date() } = {}) {
  const want = parsePlace(place);
  if (!want.town) throw new Error('no town given');
  const q = new URLSearchParams({ name: want.town, count: '20', language: 'en', format: 'json', countryCode: 'US' });
  const geo = await getJson(fetchImpl, `https://geocoding-api.open-meteo.com/v1/search?${q}`);
  const hit = pickPlace(geo.results, want);
  if (!hit) throw new Error(`couldn't find ${want.town}${want.state ? `, ${want.state}` : ''}`);
  const pt = await getJson(fetchImpl, `https://api.weather.gov/points/${hit.latitude.toFixed(4)},${hit.longitude.toFixed(4)}`, NWS_HEADERS);
  const props = pt.properties || {};
  if (!props.forecast) throw new Error('no NWS forecast for that spot');
  const [fc, al] = await Promise.all([
    getJson(fetchImpl, props.forecast, NWS_HEADERS),
    getJson(fetchImpl, `https://api.weather.gov/alerts/active?point=${hit.latitude.toFixed(4)},${hit.longitude.toFixed(4)}`, NWS_HEADERS)
      .catch(() => null), // alerts are extra; a miss says so below instead of claiming "No alerts"
  ]);
  const periods = fc.properties?.periods || [];
  const abbr = Object.keys(STATES).find((k) => STATES[k] === hit.admin1) || hit.admin1;
  const where = `${hit.name}, ${abbr}`;
  let line = weatherLine(periods, (al?.features || []).map((f) => f.properties || {}), now,
    { label: `Weather in ${where}`, tz: props.timeZone || TZ });
  if (!line) throw new Error('no forecast periods');
  if (!al) line = line.replace(/ No alerts\.$/, ' (Alerts didn\'t load.)');
  return { line, short: weatherShort(periods), where };
}
