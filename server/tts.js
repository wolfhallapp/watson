// ElevenLabs text-to-speech for Watson's voice. The API key stays on this
// machine: the browser asks Watson's server for audio, never ElevenLabs directly.
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
