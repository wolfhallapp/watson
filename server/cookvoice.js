// The Southern cook's voice for Wolf Hall's Cook mode (v274, Horace 11/22: "it needs to be a southern cook").
//
// Jake records a short sample in the app (with his OK). When someone opens Cook mode, the app asks the Worker
// for each step as a clip; the clip waits as "Pending" until this loop picks it up, reads it with Chatterbox
// (open source, MIT) on the PC's GPU in Jake's sample voice, and posts the wav back. Each line is made once
// and reused. It runs only while the PC and the Oracle are on; the app falls back to the phone's own voice.
//
// It uses the Workshop Helper's key, and only ever calls the /tts routes (its own fence below). It never
// touches the helper's Claude session or its tools.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';
import { WORKER_URL } from './knowledge.js';
import { helperKey } from './workshop.js';
import { designedRef, isDesignedVoice, DESIGNED_SAY } from './tts.js';

export const VOICE_DIR = path.join(DATA_DIR, 'cookvoice');
export const PYTHON = process.env.WATSON_TTS_PYTHON || path.join(os.homedir(), 'tts', '.venv', 'bin', 'python');
const SERVE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cookvoice_serve.py');

/** Only the cook-voice routes. */
export function ttsPathOk(p) { return /^\/tts\/(pending|voice\/audio|[0-9a-f-]{32,36}\/done)$/i.test(p); }
export async function ttsFetch(method, p, body, { fetchImpl = fetch, key = helperKey() } = {}) {
  if (!ttsPathOk(p)) throw new Error('The cook voice only reaches its own routes');
  if (!key) throw new Error('No helper key');
  return fetchImpl(WORKER_URL + p, { method, headers: { 'X-Helper-Key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
}

/** The one long-lived Chatterbox process (the model loads once, ~30 s). */
export function startReader({ spawnImpl = spawn } = {}) {
  const child = spawnImpl(PYTHON, [SERVE], { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = [];
  let ready, readyFail;
  const readyP = new Promise((res, rej) => { ready = res; readyFail = rej; });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.ready) { ready(m); return; }
    if (typeof m.ok !== 'boolean') return; // only our answers
    const w = waiting.shift(); if (w) w(m);
  });
  child.stderr.on('data', () => {}); // model download progress etc.
  child.on('exit', (code) => { readyFail(new Error('reader exited ' + code)); while (waiting.length) waiting.shift()({ ok: false, error: 'reader stopped' }); reader = null; });
  return {
    ready: readyP,
    say(text, voice, out, opts = {}) { return new Promise((res) => { waiting.push(res); child.stdin.write(JSON.stringify({ ...opts, text, voice, out }) + '\n'); }); },
    stop() { try { child.kill(); } catch { /* */ } },
  };
}
let reader = null;
/** The one shared Chatterbox reader (Cook mode and the Oracle's designed voices use the same loaded model). */
export async function sharedReader() {
  if (!reader) reader = startReader();
  const r = reader;
  await r.ready;
  return r;
}

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'm4a', 'audio/wav': 'wav' };
/** The voice sample, downloaded once per recording (a new recording has a new file id). */
export async function voiceFile(voice, { fetcher = ttsFetch, dir = VOICE_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `sample-${voice.fileId}.${EXT[voice.mime] || 'webm'}`);
  if (fs.existsSync(f)) return f;
  const r = await fetcher('GET', '/tts/voice/audio');
  if (!r.ok) throw new Error('could not download the voice sample: ' + r.status);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}

const isDv = (job) => String(job.voice || '').startsWith('dv:');
/** One pass: make every pending clip. Returns how many were made / failed. */
export async function processTts({ fetcher = ttsFetch, getReader = sharedReader, dir = VOICE_DIR, refDir, log = console } = {}) {
  const r = await fetcher('GET', '/tts/pending');
  if (!r.ok) return { made: 0, failed: 0, skipped: r.status };
  const d = await r.json();
  // Wolf Hall v349: a job whose voice is "dv:<id>" (Jake's Workshop Oracle) is read with that designed voice's picked
  // clip (data/voices/ref), not the cook sample, so it never waits on a cook recording. Cook lines still wait for one.
  const jobs = (d.jobs || []).filter((job) => isDv(job) || d.voice);
  if (!jobs.length) return { made: 0, failed: 0 };
  const sample = d.voice && jobs.some((job) => !isDv(job)) ? await voiceFile(d.voice, { fetcher, dir }) : null;
  fs.mkdirSync(dir, { recursive: true });
  const rd = await getReader();
  let made = 0, failed = 0;
  for (const job of jobs) {
    const out = path.join(dir, `line-${job.id}.wav`);
    let res;
    if (isDv(job)) {
      const id = String(job.voice).slice(3), ref = designedRef(id, refDir);
      if (!isDesignedVoice(id)) res = { ok: false, error: 'unknown designed voice' };
      else if (!fs.existsSync(ref)) res = { ok: false, error: `no reference clip for ${id}` };
      else res = await rd.say(job.text, ref, out, DESIGNED_SAY);
    } else res = await rd.say(job.text, sample, out);
    if (res.ok && fs.existsSync(out)) {
      const b64 = fs.readFileSync(out).toString('base64');
      const p = await fetcher('POST', `/tts/${job.id}/done`, { audioBase64: b64 });
      if (p.ok) made++; else { failed++; log.warn?.('[cookvoice] post failed', p.status); }
      try { fs.unlinkSync(out); } catch { /* */ }
    } else {
      failed++;
      await fetcher('POST', `/tts/${job.id}/done`, { failed: true, error: res.error || 'no audio' });
    }
  }
  return { made, failed };
}

let started = false;
export function startCookVoice({ every = 3000 } = {}) {
  if (started || process.env.WATSON_COOKVOICE === 'off') return false;
  if (!helperKey()) return false;
  if (!fs.existsSync(PYTHON)) { console.log('  Cook voice: off (no Chatterbox environment at ~/tts/.venv yet).'); return false; }
  started = true;
  let busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try { const r = await processTts(); if (r.made || r.failed) console.log(`[cookvoice] made ${r.made}, failed ${r.failed}`); }
    catch (e) { if (!/fetch failed|aborted|timeout/i.test(e.message)) console.warn('[cookvoice]', e.message); }
    finally { busy = false; }
  }, every);
  console.log('  Cook voice: on (Chatterbox on the GPU, checks every 3s).');
  return true;
}
