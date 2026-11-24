// School attendance alerts (Night Shift queue #110, 11/24, Horace round 14 8A): when Jarrell Middle School emails that
// Tatiyana or Katana was absent or tardy, Horace's phone buzzes right away, not just in the morning briefing.
// The district's Skyward system sends these at about 3:55 PM on the day (all three so far: Sep 16, Oct 30, Nov 10), so
// the schoolAttendance routine checks Gmail once at 4:10 PM on school days, read-only, and hands each attendance email
// to the school_attendance tool. Wolf Hall (v359, POST /school/absence, the master key) reads each email itself, skips
// repeats, newsletters and anyone who isn't one of the girls, and pushes Horace only. Nothing here sends, labels or
// changes email. Whether it's a school day comes from the app's copy of the district calendar (GET /school?day=).
import { WORKER_URL, workerKey } from './knowledge.js';

/** The Gmail search the routine runs (the district's domain, the last 2 days, attendance words only). */
export const SCHOOL_GMAIL_QUERY = 'from:jarrellisd.org newer_than:2d (absence OR absense OR absent OR tardy OR attendance)';
export const SCHOOL_BODY_MAX = 3000;

const centralDay = (now) => now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

/**
 * True when the app says the girls have school today. Weekends, holidays, breaks and summer are false. Any failure
 * (the app unreachable, or v359 not live yet) is false too, with a log line: the push goes through the app anyway.
 */
export async function schoolDayToday({ fetchFn = fetch, key = workerKey, now = new Date(), log = console } = {}) {
  const day = centralDay(now);
  try {
    const r = await fetchFn(`${WORKER_URL}/school?day=${day}`, { headers: { 'X-Worker-Key': key() }, signal: AbortSignal.timeout(20000) });
    let j = null; try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok || !j?.ok || !j.day) { log.log(`  School check: couldn't read the school calendar (${j?.error || 'HTTP ' + r.status}); skipped`); return false; }
    if (!j.day.school) log.log(`  School check: no school ${day} (${j.day.why}); skipped`);
    return j.day.school === true;
  } catch (e) { log.log(`  School check: couldn't reach the app (${e.message}); skipped`); return false; }
}

/** One email as the app wants it: ids, sender, subject, a trimmed plain-text body, the ISO date and his own Gmail link. */
export function cleanNotice(n) {
  const link = /^https:\/\/mail\.google\.com\//.test(String(n?.link || '')) ? String(n.link).slice(0, 500) : undefined;
  return {
    emailId: String(n?.emailId || '').slice(0, 64),
    from: String(n?.from || '').slice(0, 200),
    subject: String(n?.subject || '').slice(0, 300),
    body: String(n?.body || '').slice(0, SCHOOL_BODY_MAX),
    date: String(n?.date || '').slice(0, 40),
    ...(link ? { link } : {}),
  };
}

/** POST the notices to Wolf Hall. Returns {status, json, text}. */
export async function postSchoolNotices(notices, { fetchFn = fetch, key = workerKey } = {}) {
  const r = await fetchFn(WORKER_URL + '/school/absence', {
    method: 'POST', headers: { 'X-Worker-Key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ notices: (notices || []).slice(0, 30).map(cleanNotice) }), signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

/** The routine's prompt (kept short: it runs every school day). */
export function schoolPrompt() {
  return [
    '[Oracle routine: the school attendance check. Not from Horace. Work quietly: no show_on_screen; final reply one line.]',
    `Search Horace's Gmail (read only) with exactly: ${SCHOOL_GMAIL_QUERY}`,
    'For each message found, read it (get_thread, plain text) and pass ALL of them in one call to school_attendance:',
    'emailId (the Gmail message id), from (the sender address), subject, body (the plain text), date (ISO), link (the message viewUrl).',
    'The app decides which are attendance notices about Tatiyana or Katana, skips repeats, and pushes Horace\'s phone; do not judge them yourself.',
    'If the search finds nothing, do not call the tool. Never reply to, label, archive or change any email, and send nothing to anyone.',
    'Reply with one line: how many emails you passed on and what the app said (pushed or skipped).',
  ].join(' ');
}
