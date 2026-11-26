// Morpheus's evening journaling prompt (Night Shift #115, 11/24; Horace round 16, 13A). Code only, no AI call.
// About 9 PM Morpheus offers Horace one short prompt that fits his day: this morning's gratitude, top 3 or note
// (the Morning Log), the church night, a Tuesday at the office, the family weekend, a small money win. It reaches
// his phone as a push and waits on Morpheus's page as a card. "Answer" sends his next words (typed or spoken)
// to Morpheus, who journals them; "Not tonight" skips the night. No prompt on a night he already talked with
// Morpheus. The state lives in Morpheus's private folder because it can quote his own morning words.
import fs from 'node:fs';
import path from 'node:path';
import { MDIR, journalEntries } from './morpheus.js';
import { WORKER_URL, workerKey, workerGet } from './knowledge.js';

const TZ = 'America/Chicago';
export const STATE = () => path.join(MDIR, 'evening-prompt.json');
const listeners = new Set();
export function onPromptChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed(now = new Date()) { for (const fn of listeners) { try { fn(current(now)); } catch { /* a page went away */ } } }

/** YYYY-MM-DD in Central time. */
export function dayKey(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}
const weekday = (now) => now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });

function load() { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return {}; } }
function save(s) {
  fs.mkdirSync(MDIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE(), JSON.stringify(s, null, 1), { mode: 0o600 });
}

const clip = (s, n = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

// Church nights from his week (household facts 11/23): Sun study and service, Mon Ephesians, Wed service, Thu Bible History.
const DAY_PROMPTS = {
  Sun: 'Sunday: Bible study and service. What is one line from today you want to carry into the week?',
  Mon: 'Ephesians class tonight. What stuck with you, and where could it show up this week?',
  Tue: 'A long Tuesday at the office. What got you through it, and what do you want to set down tonight?',
  Wed: 'Wednesday night service. Where did you notice God at work today, even in something small?',
  Thu: 'Bible History tonight. What is one thing you learned, or one question you are still carrying?',
  Fri: 'The week is behind you. Who in the house made you smile this week, and did they know it?',
  Sat: 'Saturday. What filled you back up today, and what drained you?',
};
// When nothing from the day fits, or it was used lately. Encouraging, never nagging (no smoking or weight).
export const BANK = [
  'Name one small win from today. Small counts.',
  'What is one money win from today, however small? A thing you did not buy counts.',
  'What is one kind thing you did for yourself today?',
  'What did you do today that the man you are becoming would be proud of?',
  'What do you want tomorrow to feel like, and what is one thing that would help?',
  'Who did you show up for today? And who showed up for you?',
  'What is weighing on you tonight that you can hand over before you sleep?',
  'Where did you give yourself the patience you would give Tati or Katana?',
];

/** The candidates from his day, best fit first. `entry` is today's Morning Log row (or null). */
export function dayCandidates(entry, now = new Date()) {
  const out = [];
  const e = entry || {};
  const tops = [e.top1, e.top2, e.top3].filter(Boolean);
  if (tops.length) {
    const done = [1, 2, 3].filter((i) => e['top' + i] && e['top' + i + 'Done']).length;
    out.push(done === tops.length
      ? `You finished your top ${tops.length === 1 ? 'one' : tops.length} today. What made today work, so you can do it again?`
      : `Your top ${tops.length === 1 ? 'one' : tops.length} today: ${tops.map((t) => clip(t, 40)).join(', ')}. Which part are you proudest of, even a little?`);
  }
  if (e.gratitude) out.push(`This morning you were grateful for "${clip(e.gratitude)}". Where did it show up again today?`);
  if (e.note) out.push(`This morning you told yourself: "${clip(e.note)}". How did it hold up today?`);
  out.push(DAY_PROMPTS[weekday(now)]);
  return out.filter(Boolean);
}

/** One prompt: the first from his day not used in the last 3 nights, else the bank in turn, skipping recent ones. */
export function pickPrompt({ entry = null, recent = [], now = new Date() } = {}) {
  const last3 = recent.slice(-3);
  const fresh = dayCandidates(entry, now).find((p) => !last3.includes(p));
  if (fresh) return fresh;
  const start = Math.floor(Date.parse(dayKey(now) + 'T12:00:00Z') / 86400000) % BANK.length;
  for (let i = 0; i < BANK.length; i++) {
    const p = BANK[(start + i) % BANK.length];
    if (!recent.slice(-BANK.length + 1).includes(p)) return p;
  }
  return BANK[start];
}

/** True if the journal already has an entry dated today (he talked with Morpheus). */
export function journaledToday(now = new Date(), entries = journalEntries()) {
  const prefix = '## ' + now.toLocaleString('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) + ',';
  return entries.some((e) => e.startsWith(prefix));
}

/** Tonight's card for Morpheus's page: the prompt while it's offered or being answered, else null. */
export function current(now = new Date()) {
  const s = load();
  if (s.date !== dayKey(now) || !['offered', 'answering'].includes(s.status)) return null;
  return { date: s.date, prompt: s.prompt, status: s.status };
}

const PUSH_LIMIT = 300; // the worker's /push/send body limit
export function pushText(prompt) {
  const tail = ' Answer on Morpheus\'s page, by voice or text, or tap "Not tonight" there.';
  return clip(prompt, PUSH_LIMIT - tail.length) + tail;
}

/**
 * The 9 PM routine. Skips a night he already skipped, already journaled, or was already offered.
 * `morning()` returns today's Morning Log entry (a failure just means a prompt from the day of the week).
 */
export async function eveningJournalPrompt({ now = new Date(), morning, push, toast, log = console } = {}) {
  const today = dayKey(now);
  const s = load();
  if (s.date === today && s.status) return `already ${s.status} tonight`;
  const history = (s.history || []).slice(-10);
  if (journaledToday(now)) { save({ date: today, status: 'journaled', history }); return 'he already journaled with Morpheus today'; }
  let entry = null;
  try { entry = morning ? await morning() : null; } catch (e) { log.log?.(`  Evening prompt: Morning Log unread (${e.message})`); }
  const prompt = pickPrompt({ entry, recent: history, now });
  save({ date: today, prompt, status: 'offered', at: now.toISOString(), history: [...history, prompt].slice(-10) });
  changed(now);
  let sent = 0;
  try { const r = push ? await push(pushText(prompt)) : null; sent = r?.ok ? r.sent || 0 : 0; } catch { sent = 0; }
  if (!sent && toast) await toast('Morpheus: ' + prompt);
  return `offered (${sent ? `${sent} phone(s)` : 'Windows notification'}): ${prompt}`;
}

/** Push to Horace's phones as "Morpheus" (POST /push/send with the master key, like the sign-in watch). */
export async function pushMorpheus(body, { fetchImpl = fetch, key = workerKey } = {}) {
  const r = await fetchImpl(WORKER_URL + '/push/send', {
    method: 'POST', headers: { 'X-Worker-Key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ person: 'Horace', title: 'Morpheus', body }), signal: AbortSignal.timeout(30000),
  });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok && !!j?.ok, sent: j?.sent || 0, error: j?.error || (r.ok ? null : `HTTP ${r.status}`) };
}

/** Today's Morning Log row for Horace (read-only GET /morning). */
export async function horaceMorning(get = workerGet) {
  const r = await get('/morning?person=Horace');
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.body).entry || null;
}

/** "Not tonight": works before or after the prompt goes out. */
export function skipTonight(now = new Date()) {
  const s = load();
  const today = dayKey(now);
  save({ ...s, date: today, status: 'skipped', prompt: s.date === today ? s.prompt : undefined, history: s.history || [] });
  changed(now);
  return true;
}

/** "Answer": his next message to Morpheus (typed or spoken) is his answer. */
export function startAnswer(now = new Date()) {
  const s = load();
  if (s.date !== dayKey(now) || s.status !== 'offered') return false;
  save({ ...s, status: 'answering' });
  changed(now);
  return true;
}

/** Called with each message to Morpheus. While he's answering, frames it for Morpheus and closes the card. */
export function frameAnswer(text, now = new Date()) {
  const s = load();
  if (s.date !== dayKey(now) || s.status !== 'answering' || !String(text).trim()) return text;
  save({ ...s, status: 'answered' });
  changed(now);
  return `[Horace is answering tonight's journaling prompt: "${s.prompt}". Listen first, reflect it back briefly, ask at most one gentle question, and save it to the journal with journal_add (tag evening-prompt), using his own words where you can.]\n\n${text}`;
}
