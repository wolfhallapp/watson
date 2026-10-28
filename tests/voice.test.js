// Checks the wake word, spoken yes/no answers and how replies are made speakable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWake, parseYesNo, toSpeakable, setWakeWord, ARCHITECT_WAKE, ORACLE_WAKE } from '../public/voice.js';

test('wake word', () => {
  assert.deepEqual(extractWake('Watson what bills are due this week'), { command: 'what bills are due this week' });
  assert.deepEqual(extractWake('hey Watson, check the forecast'), { command: 'check the forecast' });
  assert.deepEqual(extractWake('what son deploy the fix'), { command: 'deploy the fix' });
  assert.deepEqual(extractWake('Watson'), { command: '' });
  assert.equal(extractWake("what's on the calendar today"), null);
  assert.equal(extractWake('pass the salt'), null);
  // Her name since 2026-10-25.
  assert.deepEqual(extractWake('Oracle what is in the pool'), { command: 'what is in the pool' });
  assert.deepEqual(extractWake('hey oracle, set a reminder'), { command: 'set a reminder' });
  assert.deepEqual(extractWake('The Oracle check my bonus run'), { command: 'check my bonus run' });
  assert.deepEqual(extractWake('Oracle'), { command: '' });
  assert.equal(extractWake('the oral exam is tomorrow'), null);
});

test('yes and no answers', () => {
  assert.deepEqual(parseYesNo('Yes'), { answer: true, always: false });
  assert.deepEqual(parseYesNo('yeah go ahead'), { answer: true, always: false });
  assert.deepEqual(parseYesNo('Watson, do it'), { answer: true, always: false });
  assert.deepEqual(parseYesNo('yes always'), { answer: true, always: true });
  assert.equal(parseYesNo('no').answer, false);
  assert.equal(parseYesNo('nope').answer, false);
  assert.equal(parseYesNo('no, deploy only the frontend instead').rest, 'deploy only the frontend instead');
  assert.equal(parseYesNo('what does that command do'), null);
});

test('speakable text drops code, links and markdown', () => {
  const chunks = toSpeakable('**Done.** I changed `index.html`.\n```js\nconst a = 1;\n```\nSee https://example.com for more.');
  const said = chunks.join(' ');
  assert.ok(!said.includes('const a'));
  assert.ok(!said.includes('**'));
  assert.ok(!said.includes('https://'));
  assert.ok(said.includes('code is on screen'));
  assert.ok(toSpeakable('word '.repeat(400)).join(' ').endsWith('The rest is on screen.'));
});

test('the Architect page wakes on "Architect", not "Oracle"', () => {
  setWakeWord(ARCHITECT_WAKE);
  try {
    assert.deepEqual(extractWake('Architect grow the found money branch'), { command: 'grow the found money branch' });
    assert.deepEqual(extractWake('hey architect, where do I start'), { command: 'where do I start' });
    assert.deepEqual(extractWake('Architect'), { command: '' });
    assert.equal(extractWake('Oracle what is in the pool'), null);
    assert.equal(extractWake('the architecture of the house'), null);
    assert.deepEqual(parseYesNo('Architect, yes'), { answer: true, always: false });
  } finally { setWakeWord(ORACLE_WAKE); }
});

test('code words: red pill, free your mind, blue pill', () => {
  assert.deepEqual(parseYesNo('red pill'), { answer: true, always: false });
  assert.deepEqual(parseYesNo('Oracle, red pill'), { answer: true, always: false });
  assert.deepEqual(parseYesNo('free your mind'), { answer: true, always: false });
  assert.equal(parseYesNo('blue pill').answer, false);
  assert.equal(parseYesNo('blue pill, deploy only the worker instead').rest, 'deploy only the worker instead');
});

test('the Trinity page wakes on "Trinity"', async () => {
  const { TRINITY_WAKE } = await import('../public/voice.js');
  setWakeWord(TRINITY_WAKE);
  try {
    assert.deepEqual(extractWake('Trinity what does Acts 2 38 mean'), { command: 'what does Acts 2 38 mean' });
    assert.equal(extractWake('Oracle what is in the pool'), null);
  } finally { setWakeWord(ORACLE_WAKE); }
});
