// Church pushes (Night Shift queue #64, 11/23, Horace: church is becoming a big deal for him).
// Trinity's nightly digest keeps "Church notes.md" (private, on this PC only). This reads its dated events and prayer
// requests in code and uploads a small feed to Wolf Hall (POST /church/feed, the master key), which pushes Horace
// (and Taylor, if he turns it on in Settings) the evening before and the morning of each event, and each new prayer
// request once. Nothing here reads or sends email, and nothing is ever sent to anyone at church. Email addresses,
// phone numbers and links never leave the PC: the worker scrubs them too, but they're dropped here first.
import fs from 'node:fs';
import { WORKER_URL, workerKey } from './knowledge.js';
import { CHURCH_NOTES } from './trinity.js';
import { state } from './store.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const DOW = '(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*\\.?,?';
const TIME = /^(\d{1,2}(?::\d{2})?\s*(?:AM|PM|a\.m\.|p\.m\.)(?:\s*(?:to|-|–)\s*(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM|a\.m\.|p\.m\.)|noon|midnight))?|noon)\b/i;

/** Plain words: no markdown, emails, phone numbers or links; one line, at most `max` characters. */
export function plain(s, max = 200) {
  let t = String(s || '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|us|cc|io|gov|edu|me|tv|info|church)\b[^\s,;)]*/gi, '') // bare domains (zoom.us/j/1)
    .replace(/(^|\s)@\w+/g, '$1')
    .replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '')
    .replace(/\b(?:phone|call or text|call|text|email)\s*(?=[,.;)]|$)/gi, '')
    .replace(/\*\*|[*_`]/g, '')
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1').replace(/([,;])(?:\s*[,;])+/g, '$1')
    .replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return t;
}

/** The year that puts "Dec 5" closest to the notes' date (Jan dates in late December land next year). */
export function isoNear(mon, day, base) {
  const m = MONTHS.indexOf(String(mon).slice(0, 3).toLowerCase());
  const d = Number(day);
  if (m < 0 || !(d >= 1 && d <= 31)) return '';
  const b = Date.parse(base + 'T12:00:00Z');
  let best = '', gap = Infinity;
  for (const y of [new Date(b).getUTCFullYear() - 1, new Date(b).getUTCFullYear(), new Date(b).getUTCFullYear() + 1]) {
    const t = Date.UTC(y, m, d, 12);
    if (new Date(t).getUTCDate() !== d) continue; // Feb 30 and the like
    if (Math.abs(t - b) < gap) { gap = Math.abs(t - b); best = new Date(t).toISOString().slice(0, 10); }
  }
  return best;
}

function section(text, heading) {
  const lines = String(text || '').split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp('^##\\s+' + heading, 'i').test(l.trim()));
  if (i < 0) return [];
  const out = [];
  for (const l of lines.slice(i + 1)) { if (/^##\s/.test(l)) break; if (/^\s*-\s+/.test(l)) out.push(l.replace(/^\s*-\s+/, '').trim()); }
  return out;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Where it is, only when the notes say so. */
export function placeOf(text) {
  const t = String(text || '');
  if (/\bon zoom\b|\bzoom (?:room|meeting|call)\b/i.test(t)) return 'on Zoom';
  if (/\b(?:at|in) the building\b|\bat the church building\b/i.test(t)) return 'at the church building';
  if (/\bafter (?:sunday )?worship\b/i.test(t)) return 'after worship';
  return '';
}

/**
 * One "Upcoming events" bullet -> {date, endDate?, time, title, place}, or null when it has no single date
 * ("Wednesdays", "Late November", a trip with no day). The bullet starts with its date in bold:
 * "**Sat Dec 5, 10:30 AM**: annual **Ladies Cookie Exchange** ... at the building."
 */
export function parseEvent(line, base) {
  const m = /^\*\*([^*]+)\*\*\s*:?\s*(.*)$/.exec(line);
  if (!m) return null;
  const lead = m[1].trim(), tail = m[2];
  const dm = new RegExp(`^(?:${DOW}\\s+)?${MON}\\s+(\\d{1,2})(?:\\s*(?:to|-|–)\\s*(?:${DOW}\\s+)?(?:${MON}\\s+)?(\\d{1,2}))?(?:\\s*,\\s*|\\s+)?(.*)$`, 'i').exec(lead);
  if (!dm) return null;
  const [, mon1, d1, mon2, d2, restLead] = dm;
  const date = isoNear(mon1, d1, base);
  if (!date) return null;
  let endDate = '';
  if (d2) { endDate = isoNear(mon2 || mon1, d2, base); if (endDate <= date) endDate = ''; }
  let time = '', leadTitle = String(restLead || '').trim();
  const tm = TIME.exec(leadTitle);
  if (tm) { time = tm[1].replace(/\s*(?:-|–)\s*/, ' to '); leadTitle = leadTitle.slice(tm[0].length).trim(); }
  if (/^(?:on zoom|at the building)$/i.test(leadTitle)) leadTitle = '';
  let title = leadTitle;
  if (!title) {
    const bold = /\*\*([^*]{3,80})\*\*/.exec(tail.split(/[.;]\s|\(/)[0] || '');
    title = bold ? bold[1] : (tail.split(/[.;(,:]|\s+at the\s/)[0] || '');
  }
  title = plain(title, 80).replace(/[,.:;]+$/, '');
  if (/^worship$/i.test(title)) title = `${new Date(date + 'T12:00:00Z').getUTCDay() === 0 ? 'Sunday' : ''} worship`.trim();
  title = cap(title);
  if (!title) return null;
  return { date, ...(endDate ? { endDate } : {}), time: plain(time, 30), title, place: placeOf(lead + ' ' + tail) };
}

/**
 * One "Prayer requests and care" bullet -> {date, name, text}, or null with no date. Dated ones only, so a
 * request is pushed once when it's new: "**Brian Hatherly** (Nov 21, men's list): with the rain ..."
 */
export function parsePrayer(line, base) {
  let name = '', rest = line;
  const b = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(line);
  if (b) { name = b[1].trim(); rest = b[2]; }
  else { const n = /^([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3})\s*(\(.*)$/.exec(line); if (n) { name = n[1]; rest = n[2]; } }
  const dateRe = new RegExp(`${MON}\\s+(\\d{1,2})`, 'i');
  const dm = dateRe.exec(name) || dateRe.exec(/^\s*\(([^)]*)\)/.exec(rest)?.[1] || '') || dateRe.exec(rest.slice(0, 40));
  if (!dm) return null;
  const date = isoNear(dm[1], dm[2], base);
  if (!date) return null;
  name = plain(name.replace(new RegExp(`,?\\s*(?:${DOW}\\s+)?${MON}\\s+\\d{1,2}`, 'i'), '').replace(/:$/, ''), 60);
  // "(Nov 21, men's list): what" or ", Kirk's son, about Horace's age (Oct 29, ...): what" -> what.
  const after = /\)\s*:\s+/.exec(rest);
  let text = after && after.index < 160 ? rest.slice(after.index + after[0].length) : rest.replace(/^\s*\([^)]*\)\s*/, '').replace(/^\s*[:,]\s*/, '');
  text = plain(text, 400);
  // The first sentence or two, enough to know what to pray for.
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*(\s|$)/g) || [text];
  let short = '';
  for (const s of sentences) {
    if (/\bHorace\b|\bask (?:tom|him|her|them)\b|\bnot (?:yet )?known\b|\bnot read here\b|\bno word yet\b|\bunclear\b/i.test(s)) continue; // Trinity's notes to herself
    if ((short + s).length > 180 && short) break; short += s;
  }
  short = plain(short, 180);
  if (!short) return null;
  return { date, name, text: cap(short) };
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** The whole notes file -> the feed the worker takes. Events already over are left out. */
export function parseChurchNotes(text, now = new Date()) {
  const upd = /Last updated:\s*(\d{4}-\d{2}-\d{2})/.exec(String(text || ''));
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const base = upd ? upd[1] : today;
  const events = [], prayers = [], seen = new Set();
  for (const l of section(text, 'Upcoming events')) {
    const e = parseEvent(l, base);
    if (!e || (e.endDate || e.date) < today) continue;
    const id = slug(e.date + '-' + e.title);
    if (seen.has(id)) continue; seen.add(id);
    events.push({ id, ...e });
  }
  for (const l of section(text, 'Prayer requests')) {
    const p = parsePrayer(l, base);
    if (!p) continue;
    // The name and date make the id, so a reworded line the next night isn't pushed again.
    const id = slug((p.name || p.text.slice(0, 30)) + '-' + p.date);
    if (seen.has(id)) continue; seen.add(id);
    prayers.push({ id, ...p });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  prayers.sort((a, b) => b.date.localeCompare(a.date));
  const { readings, shared } = sharedNotes(text, base);
  return { notesUpdated: upd ? upd[1] : null, events: events.slice(0, 40), prayers: prayers.slice(0, 30), readings, shared };
}

// ── Taylor's Trinity (Wolf Hall v368, Night Shift #68; Horace rounds 3-4) ──
// Taylor may see Horace's church notes except the ones Horace marks private. A line with "(private)", "[private]" or
// 🔒 stays here, with everything nested under it; so does a whole section whose heading has the mark. Shared: the
// church's Daily Bible Reading (each "**Nov 23**: Acts 27-28. ..." line), the rest of that section, Announcements,
// and any section Horace starts with "Shared". Never shared: prayer requests (members' care stays as it is: the
// v338 reminders), Members, and the Gmail ids. Emails, phone numbers and links are dropped (plain()).
export const PRIVATE_MARK = /\(private\)|\[private\]|\u{1F512}/iu;
const SHARED_HEADING = /^(announcements|daily readings|shared)/i;
const NEVER_SHARED = /^(prayer|members|emails already noted)/i;
const READING = new RegExp(`^\\*\\*(?:${DOW}\\s+)?${MON}\\s+(\\d{1,2})\\*\\*\\s*:?\\s*(.*)$`, 'i');
const BOOK_REF = /^(?:[1-3]\s?)?[A-Z][a-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?\s+\d+(?:[:-]\d+)*(?:\s*[-–,;]\s*(?:[1-3]\s?)?(?:[A-Z][a-z]+\s+)?\d+(?::\d+)?)*/;
/** The notes -> { readings: [{date, passage, note}], shared: [{heading, items}] } with the private parts left out. */
export function sharedNotes(text, base) {
  const readings = [], shared = [], seen = new Set();
  let cur = null, skipIndent = -1;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(raw.trim());
    if (h) {
      const heading = h[1].trim();
      cur = SHARED_HEADING.test(heading) && !NEVER_SHARED.test(heading) && !PRIVATE_MARK.test(heading)
        ? { heading: plain(heading.replace(/^shared:?\s*/i, '') || heading, 60) || 'Shared', items: [], readings: /^daily readings/i.test(heading) } : null;
      if (cur) shared.push(cur);
      skipIndent = -1;
      continue;
    }
    if (!cur) continue;
    const b = /^(\s*)-\s+(.*)$/.exec(raw);
    if (!b) { if (raw.trim() && !/^\s/.test(raw)) skipIndent = -1; continue; }
    const indent = b[1].replace(/\t/g, '  ').length, line = b[2].trim();
    if (skipIndent >= 0 && indent > skipIndent) continue;
    skipIndent = -1;
    if (PRIVATE_MARK.test(line)) { skipIndent = indent; continue; }
    const r = cur.readings && indent === 0 ? READING.exec(line) : null;
    if (r) {
      const date = isoNear(r[1], r[2], base), m = BOOK_REF.exec(r[3].trim());
      if (date && m && !seen.has(date)) {
        seen.add(date);
        readings.push({ date, passage: plain(m[0], 80), note: plain(r[3].trim().slice(m[0].length).replace(/^\s*[.;:,]\s*/, ''), 300) });
        continue;
      }
    }
    const t = plain(line, 400);
    if (t && cur.items.length < 40) cur.items.push(t);
  }
  readings.sort((a, b) => b.date.localeCompare(a.date));
  return { readings: readings.slice(0, 60), shared: shared.filter((s) => s.items.length).map(({ heading, items }) => ({ heading, items })).slice(0, 6) };
}

/**
 * Reads the notes and uploads the feed. Skips the upload when nothing changed since the last one.
 * Never throws (a routine): returns {ok, events, prayers} or {ok:false, error}.
 */
export async function uploadChurchFeed({ file = CHURCH_NOTES, fetchFn = fetch, key = workerKey, store = state, now = new Date(), log = console } = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { log.log('  Church feed: no church notes yet'); return { ok: false, error: 'no church notes' }; }
  const feed = parseChurchNotes(text, now);
  const sig = JSON.stringify(feed), prev = store.get().churchFeed || {};
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  if (prev.sig === sig && prev.day === day) { log.log('  Church feed: unchanged'); return { ok: true, unchanged: true, events: feed.events.length, prayers: feed.prayers.length }; }
  try {
    const r = await fetchFn(WORKER_URL + '/church/feed', {
      method: 'POST', headers: { 'X-Worker-Key': key(), 'Content-Type': 'application/json' }, body: sig, signal: AbortSignal.timeout(30000),
    });
    let j = null; try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok || !j?.ok) { const error = j?.error || `HTTP ${r.status}`; log.log(`  Church feed: upload failed (${error})`); return { ok: false, error }; }
    store.set({ churchFeed: { sig, day, at: now.toISOString() } });
    log.log(`  Church feed: ${feed.events.length} event(s), ${feed.prayers.length} prayer request(s) uploaded`);
    return { ok: true, events: feed.events.length, prayers: feed.prayers.length };
  } catch (e) { log.log(`  Church feed: upload failed (${e.message})`); return { ok: false, error: e.message }; }
}
