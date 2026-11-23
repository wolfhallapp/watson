// The Accountant (11/22): Jake's own agent. Locked to his tree, web search and fetch; answers Jake's questions and plants
// his tree after the Initiation. Run: node --test tests/accountant.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountantPathOk, accountantBlock, accountantInput, accountantSystemPrompt, processAccountant, createAccountantTools, runAccountant } from '../server/accountant.js';

test('the Accountant only reaches /accountant routes', () => {
  assert.equal(accountantPathOk('/accountant/pending'), true);
  assert.equal(accountantPathOk('/accountant/tree'), true);
  assert.equal(accountantPathOk('/accountant/chat/0123456789abcdef0123456789abcdef'), true);
  for (const p of ['/bills2', '/homestead', '/accountant/../bills2', '/accountantx', '/vault', '/inbox/digest']) assert.equal(accountantPathOk(p), false, p);
});

test('only web search, web fetch and the ledger tools; no shell, files or other MCP', () => {
  assert.equal(accountantBlock('WebSearch'), null);
  assert.equal(accountantBlock('mcp__ledger__plant'), null);
  for (const t of ['Bash', 'Write', 'Edit', 'Read', 'Agent', 'mcp__workshop__projects', 'mcp__gmail__send']) assert.match(accountantBlock(t), /not allowed/, t);
});

test('the rules: legit only, 18+, no gambling/MLM/crypto/investing advice, never his bank or ID numbers, taxes mentioned, safety', () => {
  const p = accountantSystemPrompt();
  for (const s of ['No gambling', 'no MLMs', 'no crypto or forex trading', 'not a licensed advisor', 'never ask for or handle passwords, bank or card numbers', 'taxable', 'public places', 'NO vehicle', 'cottage-food', 'INTAKE:'])
    assert.ok(p.includes(s), s);
});

test('the request carries the dossier and recent history', () => {
  const s = accountantInput({ kind: 'Chat', question: 'How do I start flipping?', history: [{ question: 'hi', answer: 'hello' }] }, { archetype: { top: 'Builder' } });
  assert.match(s, /Earlier question: hi/); assert.match(s, /"top":"Builder"/); assert.match(s, /New question from Jake: How do I start flipping\?/);
  assert.doesNotMatch(accountantInput({ kind: 'Intake', question: 'INTAKE: x' }, {}), /New question/);
});

test('processAccountant: Working, then Answered with plain text and the change list; a failure is marked Failed', async () => {
  const calls = [];
  const fetcher = async (m, p, b) => { calls.push([m, p, b]); if (p === '/accountant/pending') return { status: 200, json: { pending: [{ id: 'aaa', kind: 'Chat', question: 'q1' }, { id: 'bbb', kind: 'Chat', question: 'q2' }], profile: { x: 1 } }, body: '' }; return { status: 200, json: { ok: true }, body: '' }; };
  let n = 0;
  const run = async (req) => { if (++n === 2) throw new Error('boom'); return { answer: '**Start** with this', changes: ['Planted: Dresser flips'] }; };
  const done = await processAccountant({ fetcher, run, log: {} });
  assert.equal(done, 1);
  const patches = calls.filter((c) => c[0] === 'PATCH');
  assert.deepEqual(patches.map((c) => [c[1], c[2].status]), [['/accountant/chat/aaa', 'Working'], ['/accountant/chat/aaa', 'Answered'], ['/accountant/chat/bbb', 'Working'], ['/accountant/chat/bbb', 'Failed']]);
  assert.equal(patches[1][2].answer, 'Start with this'); assert.equal(patches[1][2].changes, 'Planted: Dresser flips');
});

test('the plant tool posts one strategy to /accountant/tree and notes the change', async () => {
  const sent = [], changes = [];
  const server = createAccountantTools(changes, async (m, p, b) => { sent.push([m, p, b]); return { status: 200, json: { ok: true, strategy: { id: 'id1', name: b.name } }, body: '' }; });
  const plant = server.instance?._registeredTools?.plant || server.tools?.find?.((t) => t.name === 'plant');
  assert.ok(server, 'server made');
  if (plant && typeof plant.callback === 'function') {
    await plant.callback({ name: 'Dresser flips', branch: '2 Flip & resell', steps: ['Find one free dresser'] });
    assert.deepEqual(sent[0].slice(0, 2), ['POST', '/accountant/tree']); assert.equal(sent[0][2].action, 'plant'); assert.deepEqual(changes, ['Planted: Dresser flips (2 Flip & resell)']);
  }
});

// Night Shift #24 (11/23): the Sunday check-in. Wolf Hall queues a CHECKIN with the facts; the Accountant writes a short
// note with no tools at all, and Wolf Hall pushes it to Jake.
test('the Sunday check-in: its own rules, the facts as given, no tools at all', async () => {
  const p = accountantSystemPrompt();
  for (const s of ['CHECKIN:', 'under 60 words', 'exactly the number given', 'No tools']) assert.ok(p.includes(s), s);
  assert.doesNotMatch(accountantInput({ kind: 'Checkin', question: 'CHECKIN: facts' }, {}), /New question/);
  for (const t of ['WebSearch', 'WebFetch', 'mcp__ledger__plant', 'mcp__ledger__update', 'Bash']) assert.match(accountantBlock(t, 'Checkin'), /no tools/, t);
  assert.equal(accountantBlock('WebSearch', 'Chat'), null);
  let opts = null;
  const queryImpl = ({ options }) => { opts = options; return (async function* () { yield { type: 'result', subtype: 'success', result: 'This week: $12.50.\n1. DM 5 shops.\nOne step at a time.' }; })(); };
  const out = await runAccountant({ kind: 'Checkin', question: 'CHECKIN: x' }, {}, { queryImpl, fetcher: async () => { throw new Error('no fetch on a check-in'); } });
  assert.match(out.answer, /\$12\.50/); assert.deepEqual(out.changes, []);
  assert.deepEqual(opts.tools, []); assert.deepEqual(opts.mcpServers, {}); assert.equal(opts.maxTurns, 3); assert.equal(opts.effort, 'low'); assert.doesNotMatch(opts.model, /opus/);
  assert.equal((await opts.canUseTool('WebSearch', {})).behavior, 'deny');
});

test('a normal question still gets the ledger and web search', async () => {
  let opts = null;
  const queryImpl = ({ options }) => { opts = options; return (async function* () { yield { type: 'result', subtype: 'success', result: 'ok' }; })(); };
  await runAccountant({ kind: 'Chat', question: 'hi' }, {}, { queryImpl, fetcher: async () => ({ status: 200, json: {}, body: '' }) });
  assert.deepEqual(opts.tools, ['WebSearch', 'WebFetch']); assert.ok(opts.mcpServers.ledger); assert.equal(opts.maxTurns, 30);
  assert.equal((await opts.canUseTool('WebSearch', {})).behavior, 'allow');
});
