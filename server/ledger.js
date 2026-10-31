// The Ledger of the week (night shift 2026-10-30, per Horace's queue): every Friday after midnight, once a
// Fri-Thu budget week has ended, gather last week's numbers from the worker (read-only GET
// /week-budget?offset=-1 and the four weeks before it), work out spent vs target, the top merchants and the
// eating-out trend in code, then hand the facts to a quiet routine that adds one checked suggestion and
// saves data/ledger/<Friday>.md. The Friday morning briefing reads its 📊 line.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const LEDGER_DIR = path.join(DATA_DIR, 'ledger');
const TZ = 'America/Chicago';

const LABELS = { Groceries: 'Groceries', Cigs: 'Cigs', C4: "Taylor's gas station buys", GasTaylor: 'Gas (Taylor)', GasHorace: 'Gas (Horace)',
  Tithing: 'Tithing', FunMoney: 'Fun Money (eating out)', Pet: 'Pet', Kids: 'Kids', Other: 'Other', Gambling: 'Gambling' };
// Hand-logged expenses are named after their category, not a store ("Cigs — Horace — 2026-10-25").
const HAND_LOGGED = new Set(['other', 'cigs', 'tithing', 'groceries', 'fun money', 'c4', 'gas', 'pet', 'kids', 'gambling', 'receipt']);
// Restaurant-looking names logged outside Fun Money, so the report can say eating out may be undercounted.
const FOOD_OUT = /\b(taco|tacos|pizza|grill|dq|dairy queen|mcdonald|sonic|whataburger|burger|chick-fil-a|wendy|subway|starbucks|domino|popeyes|kfc|crawfish|seafood|bbq|barbecue|restaurant|cafe|diner|wings|kolache|donut|chili'?s|applebee|ihop|denny)\b/i;

const round = (n) => Math.round(n * 100) / 100;
export const money = (n) => '$' + round(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The store part of a receipt name like "HEB — Taylor — 2026-10-24". */
export function merchantOf(name) { return String(name || 'Receipt').split(' — ')[0].trim() || 'Receipt'; }

export function topMerchants(receipts, n = 5) {
  const by = new Map();
  for (const r of receipts || []) {
    const m = merchantOf(r.name), k = m.toLowerCase();
    const e = by.get(k) || { merchant: m, total: 0, visits: 0, handLogged: HAND_LOGGED.has(k) };
    e.total = round(e.total + (Number(r.total) || 0)); e.visits++;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant)).slice(0, n);
}

/** Eating out = the Fun Money bucket (where restaurant receipts go), plus restaurant-looking receipts logged elsewhere. */
export function eatingOut(receipts) {
  let funMoney = 0; const elsewhere = [];
  for (const r of receipts || []) {
    const fm = Number(r.buckets?.FunMoney) || 0;
    funMoney += fm;
    if (!fm && FOOD_OUT.test(merchantOf(r.name))) elsewhere.push({ merchant: merchantOf(r.name), total: round(Number(r.total) || 0), date: r.date });
  }
  return { funMoney: round(funMoney), elsewhere };
}

/** One /week-budget response boiled down. A week with no receipts at all is "not tracked", not a $0 week. */
export function summarizeWeek(wb) {
  if (!wb || wb.ok === false || !Array.isArray(wb.categories)) throw new Error(`week-budget came back without categories${wb?.error ? `: ${wb.error}` : ''}`);
  const receipts = Array.isArray(wb.receipts) ? wb.receipts : [];
  return {
    label: wb.label, weekStart: wb.weekStart, weekEnd: wb.weekEnd,
    tracked: receipts.length > 0, receiptCount: receipts.length,
    totalSpent: round(Number(wb.totalSpent) || 0), totalCap: round(Number(wb.totalCap) || 0),
    categories: wb.categories.filter((c) => c.spent || c.cap).map((c) => ({
      key: c.key, label: LABELS[c.key] || c.key, spent: round(c.spent || 0), cap: round(c.cap || 0),
      over: c.cap ? round((c.spent || 0) - c.cap) : null,
    })),
    receipts,
  };
}

/** weeks[0] = the week that just ended (offset -1); weeks[1..] = the weeks before it, newest first. */
export function buildLedger(weeks) {
  const [last, ...prior] = weeks.map(summarizeWeek);
  const eo = eatingOut(last.receipts);
  const priorTracked = prior.filter((w) => w.tracked);
  const priorEating = priorTracked.map((w) => ({ label: w.label, funMoney: eatingOut(w.receipts).funMoney }));
  const avg = priorEating.length ? round(priorEating.reduce((s, w) => s + w.funMoney, 0) / priorEating.length) : null;
  return {
    week: { label: last.label, weekStart: last.weekStart, weekEnd: last.weekEnd, tracked: last.tracked, receiptCount: last.receiptCount },
    totalSpent: last.totalSpent, totalCap: last.totalCap,
    categories: last.categories,
    overTarget: last.categories.filter((c) => c.over > 0).sort((a, b) => b.over - a.over),
    topMerchants: topMerchants(last.receipts),
    eatingOut: { ...eo, priorWeeks: priorEating, untrackedPriorWeeks: prior.length - priorTracked.length, priorAverage: avg,
      vsAverage: avg == null ? null : round(eo.funMoney - avg) },
  };
}

/** The facts as plain text for the routine prompt and the top of the saved report. */
export function formatLedger(l) {
  const out = [`Ledger of the week, ${l.week.label} (${l.week.weekStart} to ${l.week.weekEnd}), ${l.week.receiptCount} receipts logged.`];
  if (!l.week.tracked) { out.push('No receipts were logged this week, so there is nothing to report; say so instead of making numbers up.'); return out.join('\n'); }
  out.push(`Total: ${money(l.totalSpent)} spent against ${money(l.totalCap)} of weekly targets (only the capped categories have targets).`);
  out.push('Spent vs target:');
  for (const c of l.categories) out.push(`- ${c.label}: ${money(c.spent)}${c.cap ? ` of ${money(c.cap)} (${c.over > 0 ? `${money(c.over)} over` : `${money(-c.over)} under`})` : ' (no weekly target)'}`);
  out.push('Top merchants:');
  l.topMerchants.forEach((m, i) => out.push(`${i + 1}. ${m.merchant}: ${money(m.total)} (${m.visits} ${m.visits === 1 ? 'receipt' : 'receipts'})${m.handLogged ? ', logged by hand, no store name' : ''}`));
  const e = l.eatingOut;
  out.push(`Eating out (Fun Money): ${money(e.funMoney)}.`);
  if (e.priorAverage == null) out.push(`No earlier week in the last ${e.untrackedPriorWeeks} had receipts logged, so there is no trend yet.`);
  else out.push(`Average of the ${e.priorWeeks.length} earlier tracked week(s): ${money(e.priorAverage)} (${e.vsAverage > 0 ? `${money(e.vsAverage)} more` : `${money(-e.vsAverage)} less`} this week)${e.untrackedPriorWeeks ? `; ${e.untrackedPriorWeeks} of the 4 earlier weeks had no receipts logged and are left out` : ''}.`);
  if (e.elsewhere.length) out.push(`Restaurant-looking receipts logged outside Fun Money (may be eating out): ${e.elsewhere.map((x) => `${x.merchant} ${money(x.total)} on ${x.date}`).join('; ')}.`);
  return out.join('\n');
}

/** Reads offset -1 and the 4 weeks before it. Never offset 0: that one writes rollover balances to Notion. */
export async function fetchLedgerWeeks(get, count = 5) {
  const weeks = [];
  for (let i = 1; i <= count; i++) {
    const { status, body } = await get(`/week-budget?offset=-${i}`);
    if (status >= 400) throw new Error(`GET /week-budget?offset=-${i} returned HTTP ${status}`);
    weeks.push(JSON.parse(body));
  }
  return weeks;
}

/** The Central date for `now`, and the day before it. */
export function centralDay(now = new Date(), addDays = 0) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + addDays);
  return x.toISOString().slice(0, 10);
}

/**
 * The routine's preparation: fetch, check the worker agrees the week ended yesterday (it counts days in UTC),
 * save the numbers as JSON, and return the facts for the prompt. On failure it saves a 📊 line saying so,
 * so the briefing tells Horace rather than going quiet, then throws.
 */
export async function prepareWeeklyLedger({ now = new Date(), get, dir = LEDGER_DIR } = {}) {
  const today = centralDay(now), yesterday = centralDay(now, -1);
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (!get) get = (await import('./knowledge.js')).workerGet;
    const weeks = await fetchLedgerWeeks(get);
    if (weeks[0]?.weekEnd !== yesterday) throw new Error(`the worker's last week ends ${weeks[0]?.weekEnd}, not yesterday (${yesterday})`);
    const ledger = buildLedger(weeks);
    fs.writeFileSync(path.join(dir, `${today}.json`), JSON.stringify(ledger, null, 2));
    return { today, file: path.join(dir, `${today}.md`), ledger, facts: formatLedger(ledger) };
  } catch (e) {
    fs.writeFileSync(path.join(dir, `${today}.md`), `📊 Ledger of the week: couldn't build it this time (${e.message}).\n`);
    throw e;
  }
}
