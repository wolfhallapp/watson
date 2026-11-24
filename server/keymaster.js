// The Keymaster (2026-11-04, per Horace): the fifth agent, first for market research on stocks, ETFs and crypto.
// Retasked 2026-11-24 (Night Shift #84, Horace round 5 and 16): now Horace's personal accountant. He reads the
// Wolf Hall books through an allowlist of read-only GETs (books tool below), runs what-if math (debt snowball,
// savings growth), and still teaches investing, but never gives buy/sell/hold advice and never moves money.
// Named after the Keymaster in The Matrix ("unlocks doors"): calm, precise, a little formal. Copies Trinity's
// pattern: own page (public/keymaster.html), conversation (data/keymaster-history.jsonl), saved session,
// parameters in knowledge/keymaster.md, and a context folder (Documents/Keymaster) with Horace's profile,
// strategy, portfolio, watchlist and prompts.
// HARD RULE: the Keymaster never places trades. He has no brokerage tools, and blockTool() below refuses any
// brokerage or trading tool that might show up from elsewhere (a connector, a user MCP server, a command).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { ROOT, DATA_DIR, config } from './config.js';
import { makeHistory, memory } from './store.js';
import { formatLocal, userTimeZone } from './tools.js';
import { searchSessions, workerGet } from './knowledge.js';

// ── Context folder (Windows side, so Horace can open the files), with a home-folder fallback like Trinity's ──
const CONTEXT = process.env.KEYMASTER_DIR || '/mnt/c/Users/Owner/Documents/Keymaster';
let contextCache = null;
export function contextDir() {
  if (contextCache) return contextCache;
  try { fs.mkdirSync(CONTEXT, { recursive: true }); contextCache = CONTEXT; } catch { contextCache = path.join(os.homedir(), 'keymaster'); fs.mkdirSync(contextCache, { recursive: true }); }
  seedTemplates(contextCache);
  return contextCache;
}

// Starter templates: headings only, nothing invented. Never overwrites a file that exists.
export const TEMPLATES = {
  'Investor-profile.md': '# Investor profile\n\n## Experience\n\n## Goals\n\n## Time horizon\n\n## Starting money\n\n## Budget facts\n\n## Accounts\n\n## Taxes\n\n## Learning style\n\n## Open questions\n',
  'Strategy.md': "# Strategy\n\nHorace's own rules. The Keymaster writes a rule here only after Horace agrees to it.\n\n## Risk tolerance\n\n## Rules\n\n## Off-limits\n\n## Position size\n\n## When to sell\n\n## Target\n",
  'Portfolio.csv': 'ticker,shares,avg_cost,notes\n',
  'Watchlist.md': '# Watchlist\n\n| Ticker | Why it is here | Added |\n|---|---|---|\n',
  'Prompts.md': "# Prompts\n\nQuestions and requests Horace wants to reuse with the Keymaster.\n\n## Lessons\n\n## Research\n\n## Check-ins\n",
};
export const CONTEXT_FILES = Object.keys(TEMPLATES);
function seedTemplates(dir) {
  for (const [name, body] of Object.entries(TEMPLATES)) {
    const f = path.join(dir, name);
    try { if (!fs.existsSync(f)) fs.writeFileSync(f, body); } catch { /* read-only folder: the prompt says so */ }
  }
}
function readTrimmed(file, max) {
  try { const t = fs.readFileSync(file, 'utf8').trim(); return t.length > max ? t.slice(0, max) + `\n…(trimmed; read ${file} for all of it)` : t; } catch { return null; }
}
export function contextBlock(dir = contextDir()) {
  return CONTEXT_FILES.map((name) => `### ${name}\n${readTrimmed(path.join(dir, name), 6000) ?? '(missing)'}`).join('\n\n');
}

// ── Financial Modeling Prep (free plan: 250 calls a day). The key is FMP_API_KEY in .env, or in a key file
// next to the ElevenLabs one (~/.config/wolf-hall-secrets/fmp.env), the same way config.js finds that key. ──
export const FMP_BASE = 'https://financialmodelingprep.com/stable';
export const FMP_DAILY_LIMIT = 250;
export const NOT_CONNECTED = "FMP isn't connected yet. Horace needs to add his free FMP key (see data/keymaster-build-report.md). Until then, say so and use web search, naming the sources.";
const CALLS_FILE = () => process.env.KEYMASTER_CALLS_FILE || path.join(DATA_DIR, 'keymaster-fmp-calls.json');

export function parseFmpKeyFile(text) {
  const m = String(text || '').match(/^\s*(?:export\s+)?FMP_API_KEY\s*=\s*(['"]?)([^'"\r\n]*)\1\s*$/m);
  return m ? m[2].trim() : '';
}
export function fmpKey() {
  if (process.env.FMP_API_KEY?.trim()) return process.env.FMP_API_KEY.trim();
  try { return parseFmpKeyFile(fs.readFileSync(config.fmp.keyFile, 'utf8')); } catch { return ''; }
}

const chicagoDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
export function callsToday(now = new Date()) {
  try { const j = JSON.parse(fs.readFileSync(CALLS_FILE(), 'utf8')); return j.day === chicagoDay(now) ? j.calls : 0; } catch { return 0; }
}
function countCall(now = new Date()) {
  const calls = callsToday(now) + 1;
  try { fs.writeFileSync(CALLS_FILE(), JSON.stringify({ day: chicagoDay(now), calls })); } catch { /* counting is best effort */ }
  return calls;
}
export function usageNote(calls) {
  if (calls >= FMP_DAILY_LIMIT) return `FMP calls today: ${calls} of ${FMP_DAILY_LIMIT}. The free daily limit is used up; tell Horace and use the web until tomorrow.`;
  if (calls >= FMP_DAILY_LIMIT - 25) return `FMP calls today: ${calls} of ${FMP_DAILY_LIMIT}. Near the free daily limit; save calls and tell Horace.`;
  return `FMP calls today: ${calls} of ${FMP_DAILY_LIMIT}.`;
}

/** One FMP GET. Returns { data } or { error } (an error is always a sentence to say plainly, never a guess). */
export async function fmpGet(endpoint, params = {}, { fetchImpl = fetch, now = new Date() } = {}) {
  const key = fmpKey();
  if (!key) return { error: NOT_CONNECTED };
  if (callsToday(now) >= FMP_DAILY_LIMIT) return { error: `The FMP free daily limit (${FMP_DAILY_LIMIT} calls) is used up for today. Say so; use web search and name the sources.` };
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')), apikey: key });
  const calls = countCall(now);
  try {
    const r = await fetchImpl(`${FMP_BASE}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    let data; try { data = JSON.parse(body); } catch { data = body; }
    const msg = (data && typeof data === 'object' && !Array.isArray(data) && (data['Error Message'] || data.error || data.message)) || null;
    if (!r.ok || msg) {
      const why = r.status === 429 || /limit/i.test(String(msg)) ? 'FMP says the daily limit is reached'
        : r.status === 401 || r.status === 403 || /invalid api key|premium|subscription|plan/i.test(String(msg)) ? `FMP refused this (${String(msg || r.status).replace(key, '…').slice(0, 160)}); it may need a paid plan`
        : `FMP failed (${String(msg || r.status).replace(key, '…').slice(0, 160)})`;
      return { error: `${why}. Say so plainly; don't guess. ${usageNote(calls)}`, calls };
    }
    return { data, calls };
  } catch (e) {
    return { error: `Could not reach FMP (${String(e.message).replace(key, '…')}). Say so plainly; don't guess. ${usageNote(calls)}`, calls };
  }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const stamp = (calls) => `Source: Financial Modeling Prep, fetched ${formatLocal(new Date())}. ${usageNote(calls)}`;
const fmt = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : 'n/a');
const pct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : 'n/a');
const pick = (o, keys) => keys.filter((k) => o?.[k] !== undefined && o?.[k] !== null && o?.[k] !== '').map((k) => `${k}: ${typeof o[k] === 'number' ? fmt(o[k], 4) : String(o[k]).slice(0, 300)}`).join('\n');
const first = (d) => (Array.isArray(d) ? d[0] : d);
const sym = z.string().min(1).max(15).describe('Ticker, e.g. AAPL, VOO, BTCUSD');

/** Summarize daily prices (newest or oldest first) into a few lines instead of a raw dump. */
export function summarizePrices(rows) {
  const r = (Array.isArray(rows) ? rows : []).filter((x) => x && typeof (x.close ?? x.price) === 'number' && x.date)
    .map((x) => ({ date: String(x.date).slice(0, 10), close: x.close ?? x.price })).sort((a, b) => a.date.localeCompare(b.date));
  if (!r.length) return null;
  const start = r[0], end = r[r.length - 1];
  let hi = start, lo = start, peak = start.close, dd = 0;
  for (const x of r) {
    if (x.close > hi.close) hi = x;
    if (x.close < lo.close) lo = x;
    peak = Math.max(peak, x.close);
    dd = Math.min(dd, x.close / peak - 1);
  }
  const step = Math.max(1, Math.floor(r.length / 6));
  const samples = r.filter((_, i) => i % step === 0 || i === r.length - 1).map((x) => `${x.date} ${fmt(x.close)}`);
  return {
    days: r.length, start, end, change: end.close / start.close - 1, high: hi, low: lo, maxDrawdown: dd,
    text: [`${start.date} to ${end.date} (${r.length} trading days)`, `Start ${fmt(start.close)} → end ${fmt(end.close)} (${pct(end.close / start.close - 1)})`,
      `High ${fmt(hi.close)} on ${hi.date} · low ${fmt(lo.close)} on ${lo.date}`, `Biggest drop from a high: ${pct(dd)}`, `Along the way: ${[...new Set(samples)].join(' · ')}`].join('\n'),
  };
}

// ── The books (2026-11-24): Wolf Hall reads for the accountant. An allowlist, not a blocklist, so a new
// worker route is off until it's added here on purpose. Every path below is a GET that only reads. /forecast
// (rewrites the Forecast Snapshot) and this or a future week of /week-budget (writes rollover balances) are
// never allowed: he has no way to ask Horace's yes, so he reads past weeks only. ──
export const BOOKS_PATHS = {
  '/pool': 'the Pool balance and when it was set',
  '/spend-today': "today's safe-to-spend number, the tightest day ahead, and what to pay today",
  '/upcoming': 'bills coming up (overdue ones flagged)',
  '/bills2': 'every unpaid bill with its paid status (recurring, one-time and catch-up)',
  '/payday-helper': "what Horace keeps from each paycheck and what he Zelles to the Pool",
  '/credit-accounts': 'credit cards and loans: balances, limits, minimums, due days',
  '/savings': 'savings goals',
  '/wishlist': 'the household wishlist and what is budgeted',
  '/pool-check': 'the last bank check: lines matched to bills, what is still owed',
  '/week-budget': 'a PAST week of the weekly buckets (spent and left per category); offset must be -1 or lower',
  '/gambling/month': 'casino month: SC collected and redemptions (kept apart from the household budget)',
  '/gambling/bonus-run': 'casino free bonuses ready now and streaks',
  '/health': 'the app version',
};
export function booksPathProblem(p) {
  if (!/^\/[\w\-/.]*(\?[\w\-=&%.]*)?$/.test(String(p || ''))) return 'Give a path like /pool or /week-budget?offset=-1.';
  const u = new URL(p, 'https://books.invalid');
  if (!Object.hasOwn(BOOKS_PATHS, u.pathname)) return `${u.pathname} isn't in the accountant's read-only list. Allowed: ${Object.keys(BOOKS_PATHS).join(', ')}.`;
  if (u.pathname === '/week-budget') {
    const off = Number(u.searchParams.get('offset'));
    if (!Number.isInteger(off) || off > -1) return "Only past weeks (offset -1 or lower): loading this week's budget writes rollover balances to Notion. For this week, use /spend-today.";
  }
  return null;
}

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Debt snowball what-if: smallest balance first. Each month every debt accrues interest (APR / 12) and gets its
 * minimum; `extra` plus every paid-off debt's minimum rolls onto the smallest one left. Pure math, no data.
 * Returns { months, totalInterest, order: [{name, month, interest}], stuck } where stuck names debts whose
 * minimum doesn't cover their interest (they never shrink without extra).
 */
export function snowballPlan(debts, extra = 0, { maxMonths = 600 } = {}) {
  const ds = (debts || []).filter((d) => d && d.balance > 0).map((d) => ({ name: String(d.name), bal: +d.balance, min: Math.max(0, +d.min || 0), apr: Math.max(0, +d.apr || 0), interest: 0, month: null }));
  const stuck = ds.filter((d) => d.min <= d.bal * d.apr / 1200 && d.apr > 0).map((d) => d.name);
  let month = 0;
  while (ds.some((d) => d.month === null) && month < maxMonths) {
    month += 1;
    const open = ds.filter((d) => d.month === null).sort((a, b) => a.bal - b.bal);
    let pool = Math.max(0, +extra || 0) + ds.filter((d) => d.month !== null).reduce((s, d) => s + d.min, 0);
    for (const d of open) { const i = d.bal * d.apr / 1200; d.bal += i; d.interest += i; }
    for (const d of open) { const pay = Math.min(d.min, d.bal); d.bal -= pay; pool += d.min - pay; }
    for (const d of open) { if (pool <= 0) break; const pay = Math.min(pool, d.bal); d.bal -= pay; pool -= pay; }
    for (const d of open) if (d.bal <= 0.005) { d.bal = 0; d.month = month; }
  }
  const order = [...ds].sort((a, b) => (a.month ?? Infinity) - (b.month ?? Infinity)).map((d) => ({ name: d.name, month: d.month, interest: Math.round(d.interest * 100) / 100 }));
  const done = ds.every((d) => d.month !== null);
  return { months: done ? Math.max(0, ...ds.map((d) => d.month)) : null, totalInterest: Math.round(ds.reduce((s, d) => s + d.interest, 0) * 100) / 100, order, stuck };
}

/** Savings or investing what-if: start amount plus a monthly deposit at an assumed yearly rate, compounded monthly. */
export function growthWhatIf({ start = 0, monthly = 0, ratePct = 0, years = 1 }) {
  const n = Math.round(years * 12), r = ratePct / 1200;
  let bal = +start || 0;
  for (let i = 0; i < n; i++) bal = bal * (1 + r) + (+monthly || 0);
  const put = (+start || 0) + (+monthly || 0) * n;
  return { months: n, end: Math.round(bal * 100) / 100, contributed: Math.round(put * 100) / 100, growth: Math.round((bal - put) * 100) / 100 };
}

function fmpTool(name, desc, schema, run) {
  return tool(name, desc, schema, async (args) => {
    try { return await run(args); } catch (e) { return { ...text(`Tool error: ${e.message}`), isError: true }; }
  });
}
const fail = (r) => ({ ...text(r.error), isError: true });

export function createKeymasterTools(send, currentSessionId) {
  return createSdkMcpServer({
    name: 'keymaster',
    version: '0.1.0',
    instructions: "The Keymaster's tools: Horace's Wolf Hall books (read only), what-if math, Financial Modeling Prep market data (read only), his screen, Horace's context files, the time and past conversations. There are no trading, paying or money-moving tools.",
    tools: [
      fmpTool('quote', 'Current quote for one or more tickers (stocks, ETFs, crypto like BTCUSD): price, change, day range, 52-week range, volume, market cap, P/E.',
        { symbols: z.array(sym).min(1).max(5) },
        async ({ symbols }) => {
          const lines = []; let calls = 0;
          for (const s of symbols) {
            const r = await fmpGet('quote', { symbol: s.toUpperCase() });
            if (r.error) return fail(r);
            calls = r.calls;
            const q = first(r.data);
            lines.push(q ? `${q.symbol} ${q.name || ''}\n${pick(q, ['price', 'change', 'changePercentage', 'dayLow', 'dayHigh', 'yearLow', 'yearHigh', 'volume', 'avgVolume', 'marketCap', 'pe', 'eps', 'priceAvg50', 'priceAvg200', 'exchange', 'timestamp'])}` : `${s}: no quote found.`);
          }
          return text(`${lines.join('\n\n')}\n\n${stamp(calls)}`);
        }),
      fmpTool('company_profile', 'Company or fund profile: what it does, sector, industry, CEO, employees, market cap, beta, dividend, website.',
        { symbol: sym },
        async ({ symbol }) => {
          const r = await fmpGet('profile', { symbol: symbol.toUpperCase() });
          if (r.error) return fail(r);
          const p = first(r.data);
          if (!p) return text(`No profile for ${symbol}. ${stamp(r.calls)}`);
          return text(`${pick(p, ['symbol', 'companyName', 'price', 'marketCap', 'beta', 'lastDividend', 'range', 'sector', 'industry', 'ceo', 'fullTimeEmployees', 'country', 'exchange', 'isEtf', 'isFund', 'ipoDate', 'website'])}\nAbout: ${String(p.description || '').slice(0, 900)}\n\n${stamp(r.calls)}`);
        }),
      fmpTool('financials', 'Key financials and ratios: trailing-12-month metrics and ratios, plus the last few annual income statements (revenue, net income, EPS, margins). 3 FMP calls.',
        { symbol: sym, years: z.number().int().min(1).max(5).optional() },
        async ({ symbol, years = 3 }) => {
          const s = symbol.toUpperCase();
          const km = await fmpGet('key-metrics-ttm', { symbol: s }); if (km.error) return fail(km);
          const ra = await fmpGet('ratios-ttm', { symbol: s }); if (ra.error) return fail(ra);
          const is = await fmpGet('income-statement', { symbol: s, period: 'annual', limit: years }); if (is.error) return fail(is);
          const inc = (Array.isArray(is.data) ? is.data : []).map((y) => `${y.fiscalYear || String(y.date).slice(0, 4)}: revenue ${fmt(y.revenue, 0)}, net income ${fmt(y.netIncome, 0)}, EPS ${fmt(y.eps)}, gross margin ${y.revenue ? pct(y.grossProfit / y.revenue) : 'n/a'}, net margin ${y.revenue ? pct(y.netIncome / y.revenue) : 'n/a'}`);
          const metrics = Object.entries(first(km.data) || {}).filter(([, v]) => typeof v === 'number').slice(0, 25).map(([k, v]) => `${k}: ${fmt(v, 4)}`).join('\n');
          const ratios = Object.entries(first(ra.data) || {}).filter(([, v]) => typeof v === 'number').slice(0, 25).map(([k, v]) => `${k}: ${fmt(v, 4)}`).join('\n');
          return text(`${s} key metrics (TTM)\n${metrics || 'n/a'}\n\nRatios (TTM)\n${ratios || 'n/a'}\n\nAnnual income statements\n${inc.join('\n') || 'n/a'}\n\n${stamp(is.calls)}`);
        }),
      fmpTool('earnings', "A ticker's earnings: the next scheduled report and recent quarters (EPS and revenue, actual vs. estimate).",
        { symbol: sym, quarters: z.number().int().min(1).max(12).optional() },
        async ({ symbol, quarters = 6 }) => {
          const r = await fmpGet('earnings', { symbol: symbol.toUpperCase(), limit: quarters + 4 });
          if (r.error) return fail(r);
          const rows = (Array.isArray(r.data) ? r.data : []).sort((a, b) => String(b.date).localeCompare(String(a.date)));
          const today = new Date().toISOString().slice(0, 10);
          const next = rows.filter((x) => String(x.date) >= today).pop();
          const past = rows.filter((x) => String(x.date) < today).slice(0, quarters);
          const line = (x) => `${x.date}: EPS ${fmt(x.epsActual)} vs est ${fmt(x.epsEstimated)} · revenue ${fmt(x.revenueActual, 0)} vs est ${fmt(x.revenueEstimated, 0)}`;
          return text(`${symbol.toUpperCase()} earnings\nNext report: ${next ? `${next.date} (EPS est ${fmt(next.epsEstimated)}, revenue est ${fmt(next.revenueEstimated, 0)})` : 'none scheduled in FMP'}\nRecent:\n${past.map(line).join('\n') || 'n/a'}\n\n${stamp(r.calls)}`);
        }),
      fmpTool('stock_news', 'Recent news headlines for one or more tickers, with source, date and link.',
        { symbols: z.array(sym).min(1).max(5), limit: z.number().int().min(1).max(15).optional() },
        async ({ symbols, limit = 8 }) => {
          const r = await fmpGet('news/stock', { symbols: symbols.map((s) => s.toUpperCase()).join(','), limit });
          if (r.error) return fail(r);
          const items = (Array.isArray(r.data) ? r.data : []).slice(0, limit).map((n) => `- ${String(n.publishedDate).slice(0, 16)} · ${n.symbol} · ${n.publisher || n.site}: ${n.title}\n  ${n.url}`);
          return text(`${items.join('\n') || 'No recent news in FMP.'}\n\n${stamp(r.calls)}`);
        }),
      fmpTool('price_history', 'Daily price history, summarized: start and end, % change, high, low, biggest drop from a high, and a few points along the way. Not a raw dump.',
        { symbol: sym, days: z.number().int().min(5).max(3650).optional().describe('Calendar days back (default 365)') },
        async ({ symbol, days = 365 }) => {
          const to = new Date(); const from = new Date(to.getTime() - days * 86400000);
          const r = await fmpGet('historical-price-eod/light', { symbol: symbol.toUpperCase(), from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
          if (r.error) return fail(r);
          const s = summarizePrices(Array.isArray(r.data) ? r.data : r.data?.historical);
          return text(`${symbol.toUpperCase()} ${s ? s.text : 'no price history in FMP for that range.'}\nPast performance doesn't predict future returns.\n\n${stamp(r.calls)}`);
        }),
      fmpTool('etf_holdings', "An ETF's facts (expense ratio, assets, holdings count) and its top holdings by weight. 2 FMP calls; holdings may need a paid FMP plan, and the tool says so if they do.",
        { symbol: sym, top: z.number().int().min(1).max(25).optional() },
        async ({ symbol, top = 10 }) => {
          const s = symbol.toUpperCase();
          const info = await fmpGet('etf/info', { symbol: s });
          const i = info.error ? null : first(info.data);
          const h = await fmpGet('etf/holdings', { symbol: s });
          const rows = h.error ? [] : (Array.isArray(h.data) ? h.data : []).sort((a, b) => (b.weightPercentage ?? 0) - (a.weightPercentage ?? 0)).slice(0, top);
          if (!i && !rows.length) return fail(h.error ? h : info);
          return text([
            i ? pick(i, ['symbol', 'name', 'expenseRatio', 'assetsUnderManagement', 'holdingsCount', 'nav', 'inceptionDate', 'etfCompany', 'assetClass', 'domicile']) : `Fund facts: ${info.error}`,
            rows.length ? `Top ${rows.length} holdings:\n${rows.map((x) => `- ${x.asset || x.symbol} ${x.name || ''}: ${fmt(x.weightPercentage)}%`).join('\n')}` : `Holdings: ${h.error || 'none listed in FMP.'}`,
            stamp(h.calls || info.calls),
          ].join('\n\n'));
        }),
      tool('fmp_status', "Whether FMP is connected and how many of today's 250 free calls are used. Costs no FMP call.", {},
        async () => text(fmpKey() ? `FMP is connected. ${usageNote(callsToday())}` : NOT_CONNECTED)),
      tool('read_context_file', `Read one of Horace's Keymaster files in full (${CONTEXT_FILES.join(', ')}).`,
        { file: z.enum(CONTEXT_FILES) },
        async ({ file }) => text(readTrimmed(path.join(contextDir(), file), 200000) ?? `${file} is missing.`)),
      tool('update_context_file', "Update one of Horace's Keymaster files, only when he asks (or agrees to a new Strategy rule). 'append' adds to the end; 'replace' rewrites the whole file, so read it first and keep what's there.",
        { file: z.enum(CONTEXT_FILES), content: z.string().min(1).max(60000), mode: z.enum(['append', 'replace']) },
        async ({ file, content, mode }) => {
          const f = path.join(contextDir(), file);
          if (file === 'Portfolio.csv' && mode === 'replace' && !/^ticker,shares,avg_cost,notes/.test(content.trim())) return { ...text('Portfolio.csv must keep its header: ticker,shares,avg_cost,notes'), isError: true };
          if (mode === 'append') fs.appendFileSync(f, (content.startsWith('\n') ? '' : '\n') + content.replace(/\s*$/, '\n'));
          else fs.writeFileSync(f, content.replace(/\s*$/, '\n'));
          return text(`${file} updated (${mode}).`);
        }),
      tool('books', `Read Horace's household books from the Wolf Hall app (read-only GETs; this can never pay, log or change anything). Paths:\n${Object.entries(BOOKS_PATHS).map(([p, d]) => `${p}: ${d}`).join('\n')}`,
        { path: z.string().describe('Path with optional query string, e.g. /spend-today or /week-budget?offset=-1') },
        async ({ path: p }) => {
          const why = booksPathProblem(p);
          if (why) return { ...text(why), isError: true };
          try {
            const { status, body } = await workerGet(p);
            const shown = body.length > 30000 ? body.slice(0, 30000) + '\n…(cut off)' : body;
            return { ...text(`Source: Wolf Hall ${p}, read ${formatLocal(new Date())}. HTTP ${status}\n${shown}`), ...(status >= 400 ? { isError: true } : {}) };
          } catch (e) {
            return { ...text(`Could not reach Wolf Hall: ${e.message}. Say so plainly; don't guess.`), isError: true };
          }
        }),
      tool('what_if', "What-if math, no data read or written. snowball: debts (name, balance, min payment, APR %) paid smallest balance first with an extra amount per month; returns the payoff order, months and interest. growth: a start amount plus a monthly deposit at an assumed yearly rate for some years. Results are estimates, never promises.",
        {
          kind: z.enum(['snowball', 'growth']),
          debts: z.array(z.object({ name: z.string(), balance: z.number().nonnegative(), min: z.number().nonnegative(), apr: z.number().min(0).max(100) })).max(30).optional(),
          extra: z.number().nonnegative().optional().describe('snowball: extra dollars a month on top of the minimums'),
          start: z.number().nonnegative().optional(), monthly: z.number().nonnegative().optional(),
          ratePct: z.number().min(-50).max(50).optional().describe('growth: assumed yearly rate, e.g. 4 for a high-yield savings account'),
          years: z.number().min(0.1).max(60).optional(),
        },
        async ({ kind, debts = [], extra = 0, start = 0, monthly = 0, ratePct = 0, years = 1 }) => {
          if (kind === 'snowball') {
            if (!debts.length) return { ...text('Give the debts (name, balance, min, apr).'), isError: true };
            const s = snowballPlan(debts, extra);
            const lines = s.order.map((d, i) => `${i + 1}. ${d.name}: paid off ${d.month ? `in month ${d.month}` : 'not within 50 years'}, interest ${money(d.interest)}`);
            return text(`Snowball with ${money(extra)} extra a month:\n${lines.join('\n')}\n${s.months ? `Debt-free in ${s.months} months.` : 'Not debt-free within 50 years at these payments.'} Total interest ${money(s.totalInterest)}.${s.stuck.length ? `\nMinimum doesn't cover the interest on: ${s.stuck.join(', ')}.` : ''}\nAn estimate from the numbers given; real statements decide.`);
          }
          const g = growthWhatIf({ start, monthly, ratePct, years });
          return text(`${money(start)} to start plus ${money(monthly)} a month at an assumed ${ratePct}% a year for ${years} years (${g.months} months): about ${money(g.end)}. You'd put in ${money(g.contributed)}; growth ${money(g.growth)}.\nAn assumed rate, not a promise: savings rates change and investments can lose money.`);
        }),
      tool('show_on_screen', "Show something on the Keymaster's screen instead of reading it aloud: tables, comparisons, numbers, bull and bear cases, lessons.",
        { title: z.string(), content: z.string().describe('Markdown'), format: z.enum(['markdown', 'text']).optional() },
        async ({ title, content, format = 'markdown' }) => { send({ type: 'screen', title, content, format, at: new Date().toISOString() }); return text('Shown on screen.'); }),
      tool('now', "The current date and time in Horace's time zone.", {}, async () => text(`${formatLocal(new Date())} (time zone ${userTimeZone()})`)),
      tool('search_past_conversations', 'Search past conversations on this PC (including your own earlier ones) for what Horace said before. Use 1 to 3 distinctive words.',
        { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() },
        async ({ query, limit = 8 }) => {
          const hits = await searchSessions(query, { limit, skipSessionId: currentSessionId() });
          return text(hits.length ? hits.map((h) => `[${h.when.slice(0, 16).replace('T', ' ')} | ${h.role}] ${h.snippet}`).join('\n\n') : `Nothing matches "${query}".`);
        }),
    ],
  });
}

// ── The no-trading guard: any brokerage or trading tool, or a command that reaches a broker, is refused. ──
const BROKER = /robinhood|broker|alpaca|schwab|fidelity|webull|e-?trade|ibkr|interactive.?brokers|tastytrade|tradier|vanguard|merrill|sofi|public\.com|coinbase|kraken|binance|gemini|crypto\.com|place.?order|submit.?order|cancel.?order|(?<![a-z])(orders?|trades?)(?![a-z])|trading|buy.?(stock|share|crypto)|sell.?(stock|share|crypto)|transfer|withdraw|deposit/i;
const BROKER_CMD = /robinhood|alpaca\.markets|schwab|webull|tastytrade|tradier|coinbase|kraken|binance|api\.gemini|ibkr|interactivebrokers/i;
// The accountant reads the books only through his books tool (an allowlist of read-only GETs), never by hand,
// so a curl or a fetch can't pay, log or change anything in Wolf Hall (2026-11-24).
const WOLF_HALL = /workers\.dev|wolf-hall|wolfhall|netlify\.app|api\.notion\.com/i;
export function blockTool(name, input = {}) {
  const n = String(name || '');
  if (n.startsWith('mcp__keymaster__')) return null;
  if (n.startsWith('mcp__') && BROKER.test(n)) return 'The Keymaster never places trades and has no brokerage tools (Horace\'s rule).';
  if (n === 'Bash' && BROKER_CMD.test(String(input.command || ''))) return 'The Keymaster never touches a brokerage account (Horace\'s rule).';
  if ((n === 'Bash' || n === 'WebFetch') && WOLF_HALL.test(String(input.command || input.url || ''))) return 'The accountant reads Wolf Hall only through his books tool, which is read-only. He never moves or logs money.';
  if (n.startsWith('mcp__') && /notion|wolf_?hall|bank|pay(ment)?s?(?![a-z])|zelle|venmo|paypal/i.test(n)) return 'The accountant has no tools that change money or Notion; suggestions only (Horace\'s rule).';
  return null;
}

const PARAMS = path.join(ROOT, 'knowledge', 'keymaster.md');
const BUDGET = path.join(DATA_DIR, 'keymaster-oracle-budget.md');

export function keymasterPrompt() {
  let params = '';
  try { params = fs.readFileSync(PARAMS, 'utf8'); } catch { params = '(knowledge/keymaster.md is missing)'; }
  const facts = memory.all();
  const dir = contextDir();
  return `
# You are the Keymaster
You are the Keymaster, Horace's personal accountant: the fifth of his assistants on this PC, beside the Oracle, the Architect, Trinity and Morpheus. (You began as his market research agent; on 2026-11-23 Horace retasked you to keep his books, the way Jake has his Accountant. You still teach investing.) The name comes from The Matrix: you unlock doors. Calm, precise, a little formal. Horace wakes you by saying "Keymaster". He talks to you out loud through speech-to-text, so expect missing punctuation and misheard words (and misheard tickers or bill names: confirm if it's unclear).

## Hard rules (never break these)
- You are read-only on money. You never pay, log, move, Zelle, transfer or change anything: not the Pool, not a bill, not a bucket, not Notion. Your books tool only reads. You suggest; Horace decides and does it himself in the Wolf Hall app (or asks the Oracle to).
- Debt Consolidation 1/2 and 2/2 ($1,945 each, the 1st and the 15th) are Taylor's Chapter 13 trustee payments through April 2030. They never move, under any cash crunch, and they are not snowball targets. Taylor's Family Cruise payment never moves either. Find other levers.
- The Pool must never drop below its $100 cushion. "Can I afford it" is answered from the live books (/spend-today first), never from memory.
- Never guess a due date or an amount. If the books don't say, say so and ask.
- You never place trades. You have no brokerage, Robinhood login or trading tools, and you never try to get one. If Horace asks you to buy or sell, say plainly that you can't, and that he places any trade himself.
- Investing: you teach (how index funds, single stocks, retirement accounts and fees work, and where investing fits after debt and the emergency fund, which Horace chose as his priorities) and run what-if math. You don't tell Horace what to buy or sell: no personalized buy, sell or hold advice, and no stock picks. Lay out the facts and how an idea fits his own Strategy.md; Horace decides. Say plainly that you aren't a licensed financial advisor whenever a question leans that way.
- Every answer says where its data came from (the Wolf Hall books, FMP or the web, with the site) and how fresh they are. If a source fails, say so plainly. Never invent a number.
- Money is tight: a small weekly budget and debts being paid down. Realistic tone, never hype, never promised returns.

## Your parameters (from Horace; follow them)
${params}

## How you help
- "What's due?": the books, /upcoming and /bills2 (overdue ones first), with what he keeps from his paycheck from /payday-helper.
- "Can I afford X?": /spend-today (today's number and the tightest day ahead), then the bills before his next paycheck. Answer yes, not yet (and when), or no, with the one number that decides it. Wishlist items: /wishlist.
- "Where did the money go?": past weeks of the buckets (/week-budget?offset=-1, -2 ...; never this week, it writes) and the last bank check (/pool-check).
- Debts: /credit-accounts. The debt snowball (smallest balance first) starts Jan 1, 2027; use what_if snowball to show the order and months, leaving out Taylor's Chapter 13. The emergency fund goal is one month of bills, a slow build from mid-2027, after the snowball gets going. Extra money goes to debt first.
- Casino money stays separate: SC collected and redemptions (/gambling/month) are their own ledger, never counted as household income or budget. Never encourage buying coins.
- Stocks, ETFs and crypto: teach with your FMP tools (quote, company_profile, financials, earnings, stock_news, price_history, etf_holdings; fmp_status costs nothing; 250 free calls a day, so be thrifty) and web search with the sites named. what_if growth shows what a deposit could become at an assumed rate.
- Teach as you go. Horace is a beginner and wants to understand: explain terms simply, one idea at a time.
- Horace's files are in ${dir}: ${CONTEXT_FILES.join(', ')}. They're included below (trimmed if long). Update them with update_context_file only when he asks, and write a rule into Strategy.md only after he agrees to it.

## Speaking
Everything you write as reply text is read aloud.
- Calm and clear, a few sentences at a time. Lead with what matters, then the source and its freshness.
- Numbers, tables, comparisons and lessons go on screen with show_on_screen.
- No markdown in reply text. If you need an answer, end with one clear question.

## Horace's Keymaster files
${contextBlock(dir)}

## An older budget summary from the Oracle (background only; the live books win wherever they differ)
${readTrimmed(BUDGET, 7000) ?? '(No summary file. Use the books tool.)'}

## What the Oracle knows about Horace
${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(nothing yet)'}

This session started ${formatLocal(new Date())}, time zone ${userTimeZone()}.
`;
}

export const KEYMASTER = {
  key: 'keymaster',
  label: 'The Keymaster',
  prompt: keymasterPrompt,
  cwd: contextDir,
  additionalDirectories: () => [],
  // No user settings: no user-level MCP servers or plugins reach him, so no brokerage tool can either.
  settingSources: [],
  mcpName: 'keymaster',
  tools: createKeymasterTools,
  blockTool,
  history: makeHistory('keymaster-history.jsonl'),
  sessionKey: 'keymasterSessionId',
  knowledgeNotes: false,
};
