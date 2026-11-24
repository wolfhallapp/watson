// Morning briefing extras (Night Shift queue #53, 11/23): short lines worked out in code before the 6:40
// briefing routine runs, each only when there's something to say. All reads are read-only worker GETs
// (/property, /vehicles, /accountant) plus the local git branches; nothing is written anywhere except the
// small data/briefing-extras.json that remembers what the Accountant line last said.
//  - 🌤️ Weather at the house (#63): today's high and tonight's low from the NWS forecast in /property (server/weather.js).
//  - 🌳 The Land: weather guard warnings, the fire picture (burn ban / red flag, once Wolf Hall v304 ships),
//    and care jobs that came due again (jobs never ticked are left out, or the line would say the same 10 every day).
//  - 🛻 Taylor's Ram: the v293 owner's-manual schedule (logged items overdue or within 1,000 mi / 30 days) and an oil change due.
//  - 💼 Jake's Accountant: Horace's view only, and only what changed: Initiation levels, tree size, payouts. Never his chats.
//  - 🔴 Red pill: night branches still waiting to be merged in both repos, and the oldest one.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA_DIR, ROOT, config } from './config.js';
import { workerGet } from './knowledge.js';
import { weatherLine, WEATHER_UNAVAILABLE } from './weather.js';
import { verseOfDay } from './tv.js';

export const EXTRAS_STATE = path.join(DATA_DIR, 'briefing-extras.json');
const TZ = 'America/Chicago';
export const centralDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const shortDay = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const n = (x) => Number(x).toLocaleString('en-US');
const money = (x) => '$' + (Math.round(Number(x) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const list = (items, max = 2) => items.slice(0, max).join('; ') + (items.length > max ? `; +${items.length - max} more` : '');

// ── The Land ──
/** GET /property -> one line, or null. today = 'YYYY-MM-DD' Central. */
export function landLine(prop, today) {
  if (!prop || prop.ok === false) return null;
  const bits = [];
  const fire = prop.fire; // v304: { burnBan, alerts, level, line }; absent until that ships
  const fireOn = !!fire && (fire.burnBan === true || (fire.alerts || []).length > 0 || fire.level === 'bad');
  if (fireOn) bits.push(String(fire.line || '').replace(/\s*Drought index[^.]*\.\s*/i, ' ').trim().replace(/\.$/, ''));
  // The guard's own warnings (alerts, freeze, heat, wind, storms). Its 🔥 fire alerts are already in the fire line.
  const guard = (prop.guard || []).filter((g) => !(fireOn && /^🔥/.test(g.title || '')));
  for (const g of guard) bits.push(String(g.title || '').replace(/^\S+\s+/, '').trim());
  // Care jobs done before that came due again (never-ticked jobs would repeat every morning).
  const care = (prop.care || []).filter((c) => c.due && c.last).map((c) => c.job);
  if (care.length) bits.push(`care due: ${list(care)}`);
  if (!bits.filter(Boolean).length) return null;
  return '🌳 The Land: ' + bits.filter(Boolean).join('. ') + '.';
}

// ── Taylor's Ram (the v293 schedule; same rules as ramServiceRows in the app's index.html) ──
export const RAM_SCHEDULE = [
  { key: 'brakes', label: 'brake and front-end check', type: 'Brake Inspection', miles: 16000, months: 12, match: /brake|suspension|tie rod/i },
  { key: 'axle', label: 'rear axle and exhaust check', type: 'Other', miles: 24000, months: 18, match: /\baxle|differential|exhaust/i },
  { key: 'plugs', label: 'spark plugs', type: 'Other', miles: 32000, months: 24, match: /spark ?plug/i },
  { key: 'air', label: 'engine air filter', type: 'Air Filter', miles: 32000, months: 24, match: /^(?!.*cabin).*\bair (cleaner|filter)/i },
  { key: 'pcv', label: 'PCV valve', type: 'Other', miles: 96000, months: 72, match: /\bpcv\b/i },
  { key: 'coolant', label: 'coolant flush', type: 'Other', miles: 104000, months: 60, match: /coolant|antifreeze/i },
  { key: 'trans', label: 'transmission fluid and filter', type: 'Other', miles: 120000, months: 90, match: /trans(mission)?\b.*(fluid|filter|service|flush)|\batf\b/i },
];
const ramEngine = (v) => String(v?.vin || '').toUpperCase().charAt(7);
export function isRam(v) { return !!v && Number(v.year) === 2012 && /\bram\b/i.test([v.make, v.model, v.name].join(' ')) && ramEngine(v) !== 'P'; }
function lastDone(item, hist) {
  return (hist || []).filter((m) => { const nm = m.serviceName || ''; return item.match.test(nm) || (item.type !== 'Other' && m.serviceType === item.type && !(item.key === 'air' && /cabin/i.test(nm))); })
    .sort((a, b) => (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : (a.mileage || 0) - (b.mileage || 0)).pop() || null;
}
/** Logged services that are due (bad) or close (warn). Never-logged items stay quiet, as on the card. */
export function ramDue(v, today) {
  const hist = v.maintenanceHistory || [];
  const maxLog = Math.max(0, ...hist.map((m) => m.mileage || 0));
  const mi = v.mileage != null && v.mileage < maxLog ? null : v.mileage; // stale miles: don't count down from them
  const out = [];
  for (const it of RAM_SCHEDULE) {
    const last = lastDone(it, hist);
    if (!last || (last.mileage == null && !last.date)) continue;
    const dueMi = last.mileage != null ? last.mileage + it.miles : null, dueDate = last.date ? addMonths(String(last.date).slice(0, 10), it.months) : null;
    const left = dueMi != null && mi != null ? dueMi - mi : null, timeUp = !!dueDate && dueDate <= today;
    if ((left != null && left <= 0) || timeUp) out.push({ key: it.key, level: 'bad', text: `${it.label} ${left != null && left < 0 ? `overdue by ${n(-left)} mi` : 'due now'}` });
    else if ((left != null && left <= 1000) || (dueDate && dueDate <= addDays(today, 30))) {
      out.push({ key: it.key, level: 'warn', text: `${it.label} ${left != null && left <= 1000 ? `in ${n(left)} mi` : `by ${shortDay(dueDate)}`}` });
    }
  }
  // Oil: the worker's own check (miles past the next oil mileage), or 6 months since the last logged change (manual p. 681).
  const oil = hist.filter((m) => m.serviceType === 'Oil Change' || /\boil change\b/i.test(m.serviceName || '')).sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).pop();
  const oilByTime = !!oil?.date && addMonths(String(oil.date).slice(0, 10), 6) <= today;
  if ((v.health?.reasons || []).some((r) => /^Oil change due/.test(r.text)) || oilByTime) out.unshift({ key: 'oil', level: 'bad', text: 'oil change due' });
  return out;
}
export function ramLine(vehicles, today) {
  const v = (vehicles || []).find(isRam);
  if (!v) return null;
  const due = ramDue(v, today);
  if (!due.length) return null;
  const bad = due.filter((d) => d.level === 'bad').map((d) => d.text), soon = due.filter((d) => d.level === 'warn').map((d) => d.text);
  return "🛻 Taylor's Ram: " + [bad.length ? list(bad, 3) : '', soon.length ? 'coming up: ' + list(soon, 2) : ''].filter(Boolean).join('. ') + '.';
}

// ── Jake's Accountant (Horace's view: levels, tree size, payouts; never chats) ──
/** GET /accountant + what the last briefing saw -> { line, seen }. Says something only when it changed. */
export function accountantLine(acct, prev) {
  if (!acct || acct.ok === false) return { line: null, seen: prev || null };
  const finished = !!acct.profile?.finishedAt;
  const seen = { level: finished ? 10 : Number(acct.draft?.level) || 0, finished, count: Number(acct.count) || 0,
    earned: Math.round((Number(acct.earned) || 0) * 100) / 100 };
  const p = prev || { level: 0, finished: false, count: 0, earned: 0 };
  const bits = [];
  if (finished && !p.finished) bits.push('Jake finished the Initiation');
  else if (!finished && seen.level > p.level) bits.push(`Jake finished level ${seen.level} of 10 of the Initiation`);
  if (seen.count !== p.count && seen.count > 0) bits.push(`his tree has ${seen.count} strateg${seen.count === 1 ? 'y' : 'ies'}`);
  if (seen.earned > p.earned) bits.push(`${money(seen.earned)} earned so far (+${money(seen.earned - p.earned)} since the last briefing)`);
  if (!bits.length) return { line: null, seen };
  const s = bits.join(', ');
  return { line: "💼 Jake's Accountant: " + s.charAt(0).toUpperCase() + s.slice(1) + '.', seen };
}

// ── Red pill: night branches waiting ──
/** [{ repo, branch, date }] -> one line, or null. */
export function redPillLine(branches, today) {
  if (!branches?.length) return null;
  const by = (r) => branches.filter((b) => b.repo === r).length;
  const oldest = [...branches].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const days = Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(oldest.date + 'T12:00:00Z')) / 86400000));
  const parts = [by('wolf-hall') && `${by('wolf-hall')} Wolf Hall`, by('oracle') && `${by('oracle')} Oracle`].filter(Boolean).join(', ');
  return `🔴 Red pill: ${branches.length} night branch${branches.length === 1 ? '' : 'es'} waiting on you (${parts}); the oldest has waited ${days} day${days === 1 ? '' : 's'} (${oldest.repo === 'oracle' ? 'Oracle' : 'Wolf Hall'}, ${shortDay(oldest.date)}).`;
}
export function waitingBranches(repos = [{ repo: 'wolf-hall', dir: config.projectDir }, { repo: 'oracle', dir: ROOT }]) {
  const out = [];
  for (const { repo, dir } of repos) {
    let txt = '';
    try { txt = execFileSync('git', ['-C', dir, 'for-each-ref', '--no-merged', 'main', '--format=%(refname:short)%09%(committerdate:short)', 'refs/heads/oracle/'], { encoding: 'utf8', timeout: 30000 }); } catch { continue; }
    for (const l of txt.split('\n').filter(Boolean)) { const [branch, date] = l.split('\t'); out.push({ repo, branch, date }); }
  }
  return out;
}

// ── Gather (never throws: a source that fails is just left out, and logged) ──
async function getJson(get, p) {
  const r = await get(p);
  if (r.status !== 200) throw new Error(`${p} answered ${r.status}`);
  return JSON.parse(r.body);
}
export async function prepareBriefingExtras({ get = workerGet, branches = waitingBranches, statePath = EXTRAS_STATE, now = new Date(), log = console.log } = {}) {
  const today = centralDay(now), lines = [];
  let st = {}; try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { st = {}; }
  const tryIt = async (name, fn) => { try { const l = await fn(); if (l) lines.push(l); } catch (e) { log(`  Briefing extras: ${name} skipped (${e.message})`); } };
  // One /property read for both lines. #63 (11/23): the weather line is always there, from the NWS forecast for the
  // house (the land's own point), and says so plainly when NWS didn't answer instead of leaving a gap to fill.
  let prop = null;
  try { prop = await getJson(get, '/property'); } catch (e) { log(`  Briefing extras: /property skipped (${e.message})`); }
  lines.push((prop?.ok && prop.weather?.ok && weatherLine(prop.weather.periods, prop.weather.alerts, now)) || WEATHER_UNAVAILABLE);
  await tryIt('land', async () => landLine(prop, today));
  await tryIt('ram', async () => ramLine((await getJson(get, '/vehicles')).vehicles, today));
  await tryIt('accountant', async () => {
    const { line, seen } = accountantLine(await getJson(get, '/accountant'), st.accountant);
    if (seen) { st.accountant = { ...seen, on: today }; try { fs.writeFileSync(statePath, JSON.stringify(st, null, 2)); } catch (e) { log(`  Briefing extras: state not saved (${e.message})`); } }
    return line;
  });
  await tryIt('red pill', async () => redPillLine(branches(), today));
  return lines;
}
/** The text added to the briefing prompt, or '' when there's nothing to say. */
export function extrasPrompt(lines) {
  if (!lines?.length) return '';
  return 'Also add these lines, already checked in code (keep each one as is, word for word; put them after the more urgent lines):\n' + lines.join('\n');
}

// 11/24 (Night Shift #124, Horace rounds 18-19): the briefing signs off with a short Matrix quote and an ESV verse.
// The verse is the same one the kitchen TV shows that day (tv.js); the quote rotates on its own count, so the pairs vary.
export const MATRIX_QUOTES = [
  ['There is no spoon.', 'Spoon Boy, The Matrix'],
  ['Free your mind.', 'Morpheus, The Matrix'],
  ['Welcome to the real world.', 'Morpheus, The Matrix'],
  ['I can only show you the door. You\'re the one that has to walk through it.', 'Morpheus, The Matrix'],
  ['There\'s a difference between knowing the path and walking the path.', 'Morpheus, The Matrix'],
  ['I know kung fu.', 'Neo, The Matrix'],
  ['He\'s beginning to believe.', 'Morpheus, The Matrix'],
  ['Know thyself.', 'The Oracle, The Matrix'],
  ['Everything that has a beginning has an end.', 'The Oracle, The Matrix Revolutions'],
  ['We can never see past the choices we don\'t understand.', 'The Oracle, The Matrix Reloaded'],
  ['Choice. The problem is choice.', 'Neo, The Matrix Reloaded'],
  ['Some things in this world never change. But some things do.', 'Morpheus, The Matrix Reloaded'],
];
export function matrixQuoteOfDay(now = new Date()) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  const [text, who] = MATRIX_QUOTES[day % MATRIX_QUOTES.length];
  return { text, who };
}
/** The two sign-off lines: a Matrix quote, then the ESV verse of the day. */
export function signOffLines(now = new Date()) {
  const q = matrixQuoteOfDay(now), v = verseOfDay(now);
  return [`🕶️ "${q.text}" (${q.who})`, `📖 ${v.ref} (ESV): ${v.text}`];
}
/** The prompt text that makes those two lines the briefing's last lines. */
export function signOffPrompt(now = new Date()) {
  return 'End the briefing with these two sign-off lines, word for word, as its last two lines (they do not count toward the 5 to 10):\n' + signOffLines(now).join('\n');
}
