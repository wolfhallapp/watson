// ElevenLabs text-to-speech for the Oracle's voice. The API key stays on this
// machine: the browser asks the Oracle's server for audio, never ElevenLabs directly.
// If there's no key, or ElevenLabs fails, the browser falls back to its own voice.
import fs from 'node:fs';
import { config } from './config.js';

const API = 'https://api.elevenlabs.io/v1';

/** Read ELEVENLABS_API_KEY from an env-style file (`export ELEVENLABS_API_KEY='...'`). */
export function parseKeyFile(text) {
  const m = String(text || '').match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(['"]?)([^'"\r\n]*)\1\s*$/m);
  return m ? m[2].trim() : '';
}

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY?.trim()) return process.env.ELEVENLABS_API_KEY.trim();
  try { return parseKeyFile(fs.readFileSync(config.tts.keyFile, 'utf8')); } catch { return ''; }
}

export const ttsEnabled = () => !!apiKey();

let voicesCache = null;
/** The account's voices, as [{ id, name }]. Cached after the first successful call. */
export async function listVoices() {
  if (voicesCache) return voicesCache;
  const key = apiKey();
  if (!key) return [];
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`ElevenLabs voices failed (${res.status})`);
  const data = await res.json();
  voicesCache = (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return voicesCache;
}

/**
 * Turn text into speech. Returns { ok: true, audio: Buffer } or
 * { ok: false, status, error } where status 402 means the monthly quota is used up.
 */
export async function synthesize(text, voiceId, speed) {
  const key = apiKey();
  if (!key) return { ok: false, status: 503, error: 'No ElevenLabs key configured.' };
  const id = /^[A-Za-z0-9]{10,40}$/.test(voiceId || '') ? voiceId : config.tts.voiceId;
  const res = await fetch(`${API}/text-to-speech/${id}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: config.tts.model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, Number(speed) || 1)) },
    }),
  });
  if (res.ok) return { ok: true, audio: Buffer.from(await res.arrayBuffer()) };
  let detail = '';
  try { const j = await res.json(); detail = j.detail?.status || j.detail?.message || ''; } catch {}
  const quota = /quota|credits|limit/i.test(detail) || res.status === 402;
  return { ok: false, status: quota ? 402 : 502, error: `ElevenLabs ${res.status}${detail ? ': ' + detail : ''}` };
}

// ── Kokoro (2026-10-28): free, open-source, natural voices that run on this PC (no key, no limits) ──
// Loaded on first use (about 15 s, model cached after the first download), then one request at a time.
// Voice ids are sent as "kk:<voice>", e.g. kk:af_heart.
export const KOKORO_VOICES = [
  ['af_heart', 'Heart (warm American woman)'], ['af_bella', 'Bella (soft American woman)'], ['af_nicole', 'Nicole (gentle, hushed)'],
  ['af_sarah', 'Sarah (mature American woman)'], ['af_nova', 'Nova (clear American woman)'], ['af_sky', 'Sky (light American woman)'],
  ['bf_emma', 'Emma (British woman)'], ['bf_isabella', 'Isabella (British woman)'], ['bf_alice', 'Alice (British woman)'], ['bf_lily', 'Lily (British woman)'],
  ['am_michael', 'Michael (American man)'], ['am_adam', 'Adam (American man)'], ['am_onyx', 'Onyx (deep American man)'], ['am_eric', 'Eric (American man)'],
  ['bm_george', 'George (deep British man)'], ['bm_fable', 'Fable (British man)'], ['bm_daniel', 'Daniel (British man)'], ['bm_lewis', 'Lewis (British man)'],
  // Deeper, slower variants (2026-10-28, for the Oracle: an older, warm, wise woman). "~0.88" plays the voice at 88% speed,
  // which lowers its pitch and slows it, like an older voice. Not a copy of any real person's voice.
  ['af_nicole~0.88~r30', 'Oracle: Nicole, older, a little gravelly'], ['af_nicole~0.88~r55', 'Oracle: Nicole, older, more gravelly'],
  ['af_sarah~0.86', 'Oracle: Sarah, older and deeper'], ['am_onyx~0.9', 'Morpheus: Onyx, deep and slow'], ['af_heart~0.86', 'Heart, older and deeper'], ['af_nicole~0.88', 'Nicole, older and deeper'],
].map(([id, name]) => ({ id, name }));
const KOKORO_IDS = new Set(KOKORO_VOICES.map((v) => v.id));
// Gravel (Horace, 10/28: "a little more gravelly"): soft saturation for grit, a fast flutter in loudness
// for a rough, creaky edge, and a breath of noise that follows the voice. amount 0..1.
function rasp(wav, amount) {
  const b = Buffer.from(wav);
  if (!(amount > 0) || b.toString('ascii', 0, 4) !== 'RIFF' || b.readUInt16LE(20) !== 3 || b.readUInt16LE(34) !== 32) return b;
  const rate = b.readUInt32LE(24), start = 44, n = Math.floor((b.length - start) / 4);
  const drive = 1 + 3 * amount, norm = Math.tanh(drive);
  const depth = 0.25 * amount, breath = 0.12 * amount, w = 2 * Math.PI * 47 / rate;
  let env = 0, seed = 12345;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let i = 0; i < n; i++) {
    const o = start + i * 4, x = b.readFloatLE(o);
    env += (Math.abs(x) - env) * 0.01;
    const flutter = 1 - depth * (0.5 + 0.5 * Math.sin(w * i + 0.7 * Math.sin(w * 0.13 * i)));
    b.writeFloatLE((Math.tanh(x * drive) / norm) * flutter + noise() * env * breath, o);
  }
  return b;
}
// Kokoro comes out quiet (Nicole especially). Raise 32-bit float WAVs to a steady loudness, with a soft
// limiter so peaks never clip (Horace, 10/28: "louder").
function louden(wav, targetRms = 0.17) {
  const b = Buffer.from(wav);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.readUInt16LE(20) !== 3 || b.readUInt16LE(34) !== 32) return b;
  const start = 44, n = Math.floor((b.length - start) / 4);
  let sum = 0; for (let i = 0; i < n; i++) { const v = b.readFloatLE(start + i * 4); sum += v * v; }
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (!(rms > 0)) return b;
  const gain = Math.min(5, targetRms / rms);
  for (let i = 0; i < n; i++) { const o = start + i * 4; b.writeFloatLE(Math.tanh(b.readFloatLE(o) * gain), o); }
  return b;
}
// Lower pitch and pace by rewriting the WAV header's sample rate (plays the same samples slower).
function deepen(wav, factor) {
  const b = Buffer.from(wav);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || !(factor > 0.5 && factor < 1)) return b;
  const rate = b.readUInt32LE(24), blockAlign = b.readUInt16LE(32);
  const nr = Math.round(rate * factor);
  b.writeUInt32LE(nr, 24); b.writeUInt32LE(nr * blockAlign, 28);
  return b;
}
let kokoro = null;
let kokoroQueue = Promise.resolve();
async function kokoroModel() {
  if (!kokoro) {
    kokoro = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
    })().catch((e) => { kokoro = null; throw e; });
  }
  return kokoro;
}
/** { ok: true, audio: Buffer (wav), type } or { ok: false, status, error }. */
export function synthesizeKokoro(text, voice, speed) {
  const v = KOKORO_IDS.has(voice) ? voice : 'af_heart';
  const [base, ...mods] = v.split('~');
  const factor = Number(mods.find((m) => /^\d/.test(m))) || 1;
  const gravel = (Number((mods.find((m) => m.startsWith('r')) || '').slice(1)) || 0) / 100;
  const run = async () => {
    try {
      const tts = await kokoroModel();
      // Speak a little faster before deepening, so the slowed result keeps a natural pace.
      const sp = Math.min(1.4, Math.max(0.6, (Number(speed) || 1) / Math.sqrt(factor)));
      const out = await tts.generate(String(text).slice(0, 1000), { voice: base, speed: sp });
      const wav = louden(rasp(Buffer.from(out.toWav()), gravel));
      return { ok: true, audio: factor < 1 ? deepen(wav, factor) : wav, type: 'audio/wav' };
    } catch (e) { return { ok: false, status: 500, error: `Kokoro: ${e.message}` }; }
  };
  const p = kokoroQueue.then(run, run);
  kokoroQueue = p.catch(() => {});
  return p;
}
/** Warm the model up in the background so the first reply doesn't wait 15 seconds. */
export function warmKokoro() { kokoroModel().catch((e) => console.warn('  Kokoro warm-up:', e.message)); }
