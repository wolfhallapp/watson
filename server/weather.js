// Weather at the house (Night Shift #63, 11/23). Horace said the morning briefing's weather wasn't accurate:
// the routine searched the web for "Thrall, TX" and then called the National Weather Service at whatever town
// point it picked that morning, about 11 miles from the land. Now every Oracle weather line comes from one
// place: Wolf Hall's read-only GET /property, whose NWS forecast and alerts are for the middle of the saved
// land boundary (kept in Notion, never in the code). The Oracle never sees or stores the coordinates.
import { workerGet } from './knowledge.js';

const TZ = 'America/Chicago';
const centralDay = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
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
export function weatherLine(periods, alerts = [], now = new Date()) {
  const ps = (periods || []).filter((p) => p && Number.isFinite(Number(p.temperature)) && dayOf(p));
  if (!ps.length) return null;
  const today = centralDay(now);
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
  return `${icon(String(lead.shortForecast || ''), pop(lead))} Weather at the house (National Weather Service): ${bits.join('. ')}.`;
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
  return { line, short: weatherShort(d.weather.periods) };
}

/** Said instead when NWS (or the worker) didn't answer, so the briefing never fills the gap with a web guess. */
export const WEATHER_UNAVAILABLE = '🌤️ Weather: the National Weather Service didn\'t answer this morning; check the weather app.';
