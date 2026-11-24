// The Southern cook's voice loop (Wolf Hall v274): fences, sample download, one clip per job, failures reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ttsPathOk, processTts, voiceFile } from '../server/cookvoice.js';

const resp = (status, body, buf) => ({ ok: status < 300, status, json: async () => body, arrayBuffer: async () => buf || new ArrayBuffer(4) });

test('the cook voice only reaches its own routes', () => {
  assert.ok(ttsPathOk('/tts/pending'));
  assert.ok(ttsPathOk('/tts/voice/audio'));
  assert.ok(ttsPathOk('/tts/aaaaaaaa-0000-4000-8000-000000000001/done'));
  assert.ok(!ttsPathOk('/homestead'));
  assert.ok(!ttsPathOk('/pool'));
  assert.ok(!ttsPathOk('/tts/../pool'));
  assert.ok(!ttsPathOk('/tts/voice'));
});

test('the voice sample is downloaded once per recording', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  let n = 0;
  const fetcher = async () => { n++; return resp(200, null, new Uint8Array([1, 2, 3]).buffer); };
  const a = await voiceFile({ fileId: 'abc123xyz000', mime: 'audio/webm' }, { fetcher, dir });
  const b = await voiceFile({ fileId: 'abc123xyz000', mime: 'audio/webm' }, { fetcher, dir });
  assert.equal(a, b); assert.equal(n, 1); assert.ok(a.endsWith('.webm'));
});

test('each pending line is read and posted back; a failed line is reported, not retried forever', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  const posts = [];
  const fetcher = async (method, p, body) => {
    if (p === '/tts/pending') return resp(200, { voice: { fileId: 'voice0000001', mime: 'audio/mp4' }, jobs: [{ id: 'j1', text: 'Salt the chicken.' }, { id: 'j2', text: 'Bad line' }] });
    if (p === '/tts/voice/audio') return resp(200, null);
    posts.push([p, body]); return resp(200, { ok: true });
  };
  const reader = { say: async (text, voice, out) => { if (text === 'Bad line') return { ok: false, error: 'boom' }; fs.writeFileSync(out, Buffer.from('RIFFwav')); return { ok: true, out }; } };
  const r = await processTts({ fetcher, getReader: async () => reader, dir, log: { warn() {} } });
  assert.deepEqual(r, { made: 1, failed: 1 });
  assert.equal(posts[0][0], '/tts/j1/done'); assert.equal(Buffer.from(posts[0][1].audioBase64, 'base64').toString(), 'RIFFwav');
  assert.deepEqual(posts[1], ['/tts/j2/done', { failed: true, error: 'boom' }]);
  assert.ok(!fs.existsSync(path.join(dir, 'line-j1.wav')), 'the temp wav is cleaned up');
});

test('Wolf Hall v349: a dv: job is read with the designed clip, even with no cook sample yet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  const refDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvref-'));
  fs.writeFileSync(path.join(refDir, 'workshop-oracle.wav'), 'RIFF-fake');
  const posts = [], said = [];
  const fetcher = async (method, p, body) => {
    if (p === '/tts/pending') return resp(200, { voice: null, jobs: [
      { id: 'w1', text: 'Measure twice.', voice: 'dv:workshop-oracle' },
      { id: 'w2', text: 'Who knows.', voice: 'dv:../../etc' },
      { id: 'c1', text: 'Salt the chicken.', voice: 'voice0000001' }] });
    if (p === '/tts/voice/audio') throw new Error('no cook sample should be fetched');
    posts.push([p, body]); return resp(200, { ok: true });
  };
  const reader = { say: async (text, voice, out, opts) => { said.push({ text, voice, opts }); fs.writeFileSync(out, Buffer.from('RIFFwav')); return { ok: true, out }; } };
  const r = await processTts({ fetcher, getReader: async () => reader, dir, refDir, log: { warn() {} } });
  assert.deepEqual(r, { made: 1, failed: 1 }, 'the cook line waits for a sample (not counted, not failed)');
  assert.equal(said.length, 1);
  assert.equal(said[0].voice, path.join(refDir, 'workshop-oracle.wav'));
  assert.equal(said[0].opts.cfg, 0.4);
  assert.equal(posts[0][0], '/tts/w1/done');
  assert.deepEqual(posts[1], ['/tts/w2/done', { failed: true, error: 'unknown designed voice' }]);
  assert.ok(!posts.some(([p]) => p === '/tts/c1/done'), 'the cook line stays pending');
});

test('Wolf Hall v349: a missing designed clip fails that line; cook and designed lines mix in one pass', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  const refDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvref-'));
  const posts = [], said = [];
  const fetcher = async (method, p, body) => {
    if (p === '/tts/pending') return resp(200, { voice: { fileId: 'voice0000001', mime: 'audio/mp4' }, jobs: [
      { id: 'w1', text: 'Measure twice.', voice: 'dv:workshop-oracle' }, { id: 'c1', text: 'Salt the chicken.', voice: 'voice0000001' }] });
    if (p === '/tts/voice/audio') return resp(200, null);
    posts.push([p, body]); return resp(200, { ok: true });
  };
  const reader = { say: async (text, voice, out) => { said.push(voice); fs.writeFileSync(out, Buffer.from('RIFFwav')); return { ok: true, out }; } };
  const r = await processTts({ fetcher, getReader: async () => reader, dir, refDir, log: { warn() {} } });
  assert.deepEqual(r, { made: 1, failed: 1 });
  assert.deepEqual(posts[0], ['/tts/w1/done', { failed: true, error: 'no reference clip for workshop-oracle' }]);
  assert.equal(posts[1][0], '/tts/c1/done');
  assert.ok(said[0].endsWith('.m4a'), 'the cook line used the cook sample');
});

test('nothing pending, or no voice yet: nothing happens', async () => {
  const fetcher = async () => resp(200, { voice: null, jobs: [{ id: 'x', text: 'hi' }] });
  assert.deepEqual(await processTts({ fetcher, getReader: async () => { throw new Error('should not start'); } }), { made: 0, failed: 0 });
});
