// The Sunday week in review (night shift 2026-10-30, per Horace's queue): Saturday at 11 PM the last 7
// mornings (Sunday to Saturday) are read from the Morning Log (read-only GET /morning) and boiled down in
// code to check-ins, sleep, mood, energy, weight and top 3 done, compared with last Sunday's saved summary.
// Saved as data/trends/<Sunday>.md (first line "📈 Week: ...") plus .json; the Sunday briefing reads the
// first line. No agent and no model call, so it costs nothing and never talks over anyone.
// Tone (Morpheus's notes): encourage, never nag; weight is a plain fact, never a lecture.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { centralDay } from './ledger.js';

export const TRENDS_DIR = path.join(DATA_DIR, 'trends');

const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => { const v = xs.filter((n) => typeof n === 'number'); return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const short = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const weekday = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });

/** A /morning response (read on Saturday, so its 7 days are Sunday to Saturday) boiled down to the week. */
export function summarizeMorningWeek(m) {
  if (!m || m.ok === false || !Array.isArray(m.days)) throw new Error(`morning came back without days${m?.error ? `: ${m.error}` : ''}`);
  const days = m.days;
  const weights = days.filter((d) => typeof d.weight === 'number');
  const scored = days.filter((d) => typeof d.mood === 'number' || typeof d.energy === 'number');
  // The best day: highest mood + energy (ties go to the later day). Only a celebration, so only with 2+ scored days.
  const best = scored.length >= 2 ? scored.reduce((b, d) => ((d.mood || 0) + (d.energy || 0) >= (b.mood || 0) + (b.energy || 0) ? d : b)) : null;
  return {
    weekStart: days[0]?.day, weekEnd: days[days.length - 1]?.day, dayCount: days.length,
    checkIns: days.filter((d) => d.checkedIn).length, streak: m.streak ?? null,
    sleepHours: avg(days.map((d) => d.sleepHours)), sleepQuality: avg(days.map((d) => d.sleepQuality)),
    mood: avg(days.map((d) => d.mood)), energy: avg(days.map((d) => d.energy)),
    weighIns: weights.length,
    weightFirst: weights[0]?.weight ?? null, weightLast: weights.length ? weights[weights.length - 1].weight : null,
    weightChange: weights.length >= 2 ? round1(weights[weights.length - 1].weight - weights[0].weight) : null,
    topsDone: m.week?.topsDone ?? 0, topsSet: m.week?.topsSet ?? 0,
    bestDay: best ? { day: best.day, mood: best.mood ?? null, energy: best.energy ?? null } : null,
    days,
  };
}

/** "up 0.4" / "down 0.4" / "same as" against last week, or '' when either side is missing. */
function vs(now, before, unit = '') {
  if (typeof now !== 'number' || typeof before !== 'number') return '';
  const d = round1(now - before);
  return d === 0 ? ', same as last week' : `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d)}${unit} from last week`;
}

/** The briefing line (first line) and the short report under it. `prev` is last Sunday's summary, or null. */
export function formatTrends(w, prev = null) {
  const range = `${short(w.weekStart)} to ${short(w.weekEnd)}`;
  if (!w.checkIns && !w.days.some((d) => d.sleepHours != null || d.mood != null || d.energy != null || d.weight != null)) {
    return `📈 Week: nothing was logged in the Morning Log from ${range}, so there's no trend this time. A fresh week starts today.\n`;
  }
  const bits = [`${w.checkIns} of ${w.dayCount} check-ins${w.streak ? ` (streak ${w.streak})` : ''}`];
  if (w.sleepHours != null || w.sleepQuality != null) bits.push(`sleep ${[w.sleepHours != null ? `${w.sleepHours} h a night${vs(w.sleepHours, prev?.sleepHours, ' h')}` : null, w.sleepQuality != null ? `quality ${w.sleepQuality} of 5` : null].filter(Boolean).join(', ')}`);
  if (w.mood != null) bits.push(`mood ${w.mood}${vs(w.mood, prev?.mood)}`);
  if (w.energy != null) bits.push(`energy ${w.energy}${vs(w.energy, prev?.energy)}`);
  if (w.weightChange != null) bits.push(`weight ${w.weightFirst} to ${w.weightLast} lb over ${w.weighIns} weigh-ins`);
  else if (w.weighIns === 1) bits.push(`one weigh-in, ${w.weightLast} lb`);
  if (w.topsSet) bits.push(`top 3: ${w.topsDone} of ${w.topsSet} done`);
  let line = `📈 Week (${range}): ${bits.join('; ')}.`;
  if (w.bestDay) line += ` Best day: ${weekday(w.bestDay.day)}.`;
  const out = [line, '', `## Week in review, ${range}`, '', '| Day | Checked in | Sleep h | Quality | Mood | Energy | Weight |', '|---|---|---|---|---|---|---|'];
  const v = (x) => (x == null ? '' : String(x));
  for (const d of w.days) out.push(`| ${weekday(d.day).slice(0, 3)} ${short(d.day)} | ${d.checkedIn ? 'yes' : ''} | ${v(d.sleepHours)} | ${v(d.sleepQuality)} | ${v(d.mood)} | ${v(d.energy)} | ${v(d.weight)} |`);
  out.push('', prev ? `Compared with the week of ${short(prev.weekStart)} (saved last Sunday).` : 'No earlier week saved yet, so no comparison this time.');
  return out.join('\n') + '\n';
}

/**
 * The routine: Saturday 11 PM, read /morning, check its 7 days end today (Saturday), save the summary
 * for tomorrow's (Sunday's) briefing. On failure it saves a 📈 line saying so, then throws.
 */
export async function prepareWeeklyTrends({ now = new Date(), get, dir = TRENDS_DIR } = {}) {
  const today = centralDay(now), sunday = centralDay(now, 1);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sunday}.md`);
  try {
    if (!get) get = (await import('./knowledge.js')).workerGet;
    const { status, body } = await get('/morning?person=Horace');
    if (status >= 400) throw new Error(`GET /morning returned HTTP ${status}`);
    const m = JSON.parse(body);
    if (m.today !== today) throw new Error(`the worker's day is ${m.today}, not ${today}`);
    const w = summarizeMorningWeek(m);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(path.join(dir, `${centralDay(now, -6)}.json`), 'utf8')); } catch { /* first week */ }
    fs.writeFileSync(path.join(dir, `${sunday}.json`), JSON.stringify(w, null, 2));
    const text = formatTrends(w, prev);
    fs.writeFileSync(file, text);
    return { sunday, file, week: w, text };
  } catch (e) {
    fs.writeFileSync(file, `📈 Week: couldn't build the week in review this time (${e.message}).\n`);
    throw e;
  }
}
