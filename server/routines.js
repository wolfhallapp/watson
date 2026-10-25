// Watson's own daily routines: prompts Watson gives itself at a set time, quietly (origin
// 'routine', so no screen speaks the reply). Runs once per day per routine, and only when
// Watson isn't busy with something Horace asked, so it never talks over him.
import { state } from './store.js';

const TZ = 'America/Chicago';

// Morning casino email check (Wolf Hall v202): truly free bonuses -> the app's Email bonuses list.
export const ROUTINES = [
  {
    key: 'casinoOfferScan',
    hour: 7, minute: 30, untilHour: 12,
    prompt: [
      '[Watson routine, not from Horace. Work quietly: do not use show_on_screen and keep your reply to one short line.]',
      'Morning casino email check. Search Gmail for casino promotion emails from the last day',
      '(category:promotions newer_than:1d, plus anything from the senders in the Casino Sites list).',
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
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  if (lastDay === day) return null;
  if (mins < r.hour * 60 + r.minute || mins >= r.untilHour * 60) return null;
  return day;
}

export function startRoutines(agent, { every = 60000 } = {}) {
  const tick = () => {
    if (agent.busy) return;
    const done = state.get().routinesDone || {};
    for (const r of ROUTINES) {
      const day = routineDue(r, new Date(), done[r.key]);
      if (!day) continue;
      state.set({ routinesDone: { ...done, [r.key]: day } });
      console.log(`  Routine ${r.key} for ${day}`);
      agent.ask(r.prompt, 'routine');
      return; // one at a time; the next tick picks up any other
    }
  };
  return setInterval(tick, every);
}
