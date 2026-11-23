// Uptime watch (11/23, Night Shift task #21): every 15 minutes, a cheap check (no AI call) of the Wolf Hall
// worker's /health and the Netlify site. After 2 misses in a row Horace gets ONE push ("Wolf Hall is down: ...")
// and one more when it's back. Quiet otherwise. If the PC itself can't reach the internet (Starlink out), that
// is not Wolf Hall being down: those checks are logged as "offline" and never count as a miss.
// The push goes through the worker's POST /push/send (master key, Horace only), so when the worker itself is the
// thing that's down the push can't go yet: it waits and is retried each check (a Windows toast goes up right away),
// and if the worker comes back first, Horace gets one "was down ... back now" push instead of two.
// A 7-day log of every check is kept in data/uptime-log.jsonl; the state in data/uptime-state.json.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { WORKER_URL, workerKey } from './knowledge.js';
import { windowsNotify } from './notify.js';

export const SITE_URL = 'https://thriving-brigadeiros-fe0954.netlify.app/';
// A tiny always-up page (HTTP 204) that tells "Wolf Hall is down" apart from "the house internet is down".
export const CONTROL_URL = 'https://www.gstatic.com/generate_204';
export const EVERY_MS = 15 * 60 * 1000;
export const MISSES_TO_ALERT = 2;
export const LOG_DAYS = 7;
export const LOG_FILE = path.join(DATA_DIR, 'uptime-log.jsonl');
export const STATE_FILE = path.join(DATA_DIR, 'uptime-state.json');
export const TARGETS = ['worker', 'site'];
const NAMES = { worker: 'worker', site: 'site' };

/** "11:15 PM" in Central, with the day when it isn't today ("Sun 11:15 PM"). */
export function clock(iso, now = new Date()) {
  const d = new Date(iso);
  const day = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(x);
  const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(d);
  return day(d) === day(now) ? t : `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(d)} ${t}`;
}
export function minutesText(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
function join(list) { return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]; }

/** One round of checks. Each result is {ok, status, ms, version?, notion?, error?}. Never throws. */
export async function checkOnce({ fetchImpl = fetch, key = workerKey, timeout = 20000 } = {}) {
  const probe = async (url, opts, judge) => {
    const t0 = Date.now();
    try {
      const r = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(timeout) });
      const out = { status: r.status, ms: Date.now() - t0 };
      return { ...out, ...(await judge(r)) };
    } catch (e) {
      return { ok: false, status: 0, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 120) };
    }
  };
  let k = '';
  try { k = typeof key === 'function' ? key() : key; } catch { k = ''; }
  const [worker, site] = await Promise.all([
    probe(WORKER_URL + '/health', { headers: k ? { 'X-Worker-Key': k } : {} }, async (r) => {
      if (!r.ok) return { ok: false };
      let j = null; try { j = await r.json(); } catch { return { ok: false, error: 'not JSON' }; }
      // Notion being slow is logged but isn't "Wolf Hall is down": the worker answered.
      return { ok: j?.ok === true, version: j?.version || null, notion: j?.notion ?? null };
    }),
    probe(SITE_URL, { method: 'GET' }, async (r) => ({ ok: r.ok })),
  ]);
  const res = { worker, site };
  // Only when both fail: is it the house internet? Then nothing counts.
  if (!worker.ok && !site.ok) {
    const c = await probe(CONTROL_URL, {}, async (r) => ({ ok: r.status === 204 || r.ok }));
    if (!c.ok) res.offline = true;
  }
  return res;
}

export function emptyState() {
  return { worker: { misses: 0, downSince: null, alerted: false }, site: { misses: 0, downSince: null, alerted: false }, pending: [] };
}

/**
 * Pure: the state after one round, and the notices it makes. A notice is
 * {kind: 'down'|'back', targets, since, until?}. Single misses that recover make nothing.
 */
export function step(prev, res, nowIso) {
  const s = JSON.parse(JSON.stringify(prev || emptyState()));
  for (const t of TARGETS) s[t] ||= { misses: 0, downSince: null, alerted: false };
  s.pending ||= [];
  if (res.offline) return { state: s, notices: [] }; // the house internet, not Wolf Hall
  const down = [], back = [];
  for (const t of TARGETS) {
    const c = s[t];
    if (res[t]?.ok) {
      if (c.alerted) back.push({ t, since: c.downSince });
      s[t] = { misses: 0, downSince: null, alerted: false };
    } else {
      c.misses += 1;
      c.downSince ||= nowIso;
      if (c.misses >= MISSES_TO_ALERT && !c.alerted) { c.alerted = true; down.push(t); }
    }
  }
  const notices = [];
  if (down.length) notices.push({ kind: 'down', targets: down, since: down.map((t) => s[t].downSince).sort()[0] });
  if (back.length) notices.push({ kind: 'back', targets: back.map((b) => b.t), since: back.map((b) => b.since).sort()[0], until: nowIso });
  return { state: s, notices };
}

/**
 * Adds new notices to the waiting list. A "back" for something whose "down" push never went out
 * (the worker was down, so the push couldn't go) folds the two into one "was down, back now".
 */
export function queueNotices(pending, notices) {
  const out = [...(pending || [])];
  for (const n of notices) {
    if (n.kind === 'back') {
      const i = out.findIndex((p) => p.kind === 'down' && p.targets.every((t) => n.targets.includes(t)));
      if (i >= 0) { const d = out.splice(i, 1)[0]; out.push({ kind: 'blip', targets: n.targets, since: d.since, until: n.until }); continue; }
    }
    out.push(n);
  }
  return out;
}

export function noticeText(n, now = new Date()) {
  const what = join(n.targets.map((t) => NAMES[t]));
  const when = (iso) => clock(iso, now);
  if (n.kind === 'down') return `Wolf Hall is down: ${what}, since ${when(n.since)}.`;
  if (n.kind === 'back') return `Wolf Hall is back: ${what} answering again (down ${minutesText(Date.parse(n.until) - Date.parse(n.since))}).`;
  return `Wolf Hall was down: ${what}, ${when(n.since)} to ${when(n.until)}. It's back now.`;
}

/** Push to Horace's phones only, through the worker. Resolves true when at least one phone took it. */
export async function pushHorace(text, { fetchImpl = fetch, key = workerKey } = {}) {
  const r = await fetchImpl(WORKER_URL + '/push/send', {
    method: 'POST', headers: { 'X-Worker-Key': typeof key === 'function' ? key() : key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ person: 'Horace', title: 'Wolf Hall uptime', body: text.slice(0, 300) }), signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return (j.sent || 0) > 0;
}

// ── files ──
export function readState(file = STATE_FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return emptyState(); } }
function writeState(st, file = STATE_FILE) { fs.writeFileSync(file, JSON.stringify(st, null, 2)); }
/** Appends one line and drops lines older than LOG_DAYS. */
export function appendLog(entry, { file = LOG_FILE, now = new Date() } = {}) {
  const cutoff = now.getTime() - LOG_DAYS * 86400000;
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch {}
  const keep = lines.filter((l) => { try { return Date.parse(JSON.parse(l).at) >= cutoff; } catch { return false; } });
  keep.push(JSON.stringify(entry));
  fs.writeFileSync(file, keep.join('\n') + '\n');
  return keep.length;
}

/** One full round: check, log, update state, send what's waiting. Returns what happened (for tests and the console). */
export async function runOnce({ fetchImpl = fetch, key = workerKey, now = () => new Date(), push = pushHorace, toast = windowsNotify,
  stateFile = STATE_FILE, logFile = LOG_FILE } = {}) {
  const res = await checkOnce({ fetchImpl, key });
  const at = now().toISOString();
  const { state: s, notices } = step(readState(stateFile), res, at);
  appendLog({ at, ...res, ...(notices.length ? { notices: notices.map((n) => `${n.kind}:${n.targets.join('+')}`) } : {}) }, { file: logFile, now: now() });
  // A toast on the PC right away for each new notice (works even when the worker can't push).
  for (const n of notices) { try { await toast(noticeText(n, now())); } catch {} }
  s.pending = queueNotices(s.pending, notices);
  const sent = [];
  if (s.pending.length && res.worker.ok) { // the push goes through the worker, so only try while it answers
    const left = [];
    for (const n of s.pending) {
      try { await push(noticeText(n, now()), { fetchImpl, key }); sent.push(n); }
      catch (e) { left.push({ ...n, tries: (n.tries || 0) + 1, lastError: String(e.message || e).slice(0, 120) }); }
    }
    // A push that keeps failing (no phones signed up, say) stops after a day of tries; the toast already went up.
    s.pending = left.filter((n) => n.tries < 96);
  }
  writeState(s, stateFile);
  return { res, notices, sent, state: s };
}

export function startUptimeWatch({ every = EVERY_MS, firstAfter = 60000 } = {}) {
  const tick = async () => {
    try {
      const r = await runOnce();
      for (const n of r.sent) console.log(`  Uptime: pushed "${noticeText(n)}"`);
      if (r.res.offline) console.log('  Uptime: the PC is offline (not counted)');
    } catch (e) { console.log(`  Uptime check failed: ${e.message}`); }
  };
  setTimeout(tick, firstAfter);
  return setInterval(tick, every);
}
