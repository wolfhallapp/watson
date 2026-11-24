// The Line (Wolf Hall v376): the Oracle & Trinity deck. Horace's questions go to his live agents; Taylor's to a walled-off
// session that only gets his own briefing and the shared church notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linePathOk, horaceAsk, taylorPrompt, taylorSystem, taylorBlock, processLine, askLiveAgent, lineDelay } from '../server/line.js';

test('only /line routes, only Horace or Taylor', () => {
  assert.ok(linePathOk('/line/pending'));
  assert.ok(linePathOk('/line/Taylor/abcdefgh1234'));
  assert.ok(!linePathOk('/line/Jake/abcdefgh1234'));
  assert.ok(!linePathOk('/bills2'));
  assert.ok(!linePathOk('/line/../bills2'));
});

test('Taylor\'s side may only search, read web pages and look up the Bible', () => {
  for (const ok of ['WebSearch', 'WebFetch', 'mcp__line__bible']) assert.equal(taylorBlock(ok), null);
  for (const no of ['Bash', 'Read', 'Write', 'mcp__watson__morning', 'mcp__claude_ai_Gmail__search']) assert.ok(taylorBlock(no));
});

test('Taylor\'s Oracle gets his briefing; his Trinity gets the shared church notes; neither gets the other', () => {
  const ctx = { briefing: { pool: 'B' }, church: { today: { ref: 'Psalm 23' } }, sharedPrayers: { items: [] } };
  const o = taylorPrompt({ agent: 'oracle', question: 'Good morning', morning: true, history: [] }, ctx);
  assert.match(o, /morning briefing/); assert.doesNotMatch(o, /Psalm 23/); assert.match(o, /Trinity has something for him/);
  const t = taylorPrompt({ agent: 'trinity', question: 'Good morning', morning: true, oracleSaid: 'Roads are clear.', history: [] }, ctx);
  assert.match(t, /Psalm 23/); assert.match(t, /Roads are clear/); assert.doesNotMatch(t, /"pool"/);
  assert.match(taylorSystem('oracle'), /no access to Horace's conversations/);
  assert.match(taylorSystem('trinity'), /Churches of Christ/);
});

test('Horace\'s prompts say he is away and listening, and Trinity follows the rundown', () => {
  assert.match(horaceAsk({ agent: 'oracle', question: 'good morning', morning: true }), /morning rundown/);
  assert.match(horaceAsk({ agent: 'trinity', question: 'good morning', morning: true, oracleSaid: 'X' }), /verse for the day/);
  assert.match(horaceAsk({ agent: 'oracle', question: 'what is due' }), /cannot see the PC screen or approve/);
});

test('processLine routes Horace to his live agents and Taylor to the walled-off runner', async () => {
  const calls = [];
  const fetcher = async (method, p, body) => {
    calls.push([method, p, body?.status]);
    if (p === '/line/pending') return { status: 200, body: '', json: { pending: [
      { person: 'Horace', id: 'aaaaaaaa01', agent: 'trinity', question: 'pray with me' },
      { person: 'Taylor', id: 'aaaaaaaa02', agent: 'oracle', question: 'Good morning', morning: true },
      { person: 'Jake', id: 'aaaaaaaa03', agent: 'oracle', question: 'sneaky' },
    ], taylor: { briefing: { x: 1 } } } };
    return { status: 200, body: '{}', json: {} };
  };
  const live = async (agent, prompt) => `${agent.name} heard: ${prompt.includes('pray with me')}`;
  const taylor = async (chat, ctx) => `**Morning** ${ctx.briefing.x}`;
  const n = await processLine({ agents: { oracle: { name: 'O' }, trinity: { name: 'T' } }, fetcher, live, taylor, log: { warn() {} } });
  assert.equal(n, 2);
  const answered = calls.filter((c) => c[2] === 'Answered').map((c) => c[1]);
  assert.deepEqual(answered, ['/line/Horace/aaaaaaaa01', '/line/Taylor/aaaaaaaa02']);
  assert.ok(!calls.some((c) => c[1].includes('Jake')));
});

test('a failed answer is marked Failed', async () => {
  const calls = [];
  const fetcher = async (method, p, body) => { calls.push([p, body?.status]); return p === '/line/pending' ? { status: 200, body: '', json: { pending: [{ person: 'Taylor', id: 'aaaaaaaa02', agent: 'trinity', question: 'hi' }] } } : { status: 200, body: '{}', json: {} }; };
  await processLine({ fetcher, taylor: async () => { throw new Error('down'); }, log: { warn() {} } });
  assert.deepEqual(calls.at(-1), ['/line/Taylor/aaaaaaaa02', 'Failed']);
});

test('askLiveAgent waits its turn and returns the reply text', async () => {
  const agent = { busy: true, onceDone: null, ask(p, origin) { assert.equal(origin, 'app'); setTimeout(() => this.onceDone(true, '', 'Here you go'), 5); } };
  setTimeout(() => { agent.busy = false; }, 20);
  const out = await askLiveAgent(agent, 'hi', { timeoutMs: 5000, waitMs: 10000 });
  assert.equal(out, 'Here you go');
});

test('polls fast in the early morning and right after a question, slower otherwise', () => {
  const at = (h) => new Date(`2026-11-24T${String(h + 6).padStart(2, '0')}:00:00Z`); // Central = UTC-6
  assert.equal(lineDelay(at(5), 0), 12000);
  assert.equal(lineDelay(at(14), 0), 45000);
  assert.equal(lineDelay(at(14), at(14).getTime() - 60000), 8000);
});
