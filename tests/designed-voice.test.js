// The designed voices (11/23): the Oracle's "dv:oracle" and Jake's "dv:workshop-oracle" are spoken by the shared
// Chatterbox reader from a reference clip in data/voices/ref. Uses a fake reader, so no GPU is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DESIGNED_VOICES, synthesizeDesigned, designedRef } from '../server/tts.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-'));
const ref = path.join(dir, 'ref');
fs.mkdirSync(ref);
fs.writeFileSync(path.join(ref, 'oracle.wav'), 'RIFF-fake');

test('both picked voices are listed', () => {
  assert.deepEqual(DESIGNED_VOICES.map((v) => v.id), ['oracle', 'workshop-oracle', 'trinity', 'pappy']);
  assert.equal(designedRef('oracle', ref), path.join(ref, 'oracle.wav'));
});

test('speaks with the reference clip and returns the wav', async () => {
  const calls = [];
  const reader = { async say(text, voice, out, opts) { calls.push({ text, voice, opts }); fs.writeFileSync(out, 'WAVDATA'); return { ok: true, out }; } };
  const r = await synthesizeDesigned('Hello, Neo.', 'oracle', 1.05, { getReader: async () => reader, dir: ref });
  assert.equal(r.ok, true);
  assert.equal(r.type, 'audio/wav');
  assert.equal(r.audio.toString(), 'WAVDATA');
  assert.equal(calls[0].voice, path.join(ref, 'oracle.wav'));
  assert.equal(calls[0].opts.speed, 1.05);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('out-')).length, 0, 'the temp clip is cleaned up');
});

test('unknown voice, missing clip and a failed reader all fail cleanly (the browser falls back)', async () => {
  assert.equal((await synthesizeDesigned('x', '../etc', 1, { getReader: async () => ({}), dir: ref })).status, 400);
  assert.equal((await synthesizeDesigned('x', 'workshop-oracle', 1, { getReader: async () => ({}), dir: ref })).status, 503);
  const bad = { async say() { return { ok: false, error: 'boom' }; } };
  const r = await synthesizeDesigned('x', 'oracle', 1, { getReader: async () => bad, dir: ref });
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
  const down = await synthesizeDesigned('x', 'oracle', 1, { getReader: async () => { throw new Error('reader exited 1'); }, dir: ref });
  assert.equal(down.status, 503);
});

test('a .qwen.wav reference (Trinity) goes to the Qwen clone reader with its transcript', async () => {
  fs.writeFileSync(path.join(ref, 'trinity.qwen.wav'), 'RIFF-fake');
  fs.writeFileSync(path.join(ref, 'trinity.qwen.txt'), 'Hey, Neo. It is me.');
  const calls = [];
  const reader = { async say(text, voice, out, opts) { calls.push({ voice, opts }); fs.writeFileSync(out, 'W'); return { ok: true }; } };
  const r = await synthesizeDesigned('Grace and peace.', 'trinity', 1, { getReader: async () => reader, dir: ref });
  assert.equal(r.ok, true);
  assert.equal(calls[0].voice, path.join(ref, 'trinity.qwen.wav'));
  assert.deepEqual(calls[0].opts, { ref_text: 'Hey, Neo. It is me.' });
});
