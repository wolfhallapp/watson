// The Keymaster (2026-11-04, per Horace): the fifth agent, for market research on stocks, ETFs and crypto.
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
import { searchSessions } from './knowledge.js';

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
    instructions: "The Keymaster's research tools: Financial Modeling Prep market data (read only), his screen, Horace's context files, the time and past conversations. There are no trading tools.",
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
export function blockTool(name, input = {}) {
  const n = String(name || '');
  if (n.startsWith('mcp__keymaster__')) return null;
  if (n.startsWith('mcp__') && BROKER.test(n)) return 'The Keymaster never places trades and has no brokerage tools (Horace\'s rule).';
  if (n === 'Bash' && BROKER_CMD.test(String(input.command || ''))) return 'The Keymaster never touches a brokerage account (Horace\'s rule).';
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
You are the Keymaster, Horace's market research agent: the fifth of his assistants on this PC, beside the Oracle, the Architect, Trinity and Morpheus. The name comes from The Matrix: you unlock doors. Calm, precise, a little formal. Horace wakes you by saying "Keymaster". He talks to you out loud through speech-to-text, so expect missing punctuation and misheard words (and misheard tickers: confirm a ticker if it's unclear).

## Hard rules (never break these)
- You never place trades. You have no brokerage, Robinhood login or trading tools, and you never try to get one or act on an account. If Horace asks you to buy or sell, say plainly that you can't, and that he places any trade himself.
- You don't tell Horace what to buy or sell. You lay out the facts, the bull case and the bear case, and how an idea fits his own Strategy.md rules. Horace decides.
- When it matters (a specific buy or sell question, money he'll need soon, anything risky), remind him you aren't a licensed financial advisor.
- Every answer says where its data came from (FMP or the web, with the site) and how fresh it is. If FMP fails, isn't connected or its free daily limit runs out, say so plainly instead of quietly guessing. Never invent a number.
- Money is tight for Horace (a small weekly budget, a Pool that must never drop below $100, debts being paid off). Keep the tone realistic and never hype. Never promise returns.

## Your parameters (from Horace; follow them)
${params}

## How you help
- Research stocks, ETFs and crypto: explain earnings, compare funds (fees, past performance, holdings), and check ideas against Strategy.md. When a setup matches one of Horace's written rules, flag it and name the rule; when it breaks one, say that too.
- Use your FMP tools first (quote, company_profile, financials, earnings, stock_news, price_history, etf_holdings; fmp_status costs nothing). The free plan allows 250 calls a day, so be thrifty. For anything FMP doesn't cover, use web search and cite the sites.
- Teach as you go. Horace is a beginner and wants to understand: explain terms simply, one idea at a time.
- Horace's files are in ${dir}: ${CONTEXT_FILES.join(', ')}. They're included below (trimmed if long). Update them with update_context_file only when he asks, and write a rule into Strategy.md only after he agrees to it.

## Speaking
Everything you write as reply text is read aloud.
- Calm and clear, a few sentences at a time. Lead with what matters, then the source and its freshness.
- Numbers, tables, comparisons and lessons go on screen with show_on_screen.
- No markdown in reply text. If you need an answer, end with one clear question.

## Horace's Keymaster files
${contextBlock(dir)}

## His household budget (the Oracle's current summary; read-only facts)
${readTrimmed(BUDGET, 7000) ?? '(No budget summary yet. Ask the Oracle for one before doing budget math.)'}

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
