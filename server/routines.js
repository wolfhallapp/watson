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
    // 10/29 per Horace: use ALL the overnight usage. Runs one task at a time, again and again from 9:15 PM to
    // 6:30 AM, whenever the usage meter allows, so the 5-hour window is spent overnight and fresh by morning.
    key: 'nightShift',
    agent: 'night',
    fresh: true,
    repeat: true,
    hour: 21, minute: 15, untilHour: 6, untilMinute: 30,
    guard: () => usageAllowsNightShift() && /^- \[ \]/m.test(readQueue()),
    prompt: [
      '[Watson routine: the Night Shift. Not from Horace; he is asleep. Work quietly: no show_on_screen, and keep your final reply to one line.]',
      `Read the task queue ${NIGHT_QUEUE}. Take the FIRST unchecked task (- [ ]) and do exactly that ONE task, carefully and economically. You will be started again for the next one.`,
      'NIGHT=$(date -d "+7 hours" +%F) is the date of the morning Horace wakes up; use it for the branch and the report.',
      'Code changes: never touch the main working folders. For the Wolf Hall app, run',
      '`git -C ~/projects/wolf-hall-app worktree add -B oracle/night-$NIGHT ~/night/wolf-hall-app main` (reuse it if it exists) and work there;',
      `for Watson itself use \`git -C '${ROOT}' worktree add -B oracle/night-$NIGHT ~/night/watson main\` (reuse it if it exists).`,
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
      '[Watson routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Prepare today\'s morning briefing for Horace. Gather what your Morning section lists for the briefing:',
      'calendar for today and tomorrow, important unread email from the last day, bills due in the next 7 days, the Pool,',
      'the casino Bonus Run, the Architect\'s moves for today, upcoming reminders and the weather for Thrall, TX (one line).',
      'If Trinity\'s church digest ran last night (Documents/Trinity study/Church notes.md changed since yesterday), add a line starting "⛪ Church:" with the next event and anything new; if it did not run, say so in that line.',
      `If last night\'s Night Shift report exists (${NIGHT_REPORTS}/<today>.md), add a line starting "🌙 Night shift:" with what it did and anything waiting on Horace.`,
      'Write it as 5 to 10 short plain lines he can read on his phone: no markdown, no links, real numbers only.',
      'Start each line with a small emoji label, for example "📅 Calendar:". Put the most important line first.',
      'Save it with the morning tool, action briefing. Then reply with one line saying it is saved.',
    ].join(' '),
  },
  {
    key: 'casinoOfferScan',
    agent: 'routine', // its own throwaway conversation: opening every casino email is what overfilled the Oracle's (2026-10-30)
    fresh: true,
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
    if (main.busy || agents.night?.busy || agents.routine?.busy || agents.trinity?.busy || agents.morpheus?.busy) return;
    const done = state.get().routinesDone || {};
    for (const r of ROUTINES) {
      const day = routineDue(r, new Date(), done[r.key]);
      if (!day) continue;
      if (r.repeat && r.guard && !r.guard()) continue; // overnight: just wait for the meter or new tasks
      state.set({ routinesDone: { ...done, [r.key]: day } });
      if (r.guard && !r.guard()) { console.log(`  Routine ${r.key} skipped for ${day} (usage guard)`); continue; }
      console.log(`  Routine ${r.key} for ${day}`);
      const a = (r.agent && agents[r.agent]) || main;
      if (r.fresh) await a.reset(); // the Night Shift starts clean; Trinity keeps her conversation
      a.ask(r.prompt, 'routine');
      return; // one at a time; the next tick picks up any other
    }
  };
  return setInterval(tick, every);
}
