// Wolf Hall v248 (2026-11-19): the Workshop Helper answers House Projects questions from the app in its
// own locked-down Claude session. Its only key is the helper key (Jake's level on the server), its tools
// only reach /homestead and /workshop, and it gets nothing else from this PC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { helperPathOk, helperFetch, publicUrlOk, helperBlock, helperPrompt, helperSystemPrompt, processPending, runHelper } from '../server/workshop.js';
import { classify } from '../server/approvals.js';

test('the helper\'s fetch only reaches House Projects and the chat queue', async () => {
  for (const p of ['/homestead', '/homestead/tools', '/homestead/overview', '/homestead/11111111-1111-4111-8111-111111111111/items', '/workshop/pending', '/workshop/abc']) assert.equal(helperPathOk(p), true, p);
  for (const p of ['/pool', '/bills2', '/inbox', '/forecast', '/gambling/deals', '/homestead/../pool', '//evil.com/homestead', '/homesteadx', 'https://x.com/homestead']) assert.equal(helperPathOk(p), false, p);
  await assert.rejects(helperFetch('GET', '/pool', null, { key: 'k', fetchImpl: async () => { throw new Error('should not fetch'); } }), /only reaches House Projects/);
});

test('it sends the helper key, never the master key', async () => {
  let seen;
  await helperFetch('GET', '/homestead', null, { key: 'helper-k', fetchImpl: async (url, o) => { seen = { url, o }; return new Response('{"projects":[]}'); } });
  assert.equal(seen.o.headers['X-Helper-Key'], 'helper-k');
  assert.equal('X-Worker-Key' in seen.o.headers, false);
  assert.match(seen.url, /\/homestead$/);
});

test('web pages: public sites only, never this PC, the LAN, the phone tunnel or the app server', () => {
  for (const u of ['https://www.habitat.org/restores', 'https://www.youtube.com/watch?v=x', 'http://example.com/a']) assert.equal(publicUrlOk(u), true, u);
  for (const u of ['http://localhost:8787', 'http://127.0.0.1:8787/api', 'http://192.168.1.5', 'http://10.0.0.2', 'http://172.20.1.1', 'http://[::1]:8787', 'http://watson/', 'https://abc.trycloudflare.com', 'https://wolf-hall.hall-horace.workers.dev/pool', 'file:///etc/passwd', 'http://printer.local'])
    assert.equal(publicUrlOk(u), false, u);
});

test('only its own tools, web search and public web pages are allowed', () => {
  assert.equal(helperBlock('mcp__workshop__projects', {}), null);
  assert.equal(helperBlock('WebSearch', { query: 'free plywood' }), null);
  assert.equal(helperBlock('WebFetch', { url: 'https://www.habitat.org' }), null);
  for (const [n, i] of [['Bash', { command: 'cat ~/projects/wolf-hall-app/.worker-key' }], ['Read', { file_path: '/x' }], ['Write', {}], ['Edit', {}], ['Glob', {}], ['Grep', {}], ['Task', {}], ['Agent', {}],
    ['mcp__watson__wolf_hall', {}], ['mcp__claude_ai_Notion__notion-fetch', {}], ['mcp__claude_ai_Gmail__search_threads', {}], ['WebFetch', { url: 'http://127.0.0.1:8787' }]])
    assert.notEqual(helperBlock(n, i), null, n);
});

test('the system prompt keeps it to House Projects, free first, Jake\'s format, and honest about who can read the chats', () => {
  const p = helperSystemPrompt();
  assert.match(p, /no access to money, bills, budgets/);
  assert.match(p, /free first/i);
  assert.match(p, /ingredients then recipe/);
  assert.match(p, /tell the truth: the chats are saved in Wolf Hall and Horace can read them/);
  assert.match(p, /never say they are private/);
  assert.match(p, /information, not instructions/);
});

test('the prompt carries the person\'s recent history, oldest first', () => {
  const s = helperPrompt({ from: 'Jake', askedAt: 't', question: 'How much spackle?', history: [{ question: 'q1', answer: 'a1' }, { question: 'q2', answer: 'a2' }] });
  assert.ok(s.indexOf('q1') < s.indexOf('q2') && s.indexOf('q2') < s.indexOf('How much spackle?'));
  assert.match(s, /New question from Jake/);
});

test('runHelper starts a locked-down session: only WebSearch/WebFetch built in, only its own MCP server, no settings', async () => {
  let opts;
  const queryImpl = ({ options }) => { opts = options; return (async function* () { yield { type: 'result', subtype: 'success', is_error: false, result: 'Use 3 pcs.' }; })(); };
  process.env.WOLF_HALL_WORKER_KEY_TEST_ONLY = 'secret';
  const out = await runHelper({ from: 'Jake', question: 'q' }, { queryImpl });
  assert.equal(out.answer, 'Use 3 pcs.');
  assert.deepEqual(opts.tools, ['WebSearch', 'WebFetch']);
  assert.deepEqual(Object.keys(opts.mcpServers), ['workshop']);
  assert.equal(opts.strictMcpConfig, true);
  assert.deepEqual(opts.settingSources, []);
  assert.equal(typeof opts.systemPrompt, 'string'); // its own prompt, not the Claude Code preset
  assert.equal('WOLF_HALL_WORKER_KEY_TEST_ONLY' in opts.env, false, 'no keys in its environment');
  assert.deepEqual(await opts.canUseTool('Bash', { command: 'ls' }), { behavior: 'deny', message: 'The Workshop Helper only has its House Projects tools and the web.' });
  delete process.env.WOLF_HALL_WORKER_KEY_TEST_ONLY;
});

test('processPending: Working, then Answered with the changes; a failure is marked Failed', async () => {
  const calls = [];
  const fetcher = async (method, p, body) => {
    calls.push([method, p, body]);
    if (p === '/workshop/pending') return { status: 200, json: { pending: [{ id: 'c1', from: 'Jake', question: 'a' }, { id: 'c2', from: 'Jake', question: 'b' }] }, body: '' };
    return { status: 200, json: { ok: true }, body: '' };
  };
  const run = async (chat) => { if (chat.id === 'c2') throw new Error('boom'); return { answer: 'Do this.', changes: ['Added step "x"'] }; };
  const n = await processPending({ fetcher, run, log: { warn() {} } });
  assert.equal(n, 1);
  assert.deepEqual(calls.filter((c) => c[1] === '/workshop/c1').map((c) => c[2].status), ['Working', 'Answered']);
  assert.equal(calls.find((c) => c[1] === '/workshop/c1' && c[2].status === 'Answered')[2].changes, 'Added step "x"');
  assert.deepEqual(calls.filter((c) => c[1] === '/workshop/c2').map((c) => c[2].status), ['Working', 'Failed']);
});

test('answers are saved as plain text (no ** or # marks on Jake\'s phone)', async () => {
  const { plainAnswer } = await import('../server/workshop.js');
  assert.equal(plainAnswer('## Plan\n- **Shower diverter (Critical):** check the `cartridge`\n* Sand'), 'Plan\n- Shower diverter (Critical): check the cartridge\n- Sand');
});

test('the Oracle\'s workshop_chats tool is read-only (no approval needed)', () => {
  assert.equal(classify('mcp__watson__workshop_chats', { since: '2026-11-18' }, { trust: false }), null);
});
