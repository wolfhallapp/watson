// The Oracle's own daily routines: prompts the Oracle gives itself at a set time, quietly (origin
// 'routine', so no screen speaks the reply). Runs once per day per routine, and only when
// The Oracle isn't busy with something Horace asked, so it never talks over him.
import fs from 'node:fs';
import path from 'node:path';
import { state } from './store.js';
import { DATA_DIR, ROOT } from './config.js';
import { prepareWeeklyLedger, LEDGER_DIR } from './ledger.js';
import { prepareWeeklyTrends, TRENDS_DIR } from './trends.js';

// The Night Shift (2026-10-28, per Horace): one task a night from data/night-queue.md, worked on a
// separate git worktree and branch, tested, committed locally and written up in data/night-reports/.
// Nothing is deployed, pushed or changed live; agent.js blocks that for routines.
export const NIGHT_QUEUE = path.join(DATA_DIR, 'night-queue.md');
export const NIGHT_REPORTS = path.join(DATA_DIR, 'night-reports');
// Casino purchase deals and discounts, for Horace's information (10/31). Never part of the free Bonus Run.
export const CASINO_DEALS = path.join(DATA_DIR, 'casino-deals.md');
// Skip a night when the weekly Claude allowance is mostly used, so Horace keeps enough for his own day.
export function usageAllowsNightShift(usage = state.get().usage || {}) {
  const w = usage.seven_day, f = usage.five_hour;
  if (w && typeof w.utilization === 'number' && w.utilization >= 0.8) return false;
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
      'from:centralchurchofchrist.cc OR list:lists.centralchurchofchrist.cc OR to:all@centralchurchofchrist.cc, plus the members listed in the notes.',
      'If the file does not exist yet, look back 90 days; otherwise cover the last 3 days and skip emails already noted (keep their Gmail ids in the file).',
      'Keep the file organized under these headings: Upcoming events (dates, times, places); Prayer requests and care (who, what, date, and update or remove old ones);',
      'Announcements; Daily readings and sermon notes; Members (name, email, role if stated: elder, deacon, minister, teacher; family ties mentioned).',
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
    // 10/29 per Horace: use ALL the overnight usage. Runs one task at a time, again and again from 9:15 PM to
    // 6:30 AM, whenever the usage meter allows, so the 5-hour window is spent overnight and fresh by morning.
    key: 'nightShift',
    agent: 'night',
    fresh: true,
    repeat: true,
    hour: 21, minute: 15, untilHour: 6, untilMinute: 30,
    // 10/31 per Horace: always have a task running overnight. With an empty queue it picks its own improvement.
    guard: () => usageAllowsNightShift(),
    prompt: [
      '[Oracle routine: the Night Shift. Not from Horace; he is asleep. Work quietly: no show_on_screen, and keep your final reply to one line.]',
      `Read the task queue ${NIGHT_QUEUE}. Take the FIRST unchecked task (- [ ]) and do exactly that ONE task, carefully and economically. You will be started again for the next one.`,
      'IF THE QUEUE HAS NO UNCHECKED TASK, choose one yourself (Horace wants the Night Shift always working, 10/31): one improvement or innovation small enough to finish and test tonight.',
      `Look for ideas in the newest reports in ${NIGHT_REPORTS} (open audit findings, "worth a look" notes, failing date-dependent tests), the top of ~/projects/wolf-hall-app/PROGRESS.md (open items), the Wolf Hall CLAUDE.md known issues, and what would make Horace's day easier (his morning routine, budget, Taylor's console, the Construct, the Oracle's own screens).`,
      'Prefer fixing a known problem over something new. Skip anything already built on an unmerged night branch or already in a report, anything that needs an answer only Horace has, and anything that touches money data.',
      'Before starting, append it to the queue as "- [ ] (self-chosen) <what and why>" so the next run does not pick the same thing, then do it exactly like a queued task and mark it self-chosen in the report.',
      'NIGHT=$(date -d "+7 hours" +%F) is the date of the morning Horace wakes up; use it for the branch and the report.',
      'Code changes: never touch the main working folders. For the Wolf Hall app, run',
      '`git -C ~/projects/wolf-hall-app worktree add -B oracle/night-$NIGHT ~/night/wolf-hall-app main` (reuse it if it exists) and work there;',
      `for the Oracle itself use \`git -C '${ROOT}' worktree add -B oracle/night-$NIGHT ~/night/watson main\` (reuse it if it exists).`,
      'Follow the repo rules: syntax checks, the tests in tests/, a new test for what you changed, and the agent-smith subagent for Wolf Hall changes. Commit on the night branch with a clear message.',
      'Live checks are read-only GETs only, and never GET /forecast or the current week of /week-budget. Never deploy, push, change Notion or money data, send anything or delete anything. Those are blocked anyway.',
      'If a task needs Horace (a deploy, a money decision, a fact only he knows), do the safe preparation and list exactly what he must approve.',
      `Then APPEND a section to the report ${NIGHT_REPORTS}/$NIGHT.md (create it with a title if missing): the task; what you did; tests and agent-smith results; the branch and commits;`,
      '"Waiting on you" (anything needing red pill or an answer). Tick the task in the queue (- [x]) with the date, or mark it "- [~] blocked: <why>" so it is not picked again. Reply with one line: the task and its result.',
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
    prompt: [
      '[Oracle routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Prepare today\'s morning briefing for Horace. Gather what your Morning section lists for the briefing:',
      'calendar for today and tomorrow, important unread email from the last day, bills due in the next 7 days, the Pool,',
      'the casino Bonus Run, the Architect\'s moves for today, upcoming reminders and the weather for Thrall, TX (one line).',
      'If Trinity\'s church digest ran last night (Documents/Trinity study/Church notes.md changed since yesterday), add a line starting "⛪ Church:" with the next event and anything new; if it did not run, say so in that line.',
      `On Fridays, if ${LEDGER_DIR}/<today>.md exists, add its first line (it starts "📊 Ledger:") as is.`,
      `On Sundays, if ${TRENDS_DIR}/<today>.md exists, add its first line (it starts "📈 Week") as is; it is his week in review, so keep it warm and never add advice about weight.`,
      `If last night\'s Night Shift report exists (${NIGHT_REPORTS}/<today>.md), add a line starting "🌙 Night shift:" with what it did and anything waiting on Horace.`,
      `If ${CASINO_DEALS} lists deals, add a line starting "🏷️ Casino deals:" with how many and the one ending soonest, as plain fact with no nudge to buy.`,
      'Write it as 5 to 10 short plain lines he can read on his phone: no markdown, no links, real numbers only.',
      'Start each line with a small emoji label, for example "📅 Calendar:". Put the most important line first.',
      'Save it with the morning tool, action briefing. Then reply with one line saying it is saved.',
    ].join(' '),
  },
  {
    // Casino email check. 10/31 per Horace: three times a day, and also list purchase deals and discounts
    // (for his information only; they never go on the free Bonus Run list).
    key: 'casinoOfferScan',
    agent: 'routine', // its own throwaway conversation: opening every casino email is what overfilled the Oracle's (2026-10-30)
    fresh: true,
    times: [{ hour: 7, minute: 30 }, { hour: 13, minute: 0 }, { hour: 19, minute: 0 }],
    untilHour: 23,
    tuesday: { hour: 3, minute: 30 }, // the first check moves earlier on Tuesdays
    prompt: [
      '[Oracle routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Casino email check (it runs at 7:30 AM, 1 PM and 7 PM). Search Gmail for casino promotion emails from the last day',
      '(category:promotions newer_than:1d, plus anything from the senders in the Casino Sites list).',
      'Page through ALL results (follow nextPageToken) and open every casino email: judge each by its content, never by its subject line.',
      '(Lesson 2026-10-27: a Stake.us "your post-monthly is here!" bonus sent at 3 AM was skipped because of its subject.)',
      'Stake.us weekly, monthly, post-monthly and reload bonus emails are free claims: always add them.',
      'FREE BONUSES: keep only what Horace can get with no purchase, no deposit and no required play:',
      'free coupons, freebies, free SC or GC claims, free spins given outright, mail-in or daily gifts, mystery boxes that are free.',
      'Add each with the casino tool, action add_offers: site, what (short, e.g. "2.2 SC + 2222 GC"),',
      'expires (ISO 8601 with offset, only if the email says when it ends), link (the email\'s Gmail viewUrl), emailId (Gmail message id). Repeats are skipped, so re-adding is harmless.',
      'Never add anything tied to buying, tournaments, prize drops, leaderboards, referrals or social-media giveaways with add_offers.',
      `DEALS (Horace wants to know them, 10/31): rewrite ${CASINO_DEALS} as the current list of purchase deals and discounts from the emails`,
      '(e.g. "Chumba: 50% off first package, $9.99 for 30 SC, ends Sun 11:59 PM"). One line each: site, the deal with its real price and what you get, and when it ends.',
      'Keep deals from the existing file that have not expired and drop expired ones. Put a "Updated <date time>" line at the top. Plain facts only: no recommendation to buy, no hype.',
      'Then reply with one line: free bonuses added, and how many deals are on the list.',
    ].join(' '),
  },
];

function readQueue() { try { return fs.readFileSync(NIGHT_QUEUE, 'utf8'); } catch { return ''; } }

/** The Central day this routine should run for now, or null (not time yet, too late, or already ran). */
export function routineDue(r, now, lastDay) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  if (r.repeat) {
    // Overnight window that wraps past midnight; may run many times, at least 3 minutes apart.
    const start = r.hour * 60 + r.minute, end = r.untilHour * 60 + (r.untilMinute || 0);
    const inWin = start > end ? (mins >= start || mins < end) : (mins >= start && mins < end);
    if (!inWin || (lastDay && now - Date.parse(lastDay) < 3 * 60000)) return null;
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
    if (main.busy || agents.night?.busy || agents.routine?.busy || agents.trinity?.busy || agents.morpheus?.busy) return;
    const done = state.get().routinesDone || {};
    for (const r of ROUTINES) {
      if (r.run) continue;
      const day = routineDue(r, new Date(), done[r.key]);
      if (!day) continue;
      if (r.repeat && r.guard && !r.guard()) continue; // overnight: just wait for the meter or new tasks
      state.set({ routinesDone: { ...done, [r.key]: day } });
      if (r.guard && !r.guard()) { console.log(`  Routine ${r.key} skipped for ${day} (usage guard)`); continue; }
      console.log(`  Routine ${r.key} for ${day}`);
      let prompt = r.prompt;
      if (r.prepare) {
        // Gathers facts in code first (the Ledger). A failure is logged and saved for the briefing; no retry today.
        try { prompt = r.prompt(await r.prepare()); } catch (e) { console.log(`  Routine ${r.key} could not prepare: ${e.message}`); return; }
      }
      const a = (r.agent && agents[r.agent]) || main;
      if (r.fresh) await a.reset(); // the Night Shift starts clean; Trinity keeps her conversation
      a.ask(prompt, 'routine');
      return; // one at a time; the next tick picks up any other
    }
  };
  return setInterval(tick, every);
}
