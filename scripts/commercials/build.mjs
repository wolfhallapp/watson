// Stitches a family commercial for the kitchen TV: the scene stills (make_images.py) with a slow zoom or pan,
// big 80s captions, Pappy's voice-over (make_voice.py, pitched down), the jingle (music.mjs) and a VHS look.
// Usage: node scripts/commercials/build.mjs <spec.json> <workdir>   ->  <workdir>/<id>.mp4 (1920x1080, 30 fps)
// Everything stays in the git-ignored data folder: these spots are private to the household, never posted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { writeJingle } from './music.mjs';

export const FPS = 30;
export const W = 1920;
export const H = 1080;
const ZOOM = 0.12; // how far a scene pushes in or pulls out over its length

/** Checks a spot before any GPU time is spent on it. Returns a list of problems (empty when fine). */
export function checkSpec(spec) {
  const bad = [];
  if (!/^[a-z0-9-]+$/.test(spec?.id || '')) bad.push('id must be lowercase letters, digits and dashes');
  const scenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
  if (!scenes.length) bad.push('no scenes');
  scenes.forEach((s, i) => {
    if (!s.prompt) bad.push(`scene ${i + 1} has no picture prompt`);
    if (!s.say) bad.push(`scene ${i + 1} has no line to say`);
    if (!(s.seconds > 0)) bad.push(`scene ${i + 1} has no length`);
    if (s.zoom && !['in', 'out', 'pan'].includes(s.zoom)) bad.push(`scene ${i + 1} zoom must be in, out or pan`);
  });
  const total = scenes.reduce((a, s) => a + (s.seconds || 0), 0);
  if (scenes.length && (total < 15 || total > 30)) bad.push(`the spot runs ${total} s; keep it 15-30 s`);
  return bad;
}

/** When each scene starts and how long it lasts: the planned length, stretched so its line always fits. */
export function timeline(spec, voiceSeconds = [], lead = 0.35, tail = 0.5) {
  let start = 0;
  return spec.scenes.map((s, i) => {
    const dur = Math.round(Math.max(s.seconds, lead + (voiceSeconds[i] || 0) * 1 + tail) * FPS) / FPS;
    const t = { start: Math.round(start * 1000) / 1000, dur, frames: Math.round(dur * FPS), voiceAt: Math.round((start + lead) * 1000) };
    start += dur;
    return t;
  });
}

/** The zoompan expression for a scene's camera move over `frames` frames. */
export function cameraMove(kind, frames) {
  const p = `on/${Math.max(1, frames - 1)}`;
  if (kind === 'out') return { z: `${1 + ZOOM}-${ZOOM}*${p}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' };
  if (kind === 'pan') return { z: `${1 + ZOOM}`, x: `(iw-iw/zoom)*${p}`, y: 'ih/2-(ih/zoom/2)' };
  return { z: `1+${ZOOM}*${p}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' };
}

/**
 * The ffmpeg -filter_complex graph. Inputs: one still per scene (0..n-1), then one voice wav per scene (n..2n-1),
 * then the jingle (2n). `captionFiles[i]` is a list of text files (line 1 big, line 2 smaller) so no caption
 * ever needs ffmpeg's quote escaping.
 */
export function filterGraph(spec, tl, { font, captionFiles = [], pitch = 1, musicVolume = 0.16 }) {
  const n = spec.scenes.length;
  const parts = [];
  spec.scenes.forEach((s, i) => {
    const t = tl[i];
    const m = cameraMove(s.zoom, t.frames);
    const caps = (captionFiles[i] || []).map((f, j) =>
      `drawtext=fontfile=${font}:textfile=${f}:fontsize=${j ? 56 : 96}:fontcolor=${j ? 'white' : '#ffe14d'}` +
      `:borderw=${j ? 4 : 7}:bordercolor=#c0182a:x=(w-text_w)/2:y=h*${j ? 0.86 : 0.72}`);
    const fadeOut = Math.max(0, t.dur - 0.2).toFixed(3);
    parts.push(`[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
      `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${t.frames}:s=${W}x${H}:fps=${FPS},` +
      [...caps, `fade=t=in:st=0:d=0.2`, `fade=t=out:st=${fadeOut}:d=0.2`, 'setsar=1'].join(',') + `[v${i}]`);
  });
  // The VHS look: a little warm, a little saturated, with moving grain.
  parts.push(`${tl.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,eq=saturation=1.25:contrast=1.06,` +
    `colorbalance=rs=0.04:bs=-0.03,noise=alls=7:allf=t,format=yuv420p[vout]`);
  const tempo = (1 / pitch).toFixed(4);
  spec.scenes.forEach((_, i) => {
    const shift = pitch === 1 ? '' : `asetrate=24000*${pitch},aresample=48000,atempo=${tempo},`;
    parts.push(`[${n + i}:a]${shift}aresample=48000,highpass=f=90,acompressor=threshold=-18dB:ratio=3,` +
      `adelay=${tl[i].voiceAt}:all=1[a${i}]`);
  });
  parts.push(`[${2 * n}:a]volume=${musicVolume}[music]`);
  parts.push(`${tl.map((_, i) => `[a${i}]`).join('')}[music]amix=inputs=${n + 1}:normalize=0:duration=longest,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
  return parts.join(';\n');
}

function ffmpegBin() {
  const local = path.join(os.homedir(), 'splat-venv/bin/ffmpeg');
  return process.env.FFMPEG || (fs.existsSync(local) ? local : 'ffmpeg');
}

function seconds(file) {
  const probe = ffmpegBin().replace(/ffmpeg$/, 'ffprobe');
  return Number(execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

function fontFile() {
  for (const f of ['/mnt/c/Windows/Fonts/impact.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']) if (fs.existsSync(f)) return f;
  throw new Error('no caption font found');
}

export function build(specFile, dir, { take = 1 } = {}) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const bad = checkSpec(spec);
  if (bad.length) throw new Error(bad.join('; '));
  const n = spec.scenes.length;
  const imgs = spec.scenes.map((_, i) => path.join(dir, `scene-${i + 1}-take${spec.scenes[i].take || take}.png`));
  const voices = spec.scenes.map((_, i) => path.join(dir, `voice-${i + 1}.wav`));
  for (const f of [...imgs, ...voices]) if (!fs.existsSync(f)) throw new Error('missing ' + f);
  const pitch = spec.voice?.pitch || 1;
  const tl = timeline(spec, voices.map(seconds));
  const total = tl.at(-1).start + tl.at(-1).dur;
  const capDir = path.join(dir, 'captions');
  fs.mkdirSync(capDir, { recursive: true });
  const captionFiles = spec.scenes.map((s, i) => String(s.text || '').split('|').filter(Boolean).map((line, j) => {
    const f = path.join(capDir, `cap-${i + 1}-${j + 1}.txt`);
    fs.writeFileSync(f, line);
    return f;
  }));
  const music = writeJingle(path.join(dir, 'jingle.wav'), total + 0.5);
  const graph = filterGraph(spec, tl, { font: fontFile(), captionFiles, pitch });
  fs.writeFileSync(path.join(dir, 'filter.txt'), graph);
  const out = path.join(dir, `${spec.id}.mp4`);
  const args = ['-y', '-hide_banner', '-loglevel', 'error',
    ...imgs.flatMap((f) => ['-i', f]), ...voices.flatMap((f) => ['-i', f]), '-i', music,
    '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]',
    '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', out];
  execFileSync(ffmpegBin(), args, { stdio: 'inherit' });
  return { out, seconds: total, scenes: n };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const r = build(process.argv[2], process.argv[3], { take: Number(process.argv[4]) || 1 });
  console.log(`${r.out} (${r.seconds.toFixed(1)} s, ${r.scenes} scenes)`);
}
