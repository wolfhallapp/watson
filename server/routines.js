// The Oracle's own daily routines: prompts the Oracle gives itself at a set time, quietly (origin
// 'routine', so no screen speaks the reply). Runs once per day per routine, and only when
// The Oracle isn't busy with something Horace asked, so it never talks over him.
import fs from 'node:fs';
import path from 'node:path';
import { state } from './store.js';
import { DATA_DIR, ROOT } from './config.js';
import { prepareWeeklyLedger, LEDGER_DIR } from './ledger.js';
import { prepareWeeklyTrends, TRENDS_DIR } from './trends.js';
import { prepareBriefingExtras, extrasPrompt, signOffPrompt } from './briefing-extras.js';
import { checkSignins } from './signin-watch.js';
import { uploadChurchFeed } from './church-feed.js';
import { eveningNote } from './evening-note.js';
import { schoolDayToday, schoolPrompt } from './school-watch.js';
import { eveningJournalPrompt, horaceMorning, pushMorpheus } from './journal-prompt.js';
import { windowsNotify } from './notify.js';
import { walkPrompt, queueWalkFindings, APP_WALK_DIR } from './appwalk.js';
import { prepareSermons, sermonPrompt } from './sermons.js';
import { CLASS_PREP } from './trinity.js';
import { prepareReadingPlan, readingPlanPrompt, uploadReadingPlan } from './reading-plan.js';

// The Night Shift (2026-10-28, per Horace): one task a night from data/night-queue.md, worked on a
// separate git worktree and branch, tested, committed locally and written up in data/night-reports/.
// Nothing is deployed, pushed or changed live; agent.js blocks that for routines.
export const NIGHT_QUEUE = path.join(DATA_DIR, 'night-queue.md');
export const NIGHT_REPORTS = path.join(DATA_DIR, 'night-reports');
// "Start the Night Shift now" (10/31): data/night-now holds an ISO time; until then the shift runs in the daytime too.
export const NIGHT_NOW = path.join(DATA_DIR, 'night-now');
export function nightNowUntil() { try { return Date.parse(fs.readFileSync(NIGHT_NOW, 'utf8').trim()) || 0; } catch { return 0; } }
// Casino purchase deals and discounts, for Horace's information (10/31). Never part of the free Bonus Run.
export const CASINO_DEALS = path.join(DATA_DIR, 'casino-deals.md');
// Skip a night when the weekly Claude allowance is mostly used, so Horace keeps enough for his own day.
// 11/4 per Horace (after the Night Shift used up his week on 11/1): at most 6% of the week per night,
// and no Night Shift at all once the week is 75% used.
// 11/22 per Horace (now on Max): 10% of the week per night, and no Night Shift once the week is 80% used.
export const NIGHT_WEEK_STOP = 0.80;
export const NIGHT_PER_NIGHT = 0.10;
// A push window (11/22 per Horace: "I want use all my weekly usage by Tues at 4pm"): until `until`, the shift may
// spend up to `weekStop` of the week with no per-night cap. Paired with data/night-now so it also runs in the daytime.
export const NIGHT_PUSH = path.join(DATA_DIR, 'night-push.json');
export function nightPush(now = new Date()) {
  try { const p = JSON.parse(fs.readFileSync(NIGHT_PUSH, 'utf8')); return Date.parse(p.until) > now.getTime() ? p : null; } catch { return null; }
}
// Pace mode (11/23 per Horace, "7C ... use my usage as efficiently as possible"): with data/night-pace.json present
// (and no push window), the shift runs day and night, spread over the week so it ends near PACE.target at the weekly
// reset instead of burning it early or leaving it unused:
//  - never more than PACE.ahead above the straight line from 0 at the last reset to PACE.target at the next one;
//  - daytime (7 AM-11 PM Central) it waits once the 5-hour meter reaches PACE.dayCap, so Horace always keeps 40%
//    of his window; overnight it may go to PACE.nightCap. In the last 24 h before the reset, with the week under
//    PACE.useItUnder, the daytime cap is lifted (use it or lose it);
//  - a hard stop at PACE.target.
export const NIGHT_PACE = path.join(DATA_DIR, 'night-pace.json');
export const PACE = { target: 0.95, ahead: 0.05, dayCap: 0.60, nightCap: 0.95, useItUnder: 0.80, dayStart: 7, dayEnd: 23 }; // Horace is up 7 AM-11 PM (11/23)
export function nightPace() {
  try { const p = JSON.parse(fs.readFileSync(NIGHT_PACE, 'utf8')); return p && p.on !== false ? { ...PACE, ...(p.pace || {}) } : null; } catch { return null; }
}
const ms = (t) => (t > 1e12 ? t : t * 1000);
/** Pace mode's decision for this moment (pure). Needs the weekly window's resetsAt; returns null without it. */
export function paceAllows(usage, now = new Date(), pace = PACE) {
  const w = usage?.seven_day, f = usage?.five_hour;
  if (!w || typeof w.utilization !== 'number' || !w.resetsAt) return null;
  const end = ms(w.resetsAt), week = 7 * 86400000;
  const frac = Math.min(1, Math.max(0, (now.getTime() - (end - week)) / week));
  if (w.utilization >= pace.target) return false;
  if (w.utilization > pace.target * frac + pace.ahead) return false; // ahead of pace: let the week catch up
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now));
  const day = hour >= pace.dayStart && hour < pace.dayEnd;
  const lastDay = end - now.getTime() <= 86400000 && w.utilization < pace.useItUnder;
  const cap = day && !lastDay ? pace.dayCap : pace.nightCap;
  if (f && typeof f.utilization === 'number' && f.utilization >= cap && f.resetsAt && ms(f.resetsAt) > now.getTime()) return false;
  return true;
}
/** The night a moment belongs to: the Central date 12 hours earlier (so 9 PM to 6:30 AM is one night). */
export function nightKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(now.getTime() - 12 * 3600000));
}
// 11/23 (queue #20): at 02:57 a run replied "three reviewers are reading the code and I'll check their findings
// when they report" and ended; the run's end took the reviewers with it and the next run redid the task.
export const HELPER_RULE = 'Helpers: run every subagent (agent-smith, reviewers, Explore) and every long command in the foreground (run_in_background: false), or wait for each background one to finish and read its result before you reply. Your reply ends the run and anything still working is lost, so never end with "waiting on" helpers, reviewers or a download.';
const HELPER = String.raw`(?:helpers?|sub-?agents?|reviewers?|agents?|agent[- ]smith|background (?:tasks?|jobs?|commands?|runs?|work)|(?:the |that )?(?:download|build|render|test run|pipeline)s?)`;
const CUT_OFF = [
  new RegExp(String.raw`\bwait(?:s|ing)? (?:on|for) (?:the |my |all |both |each )?(?:\w+ )?${HELPER}\b`, 'i'),
  new RegExp(String.raw`\b${HELPER}\b[^.;]{0,60}?\b(?:is|are) (?:still )?(?:reading|running|working|reviewing|checking|auditing|going)\b`, 'i'),
  /\bI(?:'|’)?ll\b[^.;]{0,80}\bwhen (?:they|it|each|all|both|the \w+) (?:report|reports|finish|finishes|complete|completes|come back|comes back|return|returns|report back|is done|are done)\b/i,
  /\b(?:still|now) (?:running|working) in the background\b/i,
];
/** True when a run's last words say it ended while helpers were still working (their work is then lost). */
export function endedWaitingOnHelpers(text) {
  const t = String(text || '');
  return CUT_OFF.some((re) => re.test(t));
}
/** The date of the morning Horace wakes up for this run (the prompt's NIGHT=$(date -d "+7 hours" +%F)). */
export function nightReportDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(now.getTime() + 7 * 3600000));
}
/** Logs a cut-off run in tonight's report so Horace (and the next run) can see the task may be half done. */
export function noteHelpersCutOff(text, now = new Date(), dir = NIGHT_REPORTS) {
  if (!endedWaitingOnHelpers(text)) return null;
  const file = path.join(dir, `${nightReportDate(now)}.md`);
  const at = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(now);
  const said = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);
  const section = `\n\n## ⚠️ A run ended with helpers still working (${at})\n` +
    `- Its last words: "${said}"\n` +
    '- Whatever those helpers were doing was lost when the run ended, so its task may be half done (or redone by the next run). Check that task\'s queue line and branch.\n';
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Night Shift report, ${nightReportDate(now)}`);
  fs.appendFileSync(file, section);
  return file;
}
export function usageAllowsNightShift(usage = state.get().usage || {}, now = new Date(), store = state, push = nightPush(now)) {
  const w = usage.seven_day, f = usage.five_hour;
  if (w && typeof w.utilization === 'number') {
    if (push) {
      if (w.utilization >= Math.min(0.99, Number(push.weekStop) || 0.98)) return false;
      return !(f && typeof f.utilization === 'number' && f.utilization >= 0.95 && f.resetsAt && (f.resetsAt > 1e12 ? f.resetsAt : f.resetsAt * 1000) > Date.now());
    }
    const pace = nightPace();
    if (pace) { const ok = paceAllows(usage, now, pace); if (ok !== null) return ok; } // 11/23 pace mode (its own stop)
    if (w.utilization >= NIGHT_WEEK_STOP) return false;
    // Per-night budget: remember the week's level when this night started (a weekly reset mid-night starts over).
    const night = nightKey(now);
    let b = store.get().nightBudget;
    if (!b || b.night !== night || w.utilization < b.startWeek) { b = { night, startWeek: w.utilization }; store.set({ nightBudget: b }); }
    if (w.utilization - b.startWeek >= NIGHT_PER_NIGHT) return false;
  }
  if (f && typeof f.utilization === 'number' && f.utilization >= 0.95 && f.resetsAt && (f.resetsAt > 1e12 ? f.resetsAt : f.resetsAt * 1000) > Date.now()) return false;
  return true;
}

const TZ = 'America/Chicago';

// Morning casino email check (Wolf Hall v202): truly free bonuses -> the app's Email bonuses list.
export const ROUTINES = [
  {
    // Church digest (2026-10-28, per Horace): Trinity keeps notes on everything from Central Church of Christ and its members.
    key: 'churchDigest',
    agent: 'trinity',
    hour: 20, minute: 30, untilHour: 23,
    prompt: [
      '[Trinity routine, not from Horace. Work quietly: no show_on_screen; final reply one line.]',
      'Update the church notes file (Church notes.md in your study folder). Search Horace\'s Gmail for email from Central Church of Christ (Pflugerville):',
      'At church Horace goes by Levi (Levi Hall; he signs his emails to the men "Levi"), and Taylor appears as Taylor Wolf or David Taylor Wolf. When the weekly "Privileged to serve" lineup or the monthly table list names either of them, add an Upcoming events line for that Sunday, like "- **Sun Nov 29**: **Levi: closing prayer** (Tom\'s lineup, Nov 27)." or "**Taylor: bread at the Lord\'s table**", so the reminders reach them the evening before and that morning.',
      'from:centralchurchofchrist.cc OR list:lists.centralchurchofchrist.cc OR to:all@centralchurchofchrist.cc, plus the members listed in the notes.',
      'If the file does not exist yet, look back 90 days; otherwise cover the last 3 days and skip emails already noted (keep their Gmail ids in the file).',
      'Keep the file organized under these headings: Upcoming events (dates, times, places); Prayer requests and care (who, what, date, and update or remove old ones);',
      'Announcements; Daily readings and sermon notes; Members (name, email, role if stated: elder, deacon, minister, teacher; family ties mentioned).',
      'Keep two formats exactly, because the church reminders on Horace\'s phone are read from them in code: under Upcoming events, start each dated event with its date (and time if known) in bold, then the event name in bold and where it is,',
      'like "- **Sat Dec 5, 10:30 AM**: **Ladies Cookie Exchange** at the building."; under Prayer requests, start each with the name in bold and the date in brackets, like "- **Brian Hatherly** (Nov 21): what to pray for."',
      'Under Daily readings, start each day like "- **Nov 23**: Acts 27-28. Jim\'s devo: ..." (the date in bold, then the passage, then a period), because Taylor\'s Trinity in Wolf Hall reads the readings from it.',
      'Taylor\'s Trinity also sees Announcements, Daily readings and any section starting with "Shared" (never Prayer requests or Members). Horace marks a line (and everything under it) or a heading private with "(private)" or 🔒: keep every such mark exactly as it is, and never move a private line out from under its mark.',
      'Read only, never reply or change email. Keep it factual and kind; this is private to Horace. Then reply with one line: what was added.',
    ].join(' '),
  },
  {
    // The Ledger of the week (night shift 2026-10-30): early Friday, once the Fri-Thu budget week has ended.
    // Listed before the Night Shift so it goes first; prepare() reads the numbers (offset -1 and the 4 weeks
    // before, never the current week) and saves them, then the prompt adds one checked suggestion.
    key: 'weeklyLedger',
    agent: 'night',
    fresh: true,
    weekday: 'Fri',
    hour: 0, minute: 20, untilHour: 6,
    prepare: () => prepareWeeklyLedger(),
    prompt: ({ facts, file, today }) => [
      '[Oracle routine: the Ledger of the week. Not from Horace; he is asleep. Work quietly: no show_on_screen; final reply one line.]',
      'Last week\'s budget numbers, already worked out from GET /week-budget?offset=-1 and the 4 weeks before it:',
      '\n' + facts + '\n',
      'Write one specific, realistic suggestion for the coming week. Before it, check the real numbers (your check-costs-first rule):',
      'his receipts (wolf_hall /week-budget with a NEGATIVE offset only), the weekly targets above, and a quick web search for any price you name.',
      'Never guess a price or amount; if you can\'t check one, leave it out. Never suggest buying in bulk or a subscription without the real cost and how it fits the target.',
      'Encourage, never nag (no lectures about smoking or weight). Never call /forecast or /week-budget with offset 0 (they write to Notion). Change nothing.',
      `Save ${file}. Its FIRST line is the briefing line: "📊 Ledger:" then the total vs target, the biggest overspend, eating out vs the trend and the suggestion, in one plain sentence or two, real numbers only.`,
      'After a blank line, add the full report as short markdown: spent vs target, top 5 merchants, eating-out trend, the suggestion and where its prices came from.',
      `Then reply with one line: the Ledger for ${today} is saved.`,
    ].join(' '),
  },
  {
    // The Sunday week in review (night shift 2026-10-30): Saturday 11 PM, when /morning's 7 days are exactly
    // Sunday to Saturday. Code only (`run`, no agent or prompt), so it doesn't wait for the Night Shift.
    key: 'weeklyTrends',
    weekday: 'Sat',
    hour: 23, minute: 0, untilHour: 24,
    run: () => prepareWeeklyTrends(),
  },
  {
    // Church reminders (Night Shift #64, 11/23): code only. Reads Trinity's Church notes.md and uploads its dated
    // events and prayer requests to Wolf Hall, which pushes at 7 AM and 7 PM. 6 AM catches last night's digest.
    key: 'churchFeed',
    times: [{ hour: 6, minute: 0 }, { hour: 18, minute: 30 }],
    untilHour: 23,
    run: () => uploadChurchFeed(),
  },
  {
    // School attendance (Night Shift #110, 11/24, Horace round 14 8A): Jarrell's absent/tardy emails come at about
    // 3:55 PM, so one read-only Gmail check at 4:10 PM on school days (the app's district calendar decides), in the
    // routine's fresh session; the app pushes Horace. A failed run (the usage limit) retries every 15 min until 8 PM.
    key: 'schoolAttendance',
    agent: 'routine',
    fresh: true,
    retryOnFail: true,
    times: [{ hour: 16, minute: 10 }],
    untilHour: 20,
    guard: () => schoolDayToday(),
    prompt: schoolPrompt(),
  },
  {
    // Sermon notes (Night Shift #74, 11/24): every evening, code lists Central's YouTube channel and saves the
    // captions of any new English sermon (the edited video, or the live stream until it's posted). Trinity is
    // asked only when there's something new; she writes the notes into her study folder, for her only.
    key: 'sermonNotes',
    agent: 'trinity',
    hour: 20, minute: 0, untilHour: 23,
    prepare: () => prepareSermons(),
    prompt: (ready) => sermonPrompt(ready),
  },
  {
    // The reading plan Horace and Taylor share (Night Shift #75): 9 PM, after the sermon notes. Trinity writes the
    // week that follows the sermon (Sunday: next week; any other night, a missing week is caught up). Nothing to do
    // once the week's file exists.
    key: 'readingPlan',
    agent: 'trinity',
    hour: 21, minute: 0, untilHour: 24,
    prepare: () => prepareReadingPlan(),
    prompt: (p) => readingPlanPrompt(p),
  },
  {
    // Code only: uploads the plan to Wolf Hall when it changed. 4 AM is before the first morning day ahead (Taylor's
    // 4:30); 10:30 PM catches Sunday's new week the same night.
    key: 'readingPlanUpload',
    times: [{ hour: 4, minute: 0 }, { hour: 22, minute: 30 }],
    untilHour: 24,
    run: () => uploadReadingPlan(),
  },
  {
    // Monday class prep (Night Shift #74, Horace round 14): a short study note for the Monday class (Jay's
    // Ephesians class until it ends), from what Trinity already reads. Saved in her study folder.
    key: 'classPrep',
    agent: 'trinity',
    weekday: 'Mon',
    hour: 8, minute: 0, untilHour: 17,
    prompt: [
      '[Trinity routine, not from Horace. Work quietly: no show_on_screen; final reply one line.]',
      'Prepare Horace\'s study note for tonight\'s Monday class. Check your church notes and Sermon notes, and his church email (read only) from the last 10 days, for the Monday class: right now Jay\'s Ephesians class, which is wrapping up.',
      'If there is no Monday class this week, or it has ended and no new one is named, write nothing and reply with one line saying so.',
      `Otherwise save "${CLASS_PREP}/<YYYY-MM-DD> <class>.md" (make the folder if needed) with: the passage for this week (ESV reference; Horace reads the ESV; quote only a verse or two and name the translation),`,
      'the context (where it sits in the letter, who and why), 3 to 5 key words with the Greek word and its plain meaning, cross-references, and 2 or 3 discussion questions Horace could bring to class.',
      'If you can\'t find which passage the class is on this week, use the next section after the last one you know of, and put a first line asking Horace which passage it is.',
      'Keep it to one page. Private to Horace: never send or share it. Then reply with one line: the class, the passage and the file name.',
    ].join(' '),
  },
  {
    // Sign-in watch for deploys (night shift 11/23): 6 PM daily, code only. If wrangler or Netlify says it is
    // signed out on the PC, Horace gets one push so he can sign in before the next deploy.
    key: 'signinWatch',
    hour: 18, minute: 0, untilHour: 23,
    run: () => checkSignins(),
  },
  {
    // The evening note (Night Shift #106, 11/23; 8 PM per Horace round 20): code only. One push to Horace with what
    // the Night Shift finished, what's waiting for his "deploy" and the open Red Pill questions; the full release
    // summary goes to data/release-summary.md for the day session.
    key: 'eveningNote',
    hour: 20, minute: 0, untilHour: 23,
    run: () => eveningNote(),
  },
  {
    // Morpheus's evening journaling prompt (Night Shift #115, 11/24; Horace 13A): code only. About 9 PM, one short
    // prompt that fits his day, pushed to his phone and waiting on Morpheus's page ("Answer" or "Not tonight").
    key: 'eveningJournal',
    hour: 21, minute: 0, untilHour: 23,
    run: async () => console.log('  Evening prompt: ' + await eveningJournalPrompt({ morning: () => horaceMorning(), push: pushMorpheus, toast: windowsNotify })),
  },
  {
    // The weekly app walk (Night Shift #86, 11/24; Horace: "take a more hands-on approach in my Chrome to learn more
    // about itself and evolve"). Sunday 1 AM, before the Night Shift's turn, in its own Chrome-enabled session held
    // to appwalk.js's read-only allowlist. When it ends, code queues its best findings as self-found Night Shift tasks.
    key: 'appWalk',
    agent: 'appWalk',
    fresh: true,
    weekday: 'Sun',
    hour: 1, minute: 0, untilHour: 5,
    guard: () => usageAllowsNightShift(),
    prompt: ({ today }) => walkPrompt(today),
    prepare: (day) => ({ today: day }),
    after: (day) => queueWalkFindings(day, { queue: NIGHT_QUEUE }),
  },
  {
    // 10/29 per Horace: use ALL the overnight usage. Runs one task at a time, again and again from 9:15 PM to
    // 6:30 AM, whenever the usage meter allows, so the 5-hour window is spent overnight and fresh by morning.
    key: 'nightShift',
    agent: 'night',
    fresh: true,
    repeat: true,
    forceUntil: () => (nightPace() ? Date.now() + 3600000 : nightNowUntil()), // pace mode runs day and night (11/23)
    hour: 21, minute: 15, untilHour: 6, untilMinute: 30,
    // 10/31 per Horace: always have a task running overnight. With an empty queue it picks its own improvement.
    guard: () => usageAllowsNightShift(),
    checkHelpers: true, // 11/23: a reply that ends "waiting on the reviewers" is logged in the report
    prompt: [
      '[Oracle routine: the Night Shift. Not from Horace; he is asleep. Work quietly: no show_on_screen, and keep your final reply to one line.]',
      `Read the task queue ${NIGHT_QUEUE}. Take the FIRST unchecked task (- [ ]) and do exactly that ONE task, carefully and economically. You will be started again for the next one.`,
      'IF THE QUEUE HAS NO UNCHECKED TASK, choose one yourself (Horace wants the Night Shift always working, 10/31): one improvement or innovation small enough to finish and test tonight.',
      `Look for ideas in the newest reports in ${NIGHT_REPORTS} (open audit findings, "worth a look" notes, failing date-dependent tests), the top of ~/projects/wolf-hall-app/PROGRESS.md (open items), the Wolf Hall CLAUDE.md known issues, and what would make Horace's day easier (his morning routine, budget, Taylor's console, the Construct, the Oracle's own screens).`,
      'Prefer fixing a known problem over something new. Skip anything already built on an unmerged night branch or already in a report, anything that needs an answer only Horace has, and anything that touches money data.',
      'Before starting, append it to the queue as "- [ ] (self-chosen) <what and why>" so the next run does not pick the same thing, then do it exactly like a queued task and mark it self-chosen in the report.',
      'NIGHT=$(date -d "+7 hours" +%F) is the date of the morning Horace wakes up; use it for the branch and the report.',
      'Code changes: never touch the main working folders.',
      'Wolf Hall work stacks on ONE rolling release branch, oracle/next (11/23 per Horace), so shipping is one merge, never a pile of branches that each fork from main:',
      'if it is missing, `git -C ~/projects/wolf-hall-app branch oracle/next main`; keep its worktree at ~/night/wolf-hall-next (`git -C ~/projects/wolf-hall-app worktree add ~/night/wolf-hall-next oracle/next` if missing),',
      'and when main has commits it lacks (a deploy or a PROGRESS note), first run `git -C ~/night/wolf-hall-next merge --no-edit main`.',
      'Then start each task on its own branch from it: `git -C ~/projects/wolf-hall-app worktree add -B oracle/night-$NIGHT-<short-name> ~/night/wolf-hall-<short-name> oracle/next`, and work there.',
      'Version: one more than oracle/next\'s WORKER_VERSION, set in all three places (worker, sw.js cache, splash); never vNEXT.',
      'When the tests and agent-smith pass, move oracle/next onto it: `git -C ~/night/wolf-hall-next merge --ff-only oracle/night-$NIGHT-<short-name>`. A task that fails stays off oracle/next and the report says why. Run that command exactly as written and on its own (no cd, no full path, no 2>&1, no && or ; after it): the night guard allows only that exact form.',
      'Report the branch as oracle/next (plus the task branch), so one red pill ships everything that passed.',
      `for the Oracle itself use \`git -C '${ROOT}' worktree add -B oracle/night-$NIGHT ~/night/watson main\` (reuse it if it exists).`,
      'Follow the repo rules: syntax checks, the tests in tests/, a new test for what you changed, and the agent-smith subagent for Wolf Hall changes. Commit on the night branch with a clear message.',
      HELPER_RULE,
      'Live checks are read-only GETs only, and never GET /forecast or the current week of /week-budget. Never deploy, push, change Notion or money data, send anything or delete anything. Those are blocked anyway.',
      'If a task needs Horace (a deploy, a money decision, a fact only he knows), do the safe preparation and list exactly what he must approve.',
      `Then APPEND a section to the report ${NIGHT_REPORTS}/$NIGHT.md (create it with a title if missing): the task; what you did; tests and agent-smith results; the branch and commits;`,
      '"Waiting on you" (anything needing red pill or an answer). For the Red Pill board in the app: give the branch on its own "**Branch:** <name>" line, and write each question for Horace as a numbered line followed by lettered options on their own lines ("- A) ..."), marking your guess "(my guess)". Tick the task in the queue (- [x]) with the date, or mark it "- [~] blocked: <why>" so it is not picked again. Reply with one line: the task and its result.',
    ].join(' '),
  },
  {
    // Morning briefing (2026-10-26): ready before Horace's 7 AM wake-up, saved to the Morning Log so the
    // Wolf Hall app's Morning screen shows it even if he has to leave before sitting down at the PC.
    key: 'morningBriefing',
    agent: 'routine', // its own throwaway conversation, so email and calendar reading don't fill the Oracle's (2026-10-30)
    fresh: true,
    hour: 6, minute: 40, untilHour: 11,
    tuesday: { hour: 3, minute: 15 }, // Horace leaves for work at 4 AM on Tuesdays
    // 11/23 (Night Shift #53): The Land, Taylor's Ram, Jake's Accountant and the red-pill count, worked out in code
    // (read-only) and added only when there's something to say. It never throws, so it can't hold up the briefing.
    // 11/24 (Night Shift #124): then the sign-off, a Matrix quote and the ESV verse of the day (worked out in code).
    extra: async () => [extrasPrompt(await prepareBriefingExtras()), signOffPrompt()].filter(Boolean).join('\n\n'),
    prompt: [
      '[Oracle routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Prepare today\'s morning briefing for Horace. Gather what your Morning section lists for the briefing:',
      'calendar for today and tomorrow, important unread email from the last day, bills due in the next 7 days, the Pool,',
      // 11/19 per Horace: gambling is off, so no casino Bonus Run or casino deals lines.
      'and upcoming reminders. For the Architect\'s moves use only the "🏗️" line given below (Horace took some strategies off',
      'his briefing on 11/23); if there is no such line, leave the moves out. Never list the unclaimed-property search, Prolific or Respondent.',
      // 11/23 (Night Shift #63): the weather line is worked out in code (NWS for the house, via /property) and comes with the extras below.
      'For the weather use only the "Weather" line given below, word for word; never search the web or call the weather service yourself for it.',
      'Leave out anything about casinos or gambling (no Bonus Run, no casino deals); Horace turned that off on 11/19.',
      'If Trinity\'s church digest ran last night (Documents/Trinity study/Church notes.md changed since yesterday), add a line starting "⛪ Church:" with the next event and anything new; if it did not run, say so in that line.',
      `On Fridays, if ${LEDGER_DIR}/<today>.md exists, add its first line (it starts "📊 Ledger:") as is.`,
      // 11/19 per Horace: he wants to know the date he can move Claude from Pro to the $100 Max plan.
      'On Fridays, also add a line starting "💻 Claude upgrade:" from the wolf_hall tool GET /upgrade-ready (read-only, never /forecast):',
      'if claudeUpgrade.ready, the date and the extra per month (claudeUpgrade.extra); if not ready, its reason in plain words;',
      'if claudeUpgrade is null or the call fails, say the Forecast screen needs one look to refresh it. If asOf is more than 7 days old, say how old.',
      `On Sundays, if ${APP_WALK_DIR}/<today>.md exists, add its first line (it starts "🚶 App walk:") as is.`,
      `On Sundays, if ${TRENDS_DIR}/<today>.md exists, add its first line (it starts "📈 Week") as is; it is his week in review, so keep it warm and never add advice about weight.`,
      `If last night\'s Night Shift report exists (${NIGHT_REPORTS}/<today>.md), add a line starting "🌙 Night shift:" with what it did and anything waiting on Horace.`,
      'Write it as 5 to 10 short plain lines he can read on his phone: no markdown, no links, real numbers only.',
      'Start each line with a small emoji label, for example "📅 Calendar:". Put the most important line first.',
      'Save it with the morning tool, action briefing. Then reply with one line saying it is saved.',
    ].join(' '),
  },
  {
    // Casino email check. 10/31 per Horace: three times a day, and also list purchase deals and discounts
    // (for his information only; they never go on the free Bonus Run list).
    key: 'casinoOfferScan',
    // 11/19 per Horace: OFF, with all gambling scheduling, to save Claude usage (it ran 4x a day).
    // 11/23 (round 7, queue #85): back on, TWICE a day, so Persephone's books on the Gambling screen stay current.
    // 11/6: Persephone's now, in her own throwaway session (opening every casino email is what overfilled the Oracle's, 10/30).
    agent: 'persephoneRoutine',
    retryOnFail: true, // 11/12: a run that fails (e.g. the usage limit) is tried again in the same slot
    fresh: true,
    times: [{ hour: 7, minute: 0 }, { hour: 20, minute: 0 }], // twice a day from 11/23 (round 7); 8 PM catches the 4-8 PM rush (most casino email lands then); was four a day 11/7-11/19
    untilHour: 23,
    tuesday: { hour: 3, minute: 30 }, // the first check moves earlier on Tuesdays
    prompt: [
      '[Persephone routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Casino email check (it runs at 7 AM and 8 PM). Search Gmail for casino promotion emails from the last day',
      '(category:promotions newer_than:1d, plus anything from the senders in the Casino Sites list).',
      'Page through ALL results (follow nextPageToken) and open every casino email: judge each by its content, never by its subject line.',
      '(Lesson 2026-10-27: a Stake.us "your post-monthly is here!" bonus sent at 3 AM was skipped because of its subject.)',
      'Stake.us weekly, monthly, post-monthly and reload bonus emails are free claims: always add them.',
      // 11/5 per Horace ("stale and wrong info in the offers"): scrub each email and relay ONLY real free SC or free spins.
      'THE SCRUB (Horace, 11/5): open the FULL body of each email (get the message, not the snippet) and relay to him ONLY the ones that are actually free SC or free spins.',
      'Nothing else counts: no coin-package sales, purchase or first-buy bonuses, "buy X get Y", GC-only promos, tournaments, raffles or races that need play, prize drops, leaderboards, referrals, social-media giveaways, or marketing teasers.',
      'Never add anything tied to buying with add_offers: keep only what he can get with no purchase, no deposit and no required play.',
      'If the free part needs a purchase, deposit or wager, it is out. Read the email\'s own terms and end date before deciding.',
      'Only add a bonus whose email was SENT in this window (newer_than:1d) and that he can claim now.',
      'SKIP standing site features even when an email advertises them: login streaks ("10-day login streak"), daily logins, daily or fortune wheels, check-ins, dice rolls, VIP or loyalty ladders, level-ups. Those are the site\'s own daily claim on the Bonus Run, not offers.',
      'Use exact amounts. If the email only gives a maximum ("up to 5 SC"), keep "up to" in what and say so in notes ("amount not stated"); never present a maximum as the amount.',
      'SKIP sites that are not in the Casino Sites list, and sites that are Paused, Closed or dropped (Splash Coins, Chanced, SlotsWise, Pulsz Bingo, Poly Casino, Go Go Gold).',
      '(Check the list with casino_state: the active sites, then the paused or closed ones.) The worker also refuses these and says why under "rejected".',
      'Add each with add_offers: site (its exact Casino Sites name), what (short, e.g. "2.2 SC + 2222 GC"),',
      'expires (ISO 8601 with offset, only if the email says when it ends), link (the email\'s Gmail viewUrl), emailId (ALWAYS: the Gmail message id, so the app can open that exact email on his phone),',
      'claimLink (the https URL behind the email\'s own claim or collect button, if it has one; never a purchase, deposit or unsubscribe link). Repeats are skipped, so re-adding is harmless;',
      'a newer offer from the same site and kind replaces the older one, and old ones are expired automatically.',
      'THE LEDGER (Horace, 11/6: as much data as possible, so he can find patterns): record EVERY casino email you open with record_emails, not just the free ones,',
      'in full detail: Gmail id and thread id, when it arrived (ISO), sender, site (its Casino Sites name, or the brand if it is not on the list, with siteOnList false), subject, category',
      '(free_sc, free_spins, deal, tournament, streak, promo, account, other), the amounts (free SC, GC, spins; deal price, SC, GC and percent off), up-to amounts flagged, when it ends,',
      'the claim link, the key terms in a sentence, a one-line summary, whether you added it to the app (addedToApp) and, if the worker rejected it or you skipped it, why (rejectReason). Record in batches of up to 100.',
      `DEALS (Horace wants to know them, 10/31): rewrite ${CASINO_DEALS} as the current list of purchase deals and discounts from the emails`,
      '(e.g. "Chumba: 50% off first package, $9.99 for 30 SC, ends Sun 11:59 PM"). One line each: site, the deal with its real price and what you get, and when it ends.',
      'Keep deals from the existing file that have not expired and drop expired ones. Put a "Updated <date time>" line at the top. Plain facts only: no recommendation to buy, no hype.',
      'Then send the same whole list to the app with update_deals (Horace, 11/12): one entry per deal with site, what, price, what you get, code, endsAt (ISO with offset) or endText, and inCasinoSites.',
      'Finish with history_sync so your claim history stays current and your books (patterns and the newest emails) reach the app\'s Gambling screen.',
      'Then reply with one line: emails recorded, free bonuses added, any the worker rejected, the sites you skipped because they are not in Casino Sites or are paused or dropped (by name), and how many deals are on the list.',
    ].join(' '),
  },
];

function readQueue() { try { return fs.readFileSync(NIGHT_QUEUE, 'utf8'); } catch { return ''; } }

/** The Central day this routine should run for now, or null (not time yet, too late, or already ran). */
export function routineDue(r, now, lastDay) {
  if (r.off) return null; // switched off (11/19: the casino email check)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  if (r.repeat) {
    // Overnight window that wraps past midnight; may run many times, at least 3 minutes apart.
    const start = r.hour * 60 + r.minute, end = r.untilHour * 60 + (r.untilMinute || 0);
    const inWin = start > end ? (mins >= start || mins < end) : (mins >= start && mins < end);
    const forced = r.forceUntil && r.forceUntil() > now.getTime();
    if ((!inWin && !forced) || (lastDay && now - Date.parse(lastDay) < 3 * 60000)) return null;
    return now.toISOString();
  }
  if (r.times) {
    // Several runs a day: the latest slot that has started, until the next one (or untilHour) begins.
    const slots = r.times.map((t, i) => (i === 0 && p.weekday === 'Tue' && r.tuesday ? r.tuesday : t));
    for (let i = slots.length - 1; i >= 0; i--) {
      const start = slots[i].hour * 60 + slots[i].minute;
      const end = i + 1 < slots.length ? slots[i + 1].hour * 60 + slots[i + 1].minute : r.untilHour * 60;
      if (mins < start) continue;
      if (mins >= end) return null;
      const key = `${day}@${String(slots[i].hour).padStart(2, '0')}:${String(slots[i].minute).padStart(2, '0')}`;
      return lastDay === key ? null : key;
    }
    return null;
  }
  if (lastDay === day) return null;
  if (r.weekday && p.weekday !== r.weekday) return null;
  const at = p.weekday === 'Tue' && r.tuesday ? r.tuesday : r;
  if (mins < at.hour * 60 + at.minute || mins >= r.untilHour * 60) return null;
  return day;
}

// Retrying a failed run (Horace, 11/12: the noon casino check hit the usage limit, was marked done and never ran).
// A routine with `retryOnFail` that fails is un-marked, so it runs again in the same slot, at most RETRY_MAX more
// times and no sooner than RETRY_MS apart. It never spills into the next slot (routineDue stops at the slot's end).
export const RETRY_MS = 15 * 60000, RETRY_MAX = 8;
const retries = new Map(); // routine key -> { slot, n, at }
export function retryWaiting(key, slot, now = Date.now()) {
  const r = retries.get(key);
  return !!(r && r.slot === slot && now < r.at);
}
/** Called when a routine's job ended badly. Returns what happened, for the log (and tests). */
export function noteRoutineFailure(key, slot, prev, why, now = Date.now()) {
  const old = retries.get(key);
  const n = (old && old.slot === slot ? old.n : 0) + 1;
  if (n > RETRY_MAX) return `gave up on ${slot} after ${RETRY_MAX} retries (${why})`;
  retries.set(key, { slot, n, at: now + RETRY_MS });
  const done = state.get().routinesDone || {};
  if (done[key] === slot) state.set({ routinesDone: { ...done, [key]: prev ?? null } });
  return `will retry ${slot} in ${RETRY_MS / 60000} min (try ${n} of ${RETRY_MAX}): ${why}`;
}
export function clearRetries() { retries.clear(); }

/**
 * `agents.main` is the Oracle. `agents.night` (optional) is a separate session for routines marked
 * `agent: 'night'`; it starts fresh each run so the Night Shift doesn't grow the Oracle's conversation.
 */
export function startRoutines(agents, { every = 60000 } = {}) {
  const main = agents.main || agents;
  const tick = async () => {
    // Code-only routines (`run`) never speak or use an agent, so they run even while an agent is busy.
    for (const r of ROUTINES) {
      if (!r.run) continue;
      const done = state.get().routinesDone || {};
      const day = routineDue(r, new Date(), done[r.key]);
      if (!day) continue;
      state.set({ routinesDone: { ...done, [r.key]: day } });
      console.log(`  Routine ${r.key} for ${day}`);
      try { await r.run(); } catch (e) { console.log(`  Routine ${r.key} failed: ${e.message}`); }
    }
    if (main.busy || agents.night?.busy || agents.routine?.busy || agents.trinity?.busy || agents.morpheus?.busy || agents.keymaster?.busy || agents.persephone?.busy || agents.persephoneRoutine?.busy || agents.appWalk?.busy) return;
    const done = state.get().routinesDone || {};
    for (const r of ROUTINES) {
      if (r.run) continue;
      const day = routineDue(r, new Date(), done[r.key]);
      if (!day) continue;
      if (r.repeat && r.guard && !r.guard()) continue; // overnight: just wait for the meter or new tasks
      if (r.retryOnFail && retryWaiting(r.key, day)) continue; // failed earlier in this slot: wait a bit
      const prev = done[r.key];
      state.set({ routinesDone: { ...(state.get().routinesDone || {}), [r.key]: day } }); // fresh: an earlier one may have been marked this tick
      if (r.guard && !(await r.guard())) { console.log(`  Routine ${r.key} skipped for ${day} (guard)`); continue; } // a guard may be async (the school-day check)
      console.log(`  Routine ${r.key} for ${day}`);
      let prompt = r.prompt;
      if (r.prepare) {
        // Gathers facts in code first (the Ledger). A failure is logged and saved for the briefing; no retry today.
        try { prompt = r.prompt(await r.prepare(day)); } catch (e) { console.log(`  Routine ${r.key} could not prepare: ${e.message}`); return; }
        if (!prompt) { console.log(`  Routine ${r.key}: nothing new for ${day}`); continue; } // e.g. no new sermon tonight
      }
      if (r.extra) {
        // Extra facts for the prompt (the briefing's Land/Ram/Accountant/red-pill lines). A failure just leaves them out.
        try { const add = await r.extra(); if (add) prompt += '\n\n' + add; } catch (e) { console.log(`  Routine ${r.key}: extras skipped (${e.message})`); }
      }
      const a = (r.agent && agents[r.agent]) || main;
      if (r.fresh) await a.reset(); // the Night Shift starts clean; Trinity keeps her conversation
      if (r.retryOnFail || r.checkHelpers || r.after) a.onceDone = (ok, why, said) => {
        if (r.after && ok) try { const added = r.after(day); if (added?.length) console.log(`  Routine ${r.key}: queued ${added.length} self-found task(s)`); } catch (e) { console.log(`  Routine ${r.key}: after-step failed (${e.message})`); }
        if (r.retryOnFail && !ok) console.log(`  Routine ${r.key}: ${noteRoutineFailure(r.key, day, prev, why)}`);
        if (r.checkHelpers) { const f = noteHelpersCutOff(said); if (f) console.log(`  Routine ${r.key} ended with helpers still working; noted in ${path.basename(f)}`); }
      };
      a.ask(prompt, 'routine');
      return; // one at a time; the next tick picks up any other
    }
  };
  return setInterval(tick, every);
}
