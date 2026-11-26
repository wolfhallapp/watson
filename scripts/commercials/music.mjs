// A cheesy 80s infomercial jingle, made from plain math so it is free and ours (no samples, no licenses).
// C - G - Am - F at 120 bpm: a square-wave bass, a soft chord pad, an arpeggio lead, a kick and a clap.
import fs from 'node:fs';

const CHORDS = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]]; // MIDI notes: C, G, Am, F
const hz = (n) => 440 * 2 ** ((n - 69) / 12);

/** Mono samples in -1..1 for `seconds` of the jingle at `sr` Hz. Deterministic. */
export function jingle(seconds, sr = 48000, bpm = 120) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const beat = 60 / bpm;
  let seed = 12345;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 31) - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const bar = Math.floor(t / (4 * beat));
    const chord = CHORDS[bar % CHORDS.length];
    const inBeat = t % beat;
    const eighth = Math.floor(t / (beat / 2));
    const inEighth = t % (beat / 2);
    // Bass: root on every eighth, octave up on the off-beats, short decay.
    const bassHz = hz(chord[0] - 12 + (eighth % 2 ? 12 : 0));
    let s = 0.22 * Math.sign(Math.sin(2 * Math.PI * bassHz * t)) * Math.exp(-inEighth * 6);
    // Pad: the three chord notes, gently detuned.
    for (const note of chord) s += 0.06 * (Math.sin(2 * Math.PI * hz(note + 12) * t) + Math.sin(2 * Math.PI * hz(note + 12) * 1.004 * t));
    // Lead: arpeggio up the chord, two octaves up, one note per eighth.
    const lead = chord[eighth % 3] + 24;
    s += 0.09 * Math.sin(2 * Math.PI * hz(lead) * t) * Math.exp(-inEighth * 8);
    // Kick on every beat (a falling sine), clap on 2 and 4 (a burst of noise).
    s += 0.5 * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-inBeat * 30)) * inBeat) * Math.exp(-inBeat * 12);
    if (Math.floor(t / beat) % 2 === 1) s += 0.18 * noise() * Math.exp(-inBeat * 25);
    // Fade in and out so it never clicks.
    const edge = Math.min(1, t / 0.3, (seconds - t) / 1.0);
    out[i] = Math.max(-1, Math.min(1, s * Math.max(0, edge)));
  }
  return out;
}

/** A 16-bit PCM mono WAV file for the samples. */
export function wavBuffer(samples, sr = 48000) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  return b;
}

export function writeJingle(file, seconds, sr = 48000) {
  fs.writeFileSync(file, wavBuffer(jingle(seconds, sr), sr));
  return file;
}
