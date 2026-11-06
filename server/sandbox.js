// The Budget Construct (2026-11-05, per Horace): a what-if sandbox of the household budget on its own
// page (public/budget.html). It reads the live plan from the worker's read-only GET /spend-today and
// keeps Horace's tweaks in data/budget-sandbox.json. Nothing here writes to Notion or the worker.
// When he changes something, the Oracle gets a note with her next message saying what changed, so he
// can "go look, come tell her" and she already knows.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { workerGet } from './knowledge.js';

export const FILE = path.join(DATA_DIR, 'budget-sandbox.json');
// A copy of the worker's SPEND_PHASES (cloudflare-worker.js, v227: Fast Food $25 split out, Fun Money $6). The worker doesn't return them;
// update this when the weekly targets change there.
export const PHASES = [
  { from: '0000-01-01', name: 'Phase 1', targets: { Groceries: 140, Cigs: 55, C4: 50, Tithing: 40, FunMoney: 6, FastFood: 25, Gambling: 20 } },
  { from: '2026-12-04', name: 'Phase 2', targets: { Groceries: 150, Cigs: 55, C4: 60, Tithing: 40, FunMoney: 50, Gambling: 20 } },
];

const blank = () => ({ tweaks: {}, summary: null, updated: null, seen: {}, snapshots: {} });
export function load(file = FILE) {
  try { return { ...blank(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return blank(); }
}
function save(s, file = FILE) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, file);
}

let cache = null; // { at, data }
/** The live plan (read-only), cached for 3 minutes unless `fresh`. */
export async function liveData({ fresh = false, get = workerGet } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 180000) return cache.data;
  const r = await get('/spend-today');
  let d; try { d = JSON.parse(r.body); } catch { throw new Error('The worker sent something that is not JSON'); }
  if (r.status !== 200 || !d.ok) throw new Error(d.error || `worker answered ${r.status}`);
  const data = { ...d, phases: PHASES, fetchedAt: new Date().toISOString() };
  cache = { at: Date.now(), data };
  return data;
}

// ── Plain-words diff of two tweak sets ──
const NAMES = { pool: 'Starting Pool', cushion: 'Cushion', horizon: 'Plan runs to', taylorPay: "Taylor's paycheck", horaceAdj: "Horace's zelle adjustment" };
const money = (v) => (v == null || v === '' ? 'live value' : typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(v) ? (+v < 0 ? '-$' : '$') + Math.abs(+v).toLocaleString('en-US') : String(v));
function flat(obj, pre = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, pre + k + '.', out);
    else if (Array.isArray(v)) v.forEach((x, i) => flat(x, `${pre}${k}.${x?.id ?? i}.`, out));
    else out[pre + k] = v;
  }
  return out;
}
function label(key) {
  const [head, name, field] = key.split('.');
  if (NAMES[head]) return NAMES[head];
  if (head === 'weekly') return `Weekly ${name}${field === 'later' ? ' (from Dec 4)' : field === 'now' ? '' : ' ' + field}`;
  if (head === 'bills') return `Bill "${name}" ${field === 'off' ? 'turned off' : field}`;
  if (head === 'goals') return `Goal "${name}" ${field === 'off' ? 'turned off' : field}`;
  if (head === 'off') return `Skipped ${name}`;
  return key;
}
export function describeChanges(before = {}, after = {}) {
  const a = flat(before), b = flat(after);
  const lines = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k]) || k.includes('__probe')) continue;
    if (k.startsWith('extras.')) continue;
    const isFlag = typeof a[k] === 'boolean' || typeof b[k] === 'boolean';
    const shown = (v) => (isFlag ? (v ? 'yes' : 'no') : /shift$/.test(k) ? `${v ?? 0} days` : /date$|^horizon$/.test(k) ? (v || 'live value') : money(v));
    lines.push(`${label(k)}: ${shown(a[k])} → ${shown(b[k])}`);
  }
  const xa = new Map((before.extras || []).map((x) => [x.id, x])), xb = new Map((after.extras || []).map((x) => [x.id, x]));
  const desc = (x) => `"${x.label || 'What-if'}" ${money(x.amount)} ${x.repeat && x.repeat !== 'once' ? x.repeat + ' from' : 'on'} ${x.date}`;
  for (const [id, x] of xb) if (!xa.has(id)) lines.push(`Added what-if item ${desc(x)}`); else if (JSON.stringify(xa.get(id)) !== JSON.stringify(x)) lines.push(`Changed what-if item to ${desc(x)}`);
  for (const [id, x] of xa) if (!xb.has(id)) lines.push(`Removed what-if item ${desc(x)}`);
  return lines;
}

const clean = (t) => JSON.parse(JSON.stringify(t || {}, (k, v) => (k === '__probe' ? undefined : v)));
/** Save the page's current scenario. `summary` is the page's own computed result, for the Oracle's note. */
export function saveScenario({ tweaks, summary }, file = FILE) {
  const s = load(file);
  s.tweaks = clean(tweaks); s.summary = summary && typeof summary === 'object' ? summary : null; s.updated = new Date().toISOString();
  save(s, file);
  return { ok: true, updated: s.updated };
}
export function snapshot(action, name, file = FILE) {
  const s = load(file);
  name = String(name || '').trim().slice(0, 60);
  if (action === 'save' && name) s.snapshots[name] = { tweaks: s.tweaks, summary: s.summary, at: new Date().toISOString() };
  if (action === 'delete') delete s.snapshots[name];
  save(s, file);
  return s.snapshots;
}

/** For the Oracle: what Horace changed in the sandbox since her last turn, or ''. Marks it seen. */
export function takeSandboxNote(file = FILE) {
  let s;
  try { s = load(file); } catch { return ''; }
  const lines = describeChanges(s.seen, s.tweaks);
  if (!lines.length) return '';
  s.seen = s.tweaks;
  try { save(s, file); } catch { /* the note still goes out */ }
  const m = s.summary || {};
  const res = m.low ? `\nWith those changes: lowest Pool $${m.low.v} on ${m.low.date} (live plan: $${m.baseLow?.v} on ${m.baseLow?.date}), safe to spend $${m.safeDaily}/day, weekly plan $${m.weeklyNowTotal}, ${m.under} day(s) under the $${m.cushion} cushion, Pool $${m.endPool} on ${m.end}.` : '';
  return `[Budget Construct note, not from Horace: since your last turn he changed the what-if sandbox (budget.html). Nothing real moved; these are what-ifs only.]\n${lines.map((l) => '- ' + l).join('\n')}${res}\nThe full scenario is in ${file}. If he asks to make a change real, follow the Wolf Hall rules (say what it will do, wait for his yes).`;
}
