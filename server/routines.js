// Watson's own daily routines: prompts Watson gives itself at a set time, quietly (origin
// 'routine', so no screen speaks the reply). Runs once per day per routine, and only when
// Watson isn't busy with something Horace asked, so it never talks over him.
import fs from 'node:fs';
import path from 'node:path';
import { state } from './store.js';
import { DATA_DIR, ROOT } from './config.js';

// The Night Shift (2026-10-28, per Horace): one task a night from data/night-queue.md, worked on a
// separate git worktree and branch, tested, committed locally and written up in data/night-reports/.
// Nothing is deployed, pushed or changed live; agent.js blocks that for routines.
export const NIGHT_QUEUE = path.join(DATA_DIR, 'night-queue.md');
export const NIGHT_REPORTS = path.join(DATA_DIR, 'night-reports');
// Skip a night when the weekly Claude allowance is mostly used, so Horace keeps enough for his own day.
export function usageAllowsNightShift(usage = state.get().usage || {}) {
  const w = usage.seven_day, f = usage.five_hour;
  if (w && typeof w.utilization === 'number' && w.utilization >= 0.7) return false;
  if (f && typeof f.utilization === 'number' && f.utilization >= 0.5 && f.resetsAt && (f.resetsAt > 1e12 ? f.resetsAt : f.resetsAt * 1000) > Date.now()) return false;
  return true;
}

const TZ = 'America/Chicago';

// Morning casino email check (Wolf Hall v202): truly free bonuses -> the app's Email bonuses list.
export const ROUTINES = [
  {
    key: 'nightShift',
    agent: 'night',
    hour: 1, minute: 0, untilHour: 4,
    guard: usageAllowsNightShift,
    prompt: [
      '[Watson routine: the Night Shift. Not from Horace; he is asleep. Work quietly: no show_on_screen, and keep your final reply to one line.]',
      `Read the task queue ${NIGHT_QUEUE}. Take the FIRST unchecked task (- [ ]). If none, write a short report saying the queue is empty and stop.`,
      'Do up to TWO tasks per night (per Horace, 10/28), one at a time, carefully and economically (he watches his usage; avoid long loops and repeated reads).',
      `Start the second task only if the first is finished and ${DATA_DIR}/state.json shows usage.five_hour.utilization below 0.5 and usage.seven_day.utilization below 0.7. Otherwise stop after one.`,
      'Code changes: never touch the main working folders. For the Wolf Hall app, run',
      '`git -C ~/projects/wolf-hall-app worktree add -B oracle/night-$(date +%F) ~/night/wolf-hall-app main` (reuse it if it exists) and work there;',
      `for Watson itself use \`git -C '${ROOT}' worktree add -B oracle/night-$(date +%F) ~/night/watson main\`.`,
      'Follow the repo rules: syntax checks, the tests in tests/, a new test for what you changed, and the agent-smith subagent for Wolf Hall changes. Commit on the night branch with a clear message.',
      'Live checks are read-only GETs only, and never GET /forecast or the current week of /week-budget. Never deploy, push, change Notion or money data, send anything or delete anything. Those are blocked anyway.',
      'If a task needs Horace (a deploy, a money decision, a fact only he knows), do the safe preparation and list exactly what he must approve.',
      `Then write the report to ${NIGHT_REPORTS}/$(date +%F).md: the task; what you did; tests and agent-smith results; the branch and commits;`,
      '"Waiting on you" (anything needing red pill or an answer); and one line of what is next. Tick the task in the queue (- [x]) with the date, or note why it is blocked.',
      'Write one report covering every task you did tonight. Reply with one line: the tasks and their results.',
    ].join(' '),
  },
  {
    // Morning briefing (2026-10-26): ready before Horace's 7 AM wake-up, saved to the Morning Log so the
    // Wolf Hall app's Morning screen shows it even if he has to leave before sitting down at the PC.
    key: 'morningBriefing',
    hour: 6, minute: 40, untilHour: 11,
    tuesday: { hour: 3, minute: 15 }, // Horace leaves for work at 4 AM on Tuesdays
    prompt: [
      '[Watson routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Prepare today\'s morning briefing for Horace. Gather what your Morning section lists for the briefing:',
      'calendar for today and tomorrow, important unread email from the last day, bills due in the next 7 days, the Pool,',
      'the casino Bonus Run, the Architect\'s moves for today, upcoming reminders and the weather for Thrall, TX (one line).',
      `If last night\'s Night Shift report exists (${NIGHT_REPORTS}/<today>.md), add a line starting "🌙 Night shift:" with what it did and anything waiting on Horace.`,
      'Write it as 5 to 10 short plain lines he can read on his phone: no markdown, no links, real numbers only.',
      'Start each line with a small emoji label, for example "📅 Calendar:". Put the most important line first.',
      'Save it with the morning tool, action briefing. Then reply with one line saying it is saved.',
    ].join(' '),
  },
  {
    key: 'casinoOfferScan',
    hour: 7, minute: 30, untilHour: 12,
    tuesday: { hour: 3, minute: 30 },
    prompt: [
      '[Watson routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Morning casino email check. Search Gmail for casino promotion emails from the last day',
      '(category:promotions newer_than:1d, plus anything from the senders in the Casino Sites list).',
      'Page through ALL results (follow nextPageToken) and open every casino email: judge each by its content, never by its subject line.',
      '(Lesson 2026-10-27: a Stake.us "your post-monthly is here!" bonus sent at 3 AM was skipped because of its subject.)',
      'Stake.us weekly, monthly, post-monthly and reload bonus emails are free claims: always add them.',
      'Read the ones that might be free. Keep ONLY bonuses Horace can get with no purchase, no deposit and no required play:',
      'free coupons, freebies, free SC or GC claims, free spins given outright, mail-in or daily gifts, mystery boxes that are free.',
      'Leave out anything tied to buying (packages, % boosts, "first purchase", "match your purchase"), tournaments, prize drops,',
      'leaderboards, referrals and giveaways that need social media.',
      'Add each keeper with the casino tool, action add_offers: site, what (short, e.g. "2.2 SC + 2222 GC"),',
      'expires (ISO 8601 with offset, only if the email says when it ends), link (the email\'s Gmail viewUrl), emailId (Gmail message id).',
      'Then reply with one line: how many you added, or that there were none.',
    ].join(' '),
  },
];

/** The Central day this routine should run for now, or null (not time yet, too late, or already ran). */
export function routineDue(r, now, lastDay) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  if (lastDay === day) return null;
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
    if (main.busy || agents.night?.busy) return;
    const done = state.get().routinesDone || {};
    for (const r of ROUTINES) {
      const day = routineDue(r, new Date(), done[r.key]);
      if (!day) continue;
      state.set({ routinesDone: { ...done, [r.key]: day } });
      if (r.guard && !r.guard()) { console.log(`  Routine ${r.key} skipped for ${day} (usage guard)`); continue; }
      console.log(`  Routine ${r.key} for ${day}`);
      const a = r.agent === 'night' && agents.night ? agents.night : main;
      if (a !== main) await a.reset();
      a.ask(r.prompt, 'routine');
      return; // one at a time; the next tick picks up any other
    }
  };
  return setInterval(tick, every);
}
