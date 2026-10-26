// Checks the ElevenLabs voice path: reading the key file, playing replies with
// the cloud voice, and falling back when ElevenLabs fails. Uses a fake Audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const played = [];
globalThis.window = {};
globalThis.Audio = class {
  play() { played.push(this.src); setTimeout(() => this.onended?.(), 5); return Promise.resolve(); }
  pause() {}
};
const { Voice } = await import('../public/voice.js');
const { parseKeyFile } = await import('../server/tts.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const make = (fetchImpl, h = {}) => {
  const v = new Voice({ onState: () => {}, ...h });
  v.cloud = { defaultVoice: 'brianVoiceId123', fetch: fetchImpl };
  v.voiceName = 'el:brianVoiceId123'; // ElevenLabs only when picked by name (2026-10-25)
  return v;
};

test('key file parsing', () => {
  assert.equal(parseKeyFile("export ELEVENLABS_API_KEY='sk_abc123'\n"), 'sk_abc123');
  assert.equal(parseKeyFile('ELEVENLABS_API_KEY="sk_x"'), 'sk_x');
  assert.equal(parseKeyFile('# nothing here\nOTHER=1'), '');
});

test('automatic is the free browser voice; an ElevenLabs voice is used only when picked', () => {
  const v = make(async () => new Blob(['x']));
  assert.equal(v.cloudVoice(), 'brianVoiceId123');
  v.voiceName = '';
  assert.equal(v.cloudVoice(), null);
  v.voiceName = 'el:otherVoice456';
  assert.equal(v.cloudVoice(), 'otherVoice456');
  v.voiceName = 'Google UK English Male';
  assert.equal(v.cloudVoice(), null);
});

test('speaks every sentence through ElevenLabs, in order, then finishes', async () => {
  played.length = 0;
  const asked = [];
  const v = make(async (text, id, speed) => { asked.push({ text, id, speed }); return new Blob([text]); });
  v.speak('First sentence here. ' + 'x'.repeat(230) + '. Last one.', { wakeAfter: false });
  assert.equal(v.speaking, true);
  await wait(100);
  assert.equal(v.speaking, false);
  assert.equal(played.length, asked.length);
  assert.ok(asked.length >= 2);
  assert.equal(asked[0].id, 'brianVoiceId123');
  assert.equal(asked[0].speed, 1.05);
});

test('out of quota: says so once and stops using ElevenLabs', async () => {
  const notes = [];
  let calls = 0;
  const v = make(async () => { calls++; const e = new Error('quota'); e.status = 402; throw e; }, { onCloudOff: (m) => notes.push(m) });
  v.speak('Hello there.', { wakeAfter: false });
  await wait(30);
  assert.equal(v.speaking, false); // no browser voice in Node, so it just finishes
  assert.equal(v.cloudOff, true);
  assert.equal(notes.length, 1);
  v.speak('Again.', { wakeAfter: false });
  await wait(30);
  assert.equal(calls, 1);
});

test('a network blip falls back for that sentence only', async () => {
  const v = make(async () => { throw new Error('offline'); });
  v.speak('Hello.', { wakeAfter: false });
  await wait(30);
  assert.equal(v.cloudOff, false);
  assert.equal(v.speaking, false);
});

test('waits for Bluetooth headphones to settle after the mic is released', async () => {
  played.length = 0;
  const v = make(async (text) => new Blob([text]));
  v.settleMs = 80;
  v.running = true; // mic was listening, so speaking releases it
  v.speak('Hello.', { wakeAfter: false });
  await wait(40);
  assert.equal(played.length, 0);
  await wait(80);
  assert.equal(played.length, 1);
  // Typed with the mic already off: no pause.
  played.length = 0;
  v.running = false;
  v.micReleasedAt = 0;
  v.speak('Again.', { wakeAfter: false });
  await wait(20);
  assert.equal(played.length, 1);
});

test('stop during the settle pause plays nothing', async () => {
  played.length = 0;
  const v = make(async (text) => new Blob([text]));
  v.settleMs = 60;
  v.running = true;
  v.speak('Hello.', { wakeAfter: false });
  await wait(20);
  v.stopSpeaking();
  await wait(80);
  assert.equal(played.length, 0);
});

test('stop drops audio that arrives late', async () => {
  played.length = 0;
  const v = make(async (text) => { await wait(40); return new Blob([text]); });
  v.speak('One. Two.', { wakeAfter: false });
  v.stopSpeaking();
  await wait(80);
  assert.equal(played.length, 0);
  assert.equal(v.speaking, false);
});
