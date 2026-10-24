// Checks that hands-free speech is collected until a pause, the way phone browsers
// deliver it: one "final" result per short pause. Uses a fake SpeechRecognition.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let rec = null;
globalThis.window = {
  webkitSpeechRecognition: class {
    constructor() { rec = this; }
    start() { this.onstart?.(); }
    abort() { this.onend?.(); }
    stop() { this.onend?.(); }
  },
};
const { Voice } = await import('../public/voice.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// One recognition event holding a single final (or interim) phrase.
const say = (t, isFinal = true) => rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal })] });
const make = () => {
  const sent = [];
  const v = new Voice({ onCommand: (t) => sent.push(t), onState: () => {} });
  v.endPauseMs = 60;
  v.setEnabled(true);
  return { v, sent };
};

test('a sentence split by pauses arrives as one command', async () => {
  const { sent } = make();
  say('Watson I need to');
  await wait(20);
  say('upload');
  await wait(20);
  say('the HEB receipt');
  await wait(30);
  assert.deepEqual(sent, []); // still inside the pause window
  await wait(60);
  assert.deepEqual(sent, ['I need to upload the HEB receipt']);
});

test('Android cumulative finals collapse to one sentence', async () => {
  const { sent } = make();
  for (const t of ['Watson I need', 'Watson I need', 'Watson I need to', 'Watson I need to upload', 'Watson I need to upload',
    'Watson I need to upload HEB', 'Watson I need to upload HEB online order receipt', 'Watson I need to upload HEB online order receipt cuz I can\'t get the actual receipt']) {
    say(t);
    await wait(5);
  }
  await wait(90);
  assert.deepEqual(sent, ["I need to upload HEB online order receipt cuz I can't get the actual receipt"]);
});

test('interim words keep the window open', async () => {
  const { sent } = make();
  say('Watson check');
  await wait(40);
  say('the forecast for', false); // still talking
  await wait(40);
  assert.deepEqual(sent, []);
  say('the forecast for next week');
  await wait(90);
  assert.deepEqual(sent, ['check the forecast for next week']);
});

test('wake word alone, then the command after it', async () => {
  const { v, sent } = make();
  say('Watson');
  assert.equal(v.state, 'awake');
  say('what is the pool');
  await wait(90);
  assert.deepEqual(sent, ['what is the pool']);
});

test('without the wake word nothing is sent', async () => {
  const { sent } = make();
  say('pass the salt');
  await wait(90);
  assert.deepEqual(sent, []);
});

test('turning the mic off drops a half-heard command', async () => {
  const { v, sent } = make();
  say('Watson delete');
  v.setEnabled(false);
  await wait(90);
  assert.deepEqual(sent, []);
});
