// The Budget Construct's math (2026-11-05, per Horace): a what-if copy of the Wolf Hall plan.
// Pure functions, no I/O, shared by the page (public/budget.js) and the tests. Nothing here can
// change real money data: it starts from GET /spend-today (read-only) and applies Horace's tweaks.
//
// live = the /spend-today response plus `phases` (the worker's SPEND_PHASES, from server/sandbox.js).
// tw   = tweaks: { pool, cushion, horizon, taylorPay, horaceAdj, weekly: { key: { now, later, label } },
//          bills: { name: { amount, off, shift } }, goals: { name: { amount, date, off } },
//          off: { 'date|label': true }, extras: [{ id, label, date, amount, repeat: once|weekly|monthly }] }

export const LOCKED = /^Debt Consolidation/i; // CLAUDE.md #20: never moved, delayed or changed, not even in a what-if
export const LABELS = { Groceries: 'Groceries', Cigs: 'Cigs', C4: "Taylor's gas station buys", Tithing: 'Tithing', FunMoney: 'Fun Money', FastFood: 'Fast Food', Gambling: 'Gambling', GasTaylor: "Taylor's gas", GasHorace: "Horace's gas" };
export const GROUPS = [
  ['Debt consolidation', (e) => LOCKED.test(e.label)],
  ['Credit cards', (e) => /card|min pmt|payoff|opensky|capital one|\bself\b/i.test(e.label)],
  ['Utilities & phone', (e) => /electric|water|starlink|t-mobile|internet|phone/i.test(e.label)],
  ['Insurance', (e) => /allstate|insurance/i.test(e.label)],
  ['Vehicles', (e) => /truck|tire|carwash|registration|inspection|oil/i.test(e.label)],
  ['Subscriptions', (e) => /prime|icloud|netlify|notion|chatgpt|paramount|audible|youtube|walmart\+|hidive|google one|game pass|peacock|claude|netflix|hulu|spotify/i.test(e.label)],
];

export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const r2 = (n) => Math.round(n * 100) / 100;
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
export const fridayOnOrBefore = (iso) => addDays(iso, -((dow(iso) + 2) % 7));
export const groupOf = (e) => (e.type === 'goal' ? 'Savings goals' : e.type === 'extra' ? 'What-if extras' : (GROUPS.find(([, t]) => t(e)) || ['Other bills'])[0]);

/** Weekly categories for a date: the worker's phase targets, then Horace's overrides and added categories. */
export function weeklyFor(live, tw, date) {
  const phases = live.phases || [{ from: '0000-01-01', targets: {} }];
  const later = phases.length > 1 && date >= phases[phases.length - 1].from;
  let ph = phases[0];
  for (const p of phases) if (date >= p.from) ph = p;
  const out = {};
  for (const [k, v] of Object.entries(ph.targets)) out[k] = v;
  for (const [k, o] of Object.entries(tw.weekly || {})) {
    // A built-in category's "from Dec 4" value stays the worker's unless he sets it; an added one keeps its amount.
    const v = later ? (o.later ?? (o.custom ? o.now : null)) : o.now;
    if (v == null || v === '') continue;
    out[k] = Math.max(0, +v || 0);
  }
  return out;
}
const sumObj = (o) => Object.values(o).reduce((t, v) => t + v, 0);

/** Last real date the live data covers (bills run ~4 months out; income only to the live horizon). */
export const dataEnd = (live) => (live.events || []).reduce((m, e) => (e.date > m ? e.date : m), live.horizon || live.today);

/** The scenario's events through `end`: live events with tweaks applied, estimated income past the live horizon, and extras. */
export function buildEvents(live, tw, end) {
  const today = live.today;
  const out = [];
  const lastIncome = { Taylor: 1216, H1: null, H15: null };
  for (const e0 of live.events || []) {
    const e = { ...e0, key: `${e0.date}|${e0.label}`, base: e0.amount };
    if (e.type === 'income') {
      if (/Taylor/.test(e.label)) { lastIncome.Taylor = e.amount; if (tw.taylorPay != null) e.amount = +tw.taylorPay; }
      if (/Horace/.test(e.label)) {
        const day = +e.date.slice(8, 10);
        lastIncome[day <= 7 || day >= 28 ? 'H1' : 'H15'] = e.amount;
        e.amount = r2(e.amount + (+tw.horaceAdj || 0));
      }
    } else if (!LOCKED.test(e.label)) {
      const t = (e.type === 'goal' ? tw.goals : tw.bills)?.[e.label];
      if (t) {
        if (t.off) e.off = true;
        if (t.amount != null && t.amount !== '') e.amount = -Math.abs(+t.amount);
        if (e.type === 'goal' && t.date) e.date = t.date;
        if (e.type !== 'goal' && +t.shift) e.date = addDays(e.date, +t.shift);
      }
    }
    if (tw.off?.[e.key] && !LOCKED.test(e.label)) e.off = true;
    if (e.date > end) continue;
    out.push(e);
  }
  // Past the live horizon the worker sends no income: estimate it the worker's way (Taylor every Friday,
  // Horace's zelle on the 1st and 15th at the last amount seen for that half of the month).
  const from = addDays(live.horizon || today, 1);
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const est = (label, amount) => { const e = { date: d, amount, base: amount, label, type: 'income', est: true, key: `${d}|${label}` }; if (tw.off?.[e.key]) e.off = true; out.push(e); };
    if (dow(d) === 5) est("Taylor's paycheck", tw.taylorPay != null ? +tw.taylorPay : lastIncome.Taylor);
    const dom = +d.slice(8, 10);
    if (dom === 1 && lastIncome.H1 != null) est("Horace's zelle", r2(lastIncome.H1 + (+tw.horaceAdj || 0)));
    if (dom === 15 && lastIncome.H15 != null) est("Horace's zelle", r2(lastIncome.H15 + (+tw.horaceAdj || 0)));
  }
  for (const x of tw.extras || []) {
    if (!x.date || !+x.amount) continue;
    const step = x.repeat === 'weekly' ? 7 : x.repeat === 'monthly' ? 'm' : 0;
    let d = x.date, n = 0;
    while (d <= end && n < 400) {
      if (d >= today || !step) out.push({ date: d, amount: +x.amount, base: 0, label: x.label || 'What-if', type: 'extra', key: `${d}|x:${x.id}`, extraId: x.id });
      if (!step) break;
      n += 1;
      d = step === 7 ? addDays(d, 7) : (() => { const t = new Date(x.date + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); })();
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

/**
 * Run the scenario day by day. The Pool line counts bills, goals and income AND the weekly budget being
 * spent (this week: only what's left in each category; after that, each week's total spread evenly).
 * `safeDaily` is the app's own Spend Today formula on these events, so with no tweaks it matches Home.
 */
export function simulate(live, tw = {}) {
  const today = live.today;
  const end = tw.horizon && tw.horizon > today ? tw.horizon : live.horizon;
  const cushion = tw.cushion != null && tw.cushion !== '' ? +tw.cushion : live.cushion ?? 100;
  const pool0 = tw.pool != null && tw.pool !== '' ? +tw.pool : live.pool;
  const events = buildEvents(live, tw, end);
  const active = events.filter((e) => !e.off);
  const byDay = new Map();
  for (const e of active) { const d = e.date < today ? today : e.date; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); }

  const weekEnd = addDays(fridayOnOrBefore(today), 6);
  const spentWeek = Object.fromEntries((live.categories || []).map((c) => [c.key, c.spent || 0]));
  const thisWeek = weeklyFor(live, tw, today);
  const leftThisWeek = Object.entries(thisWeek).reduce((t, [k, v]) => t + Math.max(0, v - (spentWeek[k] || 0)), 0);
  const daysLeftThisWeek = Math.round((Date.parse(weekEnd) - Date.parse(today)) / 864e5) + 1;

  const days = [];
  let pool = pool0, cum = 0, n = 0, best = null, low = null, under = 0, spendTotal = 0, firstUnder = null;
  for (let d = today; d <= end; d = addDays(d, 1)) {
    const evs = byDay.get(d) || [];
    const net = evs.reduce((t, e) => t + e.amount, 0);
    const spend = d <= weekEnd ? leftThisWeek / daysLeftThisWeek : sumObj(weeklyFor(live, tw, d)) / 7;
    cum += net; n += 1;
    pool = pool + net - spend; spendTotal += spend;
    const a = (pool0 + cum - cushion) / n;
    if (!best || a < best.a) best = { a, date: d };
    if (!low || pool < low.v) low = { v: pool, date: d };
    if (pool < cushion) { under += 1; firstUnder ??= d; }
    days.push({ date: d, pool: r2(pool), net: r2(net), spend: r2(spend), events: evs });
  }
  const safeDaily = best.a < 0 ? 0 : Math.floor(best.a * 100) / 100;

  // Months and where the money goes, over the scenario window.
  const months = new Map();
  const groups = new Map();
  for (const day of days) {
    const m = day.date.slice(0, 7);
    if (!months.has(m)) months.set(m, { month: m, income: 0, bills: 0, spend: 0 });
    const row = months.get(m);
    row.spend += day.spend;
    for (const e of day.events) {
      if (e.amount > 0) row.income += e.amount; else { row.bills -= e.amount; groups.set(groupOf(e), (groups.get(groupOf(e)) || 0) - e.amount); }
    }
  }
  groups.set('Weekly budget', spendTotal);
  const monthRows = [...months.values()].map((r) => ({ ...r, income: r2(r.income), bills: r2(r.bills), spend: r2(r.spend), net: r2(r.income - r.bills - r.spend) }));
  const groupRows = [...groups.entries()].map(([name, total]) => ({ name, total: r2(total) })).filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const weeklyNow = thisWeek;
  const weeklyLater = live.phases?.length > 1 ? weeklyFor(live, tw, live.phases[live.phases.length - 1].from) : thisWeek;

  return {
    today, end, cushion, pool0, events, days, safeDaily, safeDate: best.date,
    low: { v: r2(low.v), date: low.date }, under, firstUnder, endPool: r2(pool),
    weeklyNow, weeklyLater, weeklyNowTotal: r2(sumObj(weeklyNow)), weeklyLaterTotal: r2(sumObj(weeklyLater)),
    headroom: r2(safeDaily - sumObj(weeklyNow) / 7), months: monthRows, groups: groupRows,
    leftThisWeek: r2(leftThisWeek), weekEnd, spentWeek,
  };
}

const ok = (live, tw) => { const s = simulate(live, tw); return s.low.v >= s.cushion; };
/** Binary search the largest value v in [lo, hi] for which make(v) still keeps the Pool at or above the cushion. */
function maxSafe(live, make, lo = 0, hi = 5000) {
  if (!ok(live, make(lo))) return null;
  for (let i = 0; i < 30; i += 1) { const mid = (lo + hi) / 2; if (ok(live, make(mid))) lo = mid; else hi = mid; }
  return Math.floor(lo);
}

/** Solvers ("the Oracle's math"): answers to the usual what-if questions, all on the current scenario. */
export const solve = {
  /** Most extra you could add to the weekly budget, every week, and still never dip under the cushion. */
  extraWeekly: (live, tw) => maxSafe(live, (v) => ({ ...tw, weekly: { ...tw.weekly, __probe: { now: v, custom: true } } })),
  /** Biggest a savings goal (by name) could be, at its current date. */
  goalMax: (live, tw, name) => maxSafe(live, (v) => ({ ...tw, goals: { ...tw.goals, [name]: { ...(tw.goals?.[name] || {}), amount: v, off: false } } })),
  /** Biggest one-time buy you could make on a date. */
  buyMax: (live, tw, date) => maxSafe(live, (v) => ({ ...tw, extras: [...(tw.extras || []), { id: '__probe', label: 'probe', date, amount: -v }] })),
  /** Earliest date a one-time buy of `amount` fits, or null if it never fits in the window. */
  earliest: (live, tw, amount) => {
    const s = simulate(live, tw);
    for (const day of s.days) if (ok(live, { ...tw, extras: [...(tw.extras || []), { id: '__probe', label: 'probe', date: day.date, amount: -Math.abs(amount) }] })) return day.date;
    return null;
  },
};

/** Plain-words findings about the scenario against the live plan (instant, computed here, no AI usage). */
export function insights(live, tw, s = simulate(live, tw), base = simulate(live, { horizon: tw.horizon })) {
  const $ = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const day = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const out = [];
  if (s.low.v < 0) out.push({ level: 'critical', text: `The Pool goes negative: ${$(s.low.v)} on ${day(s.low.date)}. ${s.under} day(s) under your ${$(s.cushion)} cushion, starting ${day(s.firstUnder)}.` });
  else if (s.low.v < s.cushion) out.push({ level: 'serious', text: `The Pool dips under your ${$(s.cushion)} cushion: low of ${$(s.low.v)} on ${day(s.low.date)}, ${s.under} day(s) under, starting ${day(s.firstUnder)}.` });
  else out.push({ level: 'good', text: `Never under the cushion. Lowest point ${$(s.low.v)} on ${day(s.low.date)}.` });
  const dl = r2(s.low.v - base.low.v);
  if (Math.abs(dl) >= 1) out.push({ level: dl > 0 ? 'good' : 'warning', text: `Against the live plan your changes ${dl > 0 ? 'raise' : 'lower'} the low point by ${$(Math.abs(dl))} and the end balance by ${$(Math.abs(s.endPool - base.endPool))}${(s.endPool - base.endPool) * dl < 0 ? ' (the other way)' : ''}.` });
  out.push({ level: s.headroom >= 0 ? 'good' : 'warning', text: s.headroom >= 0 ? `Safe to spend ${$(s.safeDaily)} a day; your weekly plan uses ${$(s.weeklyNowTotal / 7)} of it, leaving about ${$(s.headroom * 7)} a week of room.` : `Your weekly plan (${$(s.weeklyNowTotal)}) is more than the ${$(s.safeDaily * 7)} a week the Pool can carry to ${day(s.safeDate)}. Trim about ${$(-s.headroom * 7)} a week.` });
  const over = Object.entries(s.weeklyNow).filter(([k, v]) => (s.spentWeek[k] || 0) > v + 0.5);
  if (over.length) out.push({ level: 'warning', text: `Over this week already: ${over.map(([k, v]) => `${LABELS[k] || k} (${$(s.spentWeek[k])} of ${$(v)})`).join(', ')}.` });
  const big = s.groups.filter((g) => g.name !== 'Weekly budget')[0];
  if (big) out.push({ level: 'info', text: `Biggest outflow to ${day(s.end)}: ${big.name}, ${$(big.total)}${LOCKED.test(big.name) || big.name === 'Debt consolidation' ? ' (locked: it never moves)' : ''}.` });
  const lowWeeks = Math.max(1, Math.round((Date.parse(s.low.date) - Date.parse(s.today)) / (7 * 864e5)));
  out.push({ level: 'info', text: `Each $10 a week you trim adds about ${$(10 * lowWeeks)} to the low point (${lowWeeks} week(s) before it).` });
  const tight = s.months.filter((m) => m.net < 0).map((m) => new Date(m.month + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }));
  if (tight.length) out.push({ level: 'warning', text: `Months that spend more than they bring in: ${tight.join(', ')}.` });
  if (s.events.some((e) => e.est && !e.off)) out.push({ level: 'info', text: `Past ${day(live.horizon)} the paychecks are estimates (Taylor every Friday, Horace's zelle at its usual amounts).` });
  return out;
}
