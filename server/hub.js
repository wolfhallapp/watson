// The Construct Hub (2026-10-29, per Horace; brief by Morpheus in ~/.oracle-private/morpheus/construct-hub-brief.md):
// a Matrix-style habit game on its own page (public/hub.html). Horace logs in plain words ("showered", "moved 5",
// "dodged buying a pack") and earns XP, ranks, streaks and achievements for the daily quests from his day planner.
// Guardrails from Morpheus: nothing random (no loot boxes, spins or mystery drops), every reward is known in advance,
// XP is never taken away, and a miss is data, not a loss. The log lives where Morpheus reads it.
import fs from 'node:fs';
import path from 'node:path';
import { MDIR } from './morpheus.js';
import { workerGet } from './knowledge.js';

export const LOG = path.join(MDIR, 'construct-log.json');
const TZ = 'America/Chicago';

export const RANKS = [
  ['Bluepill', 0], ['Awakened', 250], ['Redpill', 750], ['Crew', 1500], ['Operator', 3000], ['Captain', 5000], ['Neo', 8000], ['The One', 12000],
];
export const UNLOCKS = { Crew: 'the food construct', Operator: 'clothes and laundry', Captain: 'the cleaning rotation' };
export const XP = { done: 20, partly: 10, missed: 0, perfect: 60, nightCheck: 10, neverMissTwice: 10, dejaVu: 10, dodge: 20 };
export const ACHIEVEMENTS = {
  wake: ['Wake up, Neo', 'Logged your first quest.'],
  rabbit: ['Follow the white rabbit', 'Finished every morning quest in one day.'],
  spoon: ['There is no spoon', 'Your first perfect day.'],
  dodge: ['Dodge this', 'Dodged an impulse buy.'],
  free: ['Free your mind', 'Three perfect days in a row.'],
  twice: ['Never miss twice', 'Picked a quest right back up the day after missing it.'],
  kungfu: ['I know kung fu', 'Seven perfect days in a row.'],
};
const LINES = ['Never miss twice.', 'There is a difference between knowing the path and walking the path.', 'Free your mind.',
  'I can only show you the door. You are the one who has to walk through it.', 'A miss is data, not a loss.', 'Welcome to the real world.'];

// ── Local date/time in Chicago ──
export function local(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute), dow: p.weekday, time: `${p.hour}:${p.minute}` };
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowOf = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

// ── The daily quests, from his planner (dayplanner.md v3) ──
export function questsFor(iso) {
  const d = dowOf(iso);
  const q = (id, label, at, group = 'day') => ({ id, label, at, group });
  if (d === 'Sat' || d === 'Sun') {
    return [q('brush', 'Brush teeth', '08:30', 'morning'), q('meds', 'Meds & vitamins', '08:30', 'morning'), q('water', 'Water before coffee', '08:30', 'morning'),
      q('shower1', 'Shower #1', '09:00', 'morning'), q('move1', 'Move 10', '11:00'), q('move2', 'Move 10', '15:00'),
      ...(d === 'Sun' ? [q('review', 'Sunday review with Morpheus', '19:00', 'evening')] : []),
      q('nightcheck', 'Night check', '20:30', 'evening'), q('shower2', 'Shower #2', '21:45', 'evening'), q('lights', 'Lights out', '22:30', 'evening')];
  }
  if (d === 'Tue') {
    return [q('shower1', 'Shower', '03:20', 'morning'), q('brush', 'Brush teeth', '03:20', 'morning'), q('meds', 'Meds & vitamins', '03:20', 'morning'),
      q('water', 'Water', '03:20', 'morning'), q('nightcheck', 'Night check', '20:30', 'evening'), q('shower2', 'Shower #2', '21:45', 'evening'),
      q('winddown', 'Wind down', '22:00', 'evening'), q('lights', 'Lights out', '22:30', 'evening')];
  }
  const mon = d === 'Mon';
  return [q('water', 'Water before coffee', '07:00', 'morning'), q('brush', 'Brush teeth', '07:15', 'morning'), q('meds', 'Meds & vitamins', '07:15', 'morning'),
    q('shower1', 'Shower #1', '07:45', 'morning'), q('move1', 'Move 5 + water', '09:30'), q('move2', 'Move 5 + water', '11:00'), q('lunch', 'Lunch (log it)', '12:00'),
    q('move3', 'Move 5 + water', '13:30'), q('move4', 'Move 5 + water', '15:00'), q('clockout', 'Clock out at 4:30', '16:30'), q('dinner', 'Dinner', '18:30', 'evening'),
    q('nightcheck', 'Night check', mon ? '20:00' : '20:30', 'evening'), q('shower2', 'Shower #2', mon ? '20:15' : '21:45', 'evening'),
    q('winddown', 'Wind down', mon ? '20:30' : '22:00', 'evening'), q('lights', 'Lights out', mon ? '21:00' : '22:30', 'evening')];
}

// ── Store ──
export function loadLog(file = LOG) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { entries: [], achievements: {}, ...j }; } catch { return { entries: [], achievements: {} }; } }
export function saveLog(log, file = LOG) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(log, null, 1), { mode: 0o600 }); }

// ── Plain words -> quest updates. Handles dictation ("showered and brushed, moved five"). ──
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20 };
const PATTERNS = [
  ['dodge', /\b(dodg\w*|resist\w*|didn'?t buy|did not buy|skipped buying|passed on (buying|a pack))\b/],
  ['nightcheck', /\bnight ?check\b/],
  ['clockout', /\b(clock(ed)? ?out|off work|done (with|for) (work|the day)|logged off|signed off)\b/],
  ['winddown', /\bwind(ing|ed)? ?down\b/],
  ['lights', /\b(lights? out|in bed|went to (bed|sleep)|going to (bed|sleep)|bed ?time)\b/],
  ['review', /\b(sunday )?review\b/],
  ['shower', /\b(shower\w*|bath(ed)?)\b/],
  ['brush', /\b(brush\w*|teeth|flossed)\b/],
  ['meds', /\b(meds|medicine|medication|pills?|vitamins?)\b/],
  ['move', /\b(move[ds]?|moving|walk(ed)?|stretch(ed)?|exercis\w*|push ?ups?|squats?|work(ed)? ?out)\b/],
  ['water', /\b(water|hydrat\w*|drank)\b/],
  ['lunch', /\b(lunch|ate|eat(en)?|had (some )?\w+ (and|&) \w+|breakfast|eggs|bacon|salad|chicken|steak)\b/],
  ['dinner', /\bdinner|supper\b/],
];
export function parse(text, now = new Date()) {
  const t = String(text || '').toLowerCase().replace(/[’']/g, "'");
  const { mins } = local(now);
  const neg = /\b(missed|skipped|didn'?t|did not|forgot|no)\b/;
  const partly = /\b(partly|partially|half|kind of|sort of|some of|almost)\b/;
  // Split into clauses so "showered but missed the night check" logs two different things.
  const clauses = t.split(/\b(?:and|but|then|also|plus)\b|[,.;!?\n]/)
    .map((c) => ` ${c.replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `).filter((c) => c.trim());
  const out = [];
  for (const c of clauses) {
    for (const [kind, re] of PATTERNS) {
      if (!re.test(c)) continue;
      if (kind === 'dodge') { out.push({ kind, status: 'done' }); break; }
      if (kind === 'lunch' && (mins >= 16 * 60 + 30) && !/\blunch\b/.test(c)) { out.push({ kind: 'dinner', status: neg.test(c) ? 'missed' : 'done', note: c.trim() }); break; }
      const prev = out[out.length - 1];
      if (['lunch', 'dinner'].includes(kind) && prev && prev.kind === kind) { prev.note += ' and ' + c.trim(); break; } // "eggs and bacon" is one meal
      const status = neg.test(c) && !/\bno impulse\b/.test(c) ? 'missed' : partly.test(c) ? 'partly' : 'done';
      const m = c.match(/\b(\d+|one|two|three|four)\s*(?:times|x)\b/);
      const count = /\btwice\b/.test(c) ? 2 : m ? Math.min(4, NUM[m[1]] || Number(m[1]) || 1) : 1;
      out.push({ kind, status, count: kind === 'move' ? count : 1, note: ['lunch', 'dinner'].includes(kind) ? c.trim() : undefined });
      break;
    }
  }
  return out;
}

// Map a parsed kind to today's quest id (which shower, which move slot).
function slotFor(kind, quests, doneIds, mins) {
  const ids = quests.map((q) => q.id);
  if (kind === 'shower') {
    const pick = mins < 14 * 60 ? ['shower1', 'shower2'] : ['shower2', 'shower1'];
    return pick.find((id) => ids.includes(id) && !doneIds.has(id)) || pick.find((id) => ids.includes(id));
  }
  if (kind === 'move') return ['move1', 'move2', 'move3', 'move4'].find((id) => ids.includes(id) && !doneIds.has(id));
  return ids.includes(kind) ? kind : null;
}

// ── Scoring: rebuilt from the log every time, so XP can never go down by accident. ──
export function score(log, today = local().date) {
  const byDay = {};
  for (const e of log.entries) (byDay[e.date] = byDay[e.date] || []).push(e);
  const days = Object.keys(byDay).sort();
  let xp = 0, streak = 0, best = 0; const perfect = new Set(); const dayXp = {};
  const doneOn = (iso) => new Set((byDay[iso] || []).filter((e) => e.status === 'done').map((e) => e.habit));
  for (let iso = days[0]; iso && iso <= today; iso = addDays(iso, 1)) {
    const ents = byDay[iso] || [];
    let x = ents.reduce((s, e) => s + (e.xp || 0), 0);
    const quests = questsFor(iso).map((q) => q.id);
    const done = doneOn(iso);
    if (quests.every((id) => done.has(id))) {
      perfect.add(iso); streak += 1; best = Math.max(best, streak);
      x += XP.perfect + Math.min(60, 10 * (streak - 1)); // streak combo: +10 per day in a row, up to +60
    } else if (iso < today) streak = 0;
    dayXp[iso] = x; xp += x;
  }
  const rankIdx = RANKS.reduce((i, r, k) => (xp >= r[1] ? k : i), 0);
  const next = RANKS[rankIdx + 1];
  return { xp, rank: RANKS[rankIdx][0], next: next ? { name: next[0], at: next[1], need: next[1] - xp } : null, streak, best, perfect: [...perfect], dayXp };
}

// "Déjà vu": a quest missed two days running comes back as a glitch quest worth a bonus today. Never a penalty.
export function dejaVu(log, today) {
  const y1 = addDays(today, -1), y2 = addDays(today, -2);
  const did = (iso) => new Set(log.entries.filter((e) => e.date === iso && e.status === 'done').map((e) => e.habit));
  const loggedAny = (iso) => log.entries.some((e) => e.date === iso);
  if (!loggedAny(y1) && !loggedAny(y2)) return [];
  const d1 = did(y1), d2 = did(y2);
  const q1 = new Set(questsFor(y1).map((q) => q.id)), q2 = new Set(questsFor(y2).map((q) => q.id));
  return questsFor(today).map((q) => q.id).filter((id) => q1.has(id) && q2.has(id) && !d1.has(id) && !d2.has(id));
}

function unlock(log, key, at, got) {
  if (log.achievements[key]) return;
  log.achievements[key] = at; got.push(ACHIEVEMENTS[key][0]);
}

// Apply a chat message: returns { reply, added, achievements, state }.
export function logMessage(text, { now = new Date(), file = LOG, quest = null } = {}) {
  const log = loadLog(file);
  const { date, mins, time } = local(now);
  const before = score(log, date);
  const quests = questsFor(date);
  const items = quest ? (quests.some((q) => q.id === quest) ? [{ kind: quest, status: 'done', direct: true }] : []) : parse(text, now);
  const doneIds = new Set(log.entries.filter((e) => e.date === date && e.status === 'done').map((e) => e.habit));
  const glitches = new Set(dejaVu(log, date));
  const yDone = new Set(log.entries.filter((e) => e.date === addDays(date, -1) && e.status === 'done').map((e) => e.habit));
  const yQuests = new Set(questsFor(addDays(date, -1)).map((q) => q.id));
  const added = []; const got = []; const notes = [];
  for (const it of items) {
    if (it.kind === 'dodge') {
      const e = { date, time, habit: 'dodge', status: 'done', xp: XP.dodge, note: 'Dodged an impulse buy', text };
      log.entries.push(e); added.push(e); unlock(log, 'dodge', date, got); continue;
    }
    for (let n = 0; n < (it.count || 1); n++) {
      const id = it.direct ? it.kind : slotFor(it.kind, quests, doneIds, mins);
      if (!id) { if (['lunch', 'dinner'].includes(it.kind)) { const e = { date, time, habit: 'food', status: 'done', xp: 0, note: it.note, text }; log.entries.push(e); added.push(e); } continue; }
      if (it.status === 'done' && doneIds.has(id)) { notes.push(`${quests.find((q) => q.id === id).label} was already logged today.`); continue; }
      let xp = XP[it.status];
      const tags = [];
      if (it.status === 'done') {
        if (id === 'nightcheck') { xp += XP.nightCheck; tags.push('night check +10'); }
        if (glitches.has(id)) { xp += XP.dejaVu; tags.push('Déjà vu cleared +10'); }
        else if (yQuests.has(id) && !yDone.has(id) && log.entries.some((e) => e.date === addDays(date, -1))) { xp += XP.neverMissTwice; tags.push('never miss twice +10'); unlock(log, 'twice', date, got); }
        doneIds.add(id);
      }
      const e = { date, time, habit: id, status: it.status, xp, note: [it.note, ...tags].filter(Boolean).join(' · ') || undefined, text };
      log.entries.push(e); added.push(e);
    }
  }
  if (added.length) unlock(log, 'wake', date, got);
  const morning = quests.filter((q) => q.group === 'morning').map((q) => q.id);
  if (morning.length && morning.every((id) => doneIds.has(id))) unlock(log, 'rabbit', date, got);
  const after = score(log, date);
  if (after.perfect.includes(date)) unlock(log, 'spoon', date, got);
  if (after.streak >= 3) unlock(log, 'free', date, got);
  if (after.streak >= 7) unlock(log, 'kungfu', date, got);
  saveLog(log, file);
  const gained = after.xp - before.xp;
  const label = (e) => e.habit === 'dodge' ? 'Dodged it' : e.habit === 'food' ? `Food logged (${e.note})` : `${(quests.find((q) => q.id === e.habit) || { label: e.habit }).label}: ${e.status}`;
  let reply;
  if (!added.length) reply = notes[0] || "I didn't catch a quest in that, Operator. Try \"showered\", \"moved 5\", \"brushed\", \"night check\", or tap a quest.";
  else {
    reply = `${gained > 0 ? `+${gained} XP.` : 'Logged.'} ${added.map(label).join(' · ')}.`;
    if (added.some((e) => e.status === 'missed')) reply += ' A miss is data, not a loss. Never miss twice.';
    else reply += ' ' + ['The rain thickens, Operator.', 'The code bends to you.', 'You are beginning to believe.', 'Another wall of the Construct lit.'][after.xp % 4];
    if (after.rank !== before.rank) reply += ` Rank up: ${after.rank}.${UNLOCKS[after.rank] ? ` Unlocked: ${UNLOCKS[after.rank]}.` : ''}`;
    if (after.perfect.includes(date) && !before.perfect.includes(date)) reply += ` Perfect day! Streak ${after.streak}.`;
    if (got.length) reply += ` Achievement: ${got.join(', ')}.`;
  }
  return { reply, added, achievements: got, state: hubState({ now, file, log }) };
}

export function hubState({ now = new Date(), file = LOG, log = loadLog(file) } = {}) {
  const { date, mins } = local(now);
  const s = score(log, date);
  const done = new Map();
  for (const e of log.entries.filter((x) => x.date === date)) if (e.status === 'done' || !done.has(e.habit)) done.set(e.habit, e.status);
  const glitch = new Set(dejaVu(log, date));
  const quests = questsFor(date).map((q) => ({ ...q, status: done.get(q.id) || (hm(q.at) + 60 < mins ? 'open-late' : 'open'), dejaVu: glitch.has(q.id) }));
  const nextQ = quests.find((q) => !['done'].includes(q.status) && hm(q.at) >= mins - 15) || null;
  return {
    date, rank: s.rank, xp: s.xp, next: s.next, streak: s.streak, best: s.best, todayXp: s.dayXp[date] || 0,
    quests, left: quests.filter((q) => q.status !== 'done').length, nextQuest: nextQ && { label: nextQ.label, at: nextQ.at },
    achievements: Object.entries(ACHIEVEMENTS).map(([k, [name, how]]) => ({ name, how, at: log.achievements[k] || null })),
    recent: log.entries.slice(-12).reverse(), line: LINES[Number(date.slice(-2)) % LINES.length], ranks: RANKS, unlocks: UNLOCKS,
  };
}

// ── Ticker extras: budget left this week and Thrall weather, cached. ──
const cache = {};
async function cached(key, ms, fn) {
  if (cache[key] && Date.now() - cache[key].at < ms) return cache[key].v;
  try { const v = await fn(); cache[key] = { at: Date.now(), v }; return v; } catch { return cache[key]?.v ?? null; }
}
export async function tickerExtras() {
  const budget = await cached('budget', 30 * 60000, async () => {
    const r = await workerGet('/week-budget?offset=0'); const d = JSON.parse(r.body);
    if (!d.ok) return null;
    const avail = typeof d.totalAvailable === 'number' ? d.totalAvailable : d.totalCap;
    return Math.round((avail - d.totalSpent) * 100) / 100;
  });
  const weather = await cached('weather', 60 * 60000, async () => {
    const h = { 'User-Agent': 'watson-hub (personal)' };
    const pt = await (await fetch('https://api.weather.gov/points/30.592,-97.293', { headers: h, signal: AbortSignal.timeout(15000) })).json();
    const fc = await (await fetch(pt.properties.forecast, { headers: h, signal: AbortSignal.timeout(15000) })).json();
    const p = fc.properties.periods[0];
    return `${p.name}: ${p.temperature}°, ${p.shortForecast}${p.probabilityOfPrecipitation?.value ? `, ${p.probabilityOfPrecipitation.value}% rain` : ''}`;
  });
  return { budget, weather };
}
