// The Usage page (Night Shift 2026-11-06, per Horace): what eats his Claude allowance. Reads
// data/usage-log.jsonl (one line per finished job, written by agent.js #reportUsage) and sums it by
// Central day and by kind of job. Read-only; it never changes the log.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const USAGE_LOG = path.join(ROOT, 'data', 'usage-log.jsonl');
const TZ = 'America/Chicago';

/** The Central calendar date (YYYY-MM-DD) of a moment. */
export function centralDate(at) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const AGENTS = { oracle: 'Oracle', architect: 'Architect', morpheus: 'Morpheus', trinity: 'Trinity', keymaster: 'Keymaster', persephone: 'Persephone', persephoneRoutine: 'Persephone' };

/** A plain name for what a job was: who ran it and why (a routine, a relay from Claude Code, or Horace himself). */
export function jobKind(j) {
  const ask = String(j.ask || '');
  if (j.agent === 'night') return 'Night Shift';
  if (j.origin === 'routine') {
    const what = ask.replace(/^\[[^\]]*\]\s*/, '');
    if (j.agent === 'trinity') return 'Trinity church notes';
    if (/^casino/i.test(what)) return 'Casino email check';
    if (/^prepar|briefing/i.test(what)) return 'Morning briefing prep';
    if (/ledger/i.test(what)) return 'Weekly Ledger';
    if (/week in review|trend/i.test(what)) return 'Sunday week in review';
    return `${AGENTS[j.agent] || 'Oracle'} routine`;
  }
  const who = AGENTS[j.agent] || (j.agent ? j.agent[0].toUpperCase() + j.agent.slice(1) : 'Oracle');
  if (j.origin === 'claude-code' || /via Claude Code|Relayed by Claude Code/i.test(ask)) return `${who} (from Claude Code)`;
  if (j.origin === 'sandbox') return 'Oracle (Budget Construct)';
  return `${who} (talking with you)`;
}

/** How many percentage points a job moved one window. Null when it can't tell (no reading, or the window reset mid-job). */
export function windowDelta(j, k) {
  const b = j.before?.[k], a = j.after?.[k];
  if (typeof b !== 'number' || typeof a !== 'number') return null;
  const resets = k === 'week' ? 'weekResets' : 'sessionResets';
  if (j.before[resets] && j.after[resets] && j.before[resets] !== j.after[resets]) return null;
  return a < b ? null : a - b;
}

export function parseLog(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j && j.at && !Number.isNaN(Date.parse(j.at))) out.push(j); } catch {}
  }
  return out;
}

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
function bucket(map, key) { return map[key] || (map[key] = { kind: key, jobs: 0, usd: 0, week: 0, session: 0 }); }
function add(b, j) {
  b.jobs++; b.usd += +j.costUsd || 0;
  b.week += windowDelta(j, 'week') || 0; b.session += windowDelta(j, 'session') || 0;
}
const finish = (b) => ({ ...b, usd: round(b.usd), week: round(b.week, 1), session: round(b.session, 1) });

/**
 * Sum the log for the page. `days` Central days end today (oldest first, empty days included);
 * `thisWeek` is every job in the current weekly window (the newest weekResets seen).
 * Percent points are account-wide readings, so jobs running at the same time can each count the same
 * points; the dollar figure (Claude's own estimate per job) never double-counts.
 */
export function usageReport(jobs, { now = new Date(), days = 14 } = {}) {
  const list = [...jobs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const today = centralDate(now);
  const dayKeys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.parse(today + 'T12:00:00Z') - i * 86400000);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const byDay = Object.fromEntries(dayKeys.map((d) => [d, { date: d, jobs: 0, usd: 0, week: 0, session: 0, kinds: {} }]));
  const kinds = new Set();
  for (const j of list) {
    const d = byDay[centralDate(j.at)];
    if (!d) continue;
    const kind = jobKind(j); kinds.add(kind);
    add(d, j); add(bucket(d.kinds, kind), j);
  }
  const last = list[list.length - 1];
  const weekResets = last?.after?.weekResets || null;
  const inWeek = weekResets ? list.filter((j) => (j.after?.weekResets || j.before?.weekResets) === weekResets) : [];
  const weekKinds = {};
  for (const j of inWeek) add(bucket(weekKinds, jobKind(j)), j);
  const weekTotal = inWeek.reduce((s, j) => s + (+j.costUsd || 0), 0);
  // Cheap Night Shift runs (under $1): usually a quick look at the queue or the meter, not a real task.
  const nightQuick = inWeek.filter((j) => j.agent === 'night' && (+j.costUsd || 0) < 1);
  return {
    generated: now.toISOString(),
    today,
    now: last ? { session: last.after?.session ?? null, week: last.after?.week ?? null, sessionResets: last.after?.sessionResets ?? null, weekResets, at: last.at } : null,
    kinds: [...kinds].sort(),
    days: dayKeys.map((k) => { const d = byDay[k]; return { ...finish(d), kinds: Object.fromEntries(Object.entries(d.kinds).map(([n, b]) => [n, finish(b)])) }; }),
    thisWeek: {
      jobs: inWeek.length, usd: round(weekTotal),
      byKind: Object.values(weekKinds).map(finish).sort((a, b) => b.usd - a.usd),
      nightQuick: { jobs: nightQuick.length, usd: round(nightQuick.reduce((s, j) => s + (+j.costUsd || 0), 0)) },
    },
    biggest: inWeek.slice().sort((a, b) => (+b.costUsd || 0) - (+a.costUsd || 0)).slice(0, 8)
      .map((j) => ({ at: j.at, kind: jobKind(j), ask: j.agent === 'morpheus' ? '(private talk)' : String(j.ask || '').replace(/^\[[^\]]*\]\s*/, '').slice(0, 90), usd: round(+j.costUsd || 0), week: windowDelta(j, 'week'), session: windowDelta(j, 'session'), minutes: j.ms ? round(j.ms / 60000, 1) : null })),
  };
}

/** The report straight from the log file (missing file = an empty report). */
export function readUsageReport(opts = {}, file = USAGE_LOG) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  return usageReport(parseLog(text), opts);
}
