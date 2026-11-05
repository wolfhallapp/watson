// The Keymaster (2026-11-04): FMP calls and their daily count, the no-key reply, price summaries,
// the context folder templates, the prompt's hard rules, and the no-trading guard. No network: fetch is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymaster-'));
process.env.KEYMASTER_DIR = path.join(dir, 'ctx');
process.env.KEYMASTER_CALLS_FILE = path.join(dir, 'calls.json');
process.env.FMP_KEY_FILE = path.join(dir, 'no-such-key-file.env');
delete process.env.FMP_API_KEY;
const K = await import('../server/keymaster.js');

const okFetch = (body, status = 200) => async (url) => { okFetch.last = url; return { ok: status < 400, status, text: async () => JSON.stringify(body) }; };

test('without FMP_API_KEY the tools say FMP isn\'t connected yet, and no call is counted', async () => {
  const r = await K.fmpGet('quote', { symbol: 'AAPL' }, { fetchImpl: () => { throw new Error('should not fetch'); } });
  assert.match(r.error, /^FMP isn't connected yet/);
  assert.equal(K.callsToday(), 0);
});

test('with a key: calls the stable endpoint, counts calls per day, and warns near 250', async () => {
  process.env.FMP_API_KEY = 'test-key-not-real';
  try {
    const now = new Date('2026-11-04T18:00:00Z');
    const r = await K.fmpGet('quote', { symbol: 'VOO' }, { fetchImpl: okFetch([{ symbol: 'VOO', price: 500 }]), now });
    assert.equal(r.data[0].price, 500);
    assert.match(okFetch.last, /^https:\/\/financialmodelingprep\.com\/stable\/quote\?symbol=VOO&apikey=/);
    assert.equal(K.callsToday(now), 1);
    assert.match(K.usageNote(1), /1 of 250\.$/);
    assert.match(K.usageNote(230), /Near the free daily limit/);
    fs.writeFileSync(process.env.KEYMASTER_CALLS_FILE, JSON.stringify({ day: '2026-11-04', calls: 250 }));
    const capped = await K.fmpGet('quote', { symbol: 'VOO' }, { fetchImpl: () => { throw new Error('should not fetch'); }, now });
    assert.match(capped.error, /daily limit .* used up/);
    assert.equal(K.callsToday(new Date('2026-11-05T18:00:00Z')), 0, 'a new day starts at zero');
  } finally { delete process.env.FMP_API_KEY; }
});

test('FMP errors are said plainly and never leak the key', async () => {
  process.env.FMP_API_KEY = 'secret-abc-123';
  try {
    fs.rmSync(process.env.KEYMASTER_CALLS_FILE, { force: true });
    const r = await K.fmpGet('etf/holdings', { symbol: 'SPY' }, { fetchImpl: okFetch({ 'Error Message': 'Premium endpoint. secret-abc-123' }, 402) });
    assert.match(r.error, /paid plan/);
    assert.doesNotMatch(r.error, /secret-abc-123/);
    const lim = await K.fmpGet('quote', { symbol: 'X' }, { fetchImpl: okFetch({ 'Error Message': 'Limit Reach' }, 429) });
    assert.match(lim.error, /daily limit is reached/);
  } finally { delete process.env.FMP_API_KEY; }
});

test('a key file works like the ElevenLabs one', () => {
  assert.equal(K.parseFmpKeyFile("export FMP_API_KEY='abc'\n"), 'abc');
  assert.equal(K.parseFmpKeyFile('FMP_API_KEY=xyz'), 'xyz');
  assert.equal(K.parseFmpKeyFile('OTHER=1'), '');
});

test('price history is summarized, not dumped', () => {
  const rows = [
    { date: '2026-01-05', price: 100 }, { date: '2026-01-02', price: 90 }, { date: '2026-01-06', price: 120 },
    { date: '2026-01-07', price: 60 }, { date: '2026-01-08', price: 99 },
  ];
  const s = K.summarizePrices(rows);
  assert.equal(s.start.date, '2026-01-02');
  assert.equal(s.end.close, 99);
  assert.equal(s.high.close, 120);
  assert.equal(s.low.date, '2026-01-07');
  assert.equal(Math.round(s.maxDrawdown * 100), -50);
  assert.match(s.text, /Biggest drop from a high: -50\.0%/);
  assert.equal(K.summarizePrices([]), null);
});

test('the context folder gets heading-only templates and never overwrites Horace\'s files', () => {
  const d = K.contextDir();
  assert.equal(d, process.env.KEYMASTER_DIR);
  for (const f of K.CONTEXT_FILES) assert.ok(fs.existsSync(path.join(d, f)), f);
  assert.equal(fs.readFileSync(path.join(d, 'Portfolio.csv'), 'utf8'), 'ticker,shares,avg_cost,notes\n');
  fs.writeFileSync(path.join(d, 'Strategy.md'), '# Strategy\n- Rule 1: mine\n');
  K.contextDir();
  assert.match(K.contextBlock(d), /Rule 1: mine/);
});

test('the prompt carries the hard rules, his parameters and his files', () => {
  const p = K.keymasterPrompt();
  assert.match(p, /You are the Keymaster/);
  assert.match(p, /never place trades/);
  assert.match(p, /don't tell Horace what to buy or sell/);
  assert.match(p, /licensed financial advisor/);
  assert.match(p, /where its data came from/);
  assert.match(p, /never hype/i);
  assert.match(p, /Hard rules/); // knowledge/keymaster.md is included
  assert.match(p, /### Strategy\.md/);
});

test('no brokerage or trading tool ever gets through', () => {
  assert.equal(K.KEYMASTER.blockTool, K.blockTool);
  assert.deepEqual(K.KEYMASTER.settingSources, [], 'no user MCP servers or plugins');
  for (const n of ['mcp__robinhood__place_order', 'mcp__claude_ai_Robinhood__get_positions', 'mcp__alpaca__submit_order', 'mcp__coinbase__buy_crypto', 'mcp__x__trade'])
    assert.ok(K.blockTool(n), n);
  assert.ok(K.blockTool('Bash', { command: 'curl https://api.robinhood.com/orders/' }));
  assert.equal(K.blockTool('mcp__keymaster__quote'), null);
  assert.equal(K.blockTool('WebSearch', { query: 'VOO expense ratio' }), null);
  assert.equal(K.blockTool('Bash', { command: 'ls' }), null);
});

test('his own tools are research only', async () => {
  const server = K.createKeymasterTools(() => {}, () => null);
  const names = Object.keys(server.instance?._registeredTools || {});
  if (names.length) {
    for (const n of ['quote', 'company_profile', 'financials', 'earnings', 'stock_news', 'price_history', 'etf_holdings']) assert.ok(names.includes(n), n);
    for (const n of names) assert.doesNotMatch(n, /order|trade|buy|sell|broker|robinhood/i);
  }
});

test('the Keymaster page wakes on "Keymaster"', async () => {
  const { KEYMASTER_WAKE, setWakeWord, extractWake, ORACLE_WAKE } = await import('../public/voice.js');
  setWakeWord(KEYMASTER_WAKE);
  try {
    assert.deepEqual(extractWake('Keymaster what is an expense ratio'), { command: 'what is an expense ratio' });
    assert.deepEqual(extractWake('key master compare VOO and VTI'), { command: 'compare VOO and VTI' });
  } finally { setWakeWord(ORACLE_WAKE); }
});
