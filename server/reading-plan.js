// The reading plan Horace and Taylor share (Night Shift #75, Horace round 2 9B; round 14: he reads the ESV, and the
// reading goes in the morning). Sunday night Trinity reads that morning's sermon in her Sermon notes and writes the
// week (Monday to Sunday) as a small JSON file: a passage a day, the sermon, and a "for us this week" line. Code then
// uploads it to Wolf Hall (POST /reading-plan/feed, the master key), where both of them see it, tick their days, and
// get today's passage in the morning day ahead. The sermon notes themselves stay with Trinity; only the plan goes over.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { WORKER_URL, workerKey } from './knowledge.js';
import { SERMON_FILE, CHURCH_NOTES } from './trinity.js';
import { state } from './store.js';

export const PLAN_DIR = path.join(DATA_DIR, 'reading-plan');
const TZ = 'America/Chicago';
const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const centralDay = (now) => now.toLocaleDateString('en-CA', { timeZone: TZ });
const weekday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 = Sunday

/** The Monday the plan is for: on Sunday, tomorrow (the week after the sermon); any other day, this week's Monday. */
export function planMonday(now = new Date()) {
  const today = centralDay(now), wd = weekday(today);
  return wd === 0 ? addDays(today, 1) : addDays(today, 1 - wd);
}
export const planFile = (start, dir = PLAN_DIR) => path.join(dir, `${start}.json`);

/** null when this week's plan is already written (nothing to do), else what the prompt needs. */
export function prepareReadingPlan({ now = new Date(), dir = PLAN_DIR } = {}) {
  const start = planMonday(now), file = planFile(start, dir);
  if (fs.existsSync(file)) return null;
  fs.mkdirSync(dir, { recursive: true });
  return { start, end: addDays(start, 6), file, sunday: addDays(start, -1) };
}

export function readingPlanPrompt(p) {
  if (!p) return null;
  return [
    '[Trinity routine, not from Horace. Work quietly: no show_on_screen; final reply one line.]',
    `Write the reading plan Horace and Taylor share for the week of ${p.start} to ${p.end} (Monday to Sunday). It follows the sermon of Sunday ${p.sunday}.`,
    `Read your Sermon notes ("${SERMON_FILE}") for that Sunday's morning sermon (and the evening one if it helps). If it isn't written up yet, use the newest sermon there and say so in "sermon" (e.g. "from Nov 22's sermon").`,
    `You may also look at your church notes ("${CHURCH_NOTES}") for the series and the Monday class.`,
    'Each day: one passage that follows the sermon\'s thread (Monday: the sermon\'s main text; then its context, the cross-references the preacher used, and where it leads; Sunday: a short passage to prepare for worship).',
    'Keep each day to a chapter or less, readable in 10 to 15 minutes. ESV references only (Horace reads the ESV); never quote more than a verse.',
    'For each day add a short note (one plain sentence, under 25 words): what to look for. Then "theme": what this means for the two of them this week, in one or two plain, warm, practical sentences (under 300 characters).',
    'This plan is shown in the Wolf Hall app to Horace and Taylor, so keep it about Scripture and the sermon: no names of members, nothing from anyone\'s email, prayer requests or private notes, no phone numbers or links.',
    `Save exactly this JSON (nothing else in the file) to "${p.file}":`,
    `{"start": "${p.start}", "sermon": "<series: title (preacher)>", "passage": "<the sermon's main text>", "theme": "<for us this week>", "days": [{"date": "${p.start}", "passage": "<book chapter:verses>", "note": "<what to look for>"}, ... one for each day to ${p.end}]}`,
    'Code uploads it to the app; don\'t call Wolf Hall yourself. Then reply with one line: the sermon and the 7 passages.',
  ].join(' ');
}

/** Reads one plan file; null when it's missing or not usable JSON (Wolf Hall checks the rest). */
export function readPlan(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(j.start)) && Array.isArray(j.days) && j.days.length ? j : null;
  } catch { return null; }
}

/**
 * Uploads this week's plan and next week's (when Trinity has written it) to Wolf Hall, each only when it changed.
 * Code only. Returns [{start, ok, unchanged?, error?}] for the log and tests.
 */
export async function uploadReadingPlan({ dir = PLAN_DIR, fetchFn = fetch, key = workerKey, store = state, now = new Date(), log = console } = {}) {
  const today = centralDay(now), wd = weekday(today), thisMon = addDays(today, wd === 0 ? -6 : 1 - wd), out = [];
  for (const start of [thisMon, addDays(thisMon, 7)]) {
    const week = readPlan(planFile(start, dir));
    if (!week) continue;
    if (week.start !== start) { out.push({ start, ok: false, error: 'start date inside the file doesn\'t match its name' }); continue; }
    const sig = JSON.stringify(week), sent = store.get().readingPlan || {};
    if (sent[start] === sig) { out.push({ start, ok: true, unchanged: true }); continue; }
    try {
      const r = await fetchFn(WORKER_URL + '/reading-plan/feed', {
        method: 'POST', headers: { 'X-Worker-Key': key(), 'Content-Type': 'application/json' }, body: JSON.stringify({ week }), signal: AbortSignal.timeout(30000),
      });
      let j = null; try { j = await r.json(); } catch { /* not JSON */ }
      if (!r.ok || !j?.ok) { const error = j?.error || `HTTP ${r.status}`; log.log(`  Reading plan: ${start} upload failed (${error})`); out.push({ start, ok: false, error }); continue; }
      // Keep only the last few weeks' marks so the state file stays small.
      const keep = Object.fromEntries(Object.entries({ ...(store.get().readingPlan || {}), [start]: sig }).sort().slice(-4));
      store.set({ readingPlan: keep });
      log.log(`  Reading plan: week of ${start} uploaded (${j.days} days)`);
      out.push({ start, ok: true });
    } catch (e) { log.log(`  Reading plan: ${start} upload failed (${e.message})`); out.push({ start, ok: false, error: e.message }); }
  }
  if (!out.length) log.log('  Reading plan: nothing written for this week or next yet');
  return out;
}
