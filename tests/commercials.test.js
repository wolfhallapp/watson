// The family commercials (Night Shift #122): the spot checker, the timing, the ffmpeg graph and the jingle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkSpec, timeline, cameraMove, filterGraph, FPS } from '../scripts/commercials/build.mjs';
import { jingle, wavBuffer } from '../scripts/commercials/music.mjs';

const pappy = JSON.parse(fs.readFileSync(new URL('../scripts/commercials/pappy-skillet.json', import.meta.url)));

test("Pappy's spot passes the checker and runs 15-30 seconds", () => {
  assert.deepEqual(checkSpec(pappy), []);
  const total = pappy.scenes.reduce((a, s) => a + s.seconds, 0);
  assert.ok(total >= 15 && total <= 30);
});

test('the checker catches a broken spot', () => {
  assert.ok(checkSpec({ id: 'Bad Id', scenes: [] }).length >= 2);
  const long = { id: 'x', scenes: [{ prompt: 'p', say: 's', seconds: 40 }] };
  assert.match(checkSpec(long).join(), /15-30/);
  assert.match(checkSpec({ id: 'x', scenes: [{ say: 's', seconds: 20, zoom: 'spin' }] }).join(), /picture prompt.*zoom/s);
});

test('a scene stretches so its line always fits, and scenes follow each other', () => {
  const spec = { scenes: [{ seconds: 4 }, { seconds: 4 }] };
  const tl = timeline(spec, [2, 5]);
  assert.equal(tl[0].dur, 4);
  assert.ok(tl[1].dur >= 0.35 + 5 + 0.5 - 1 / FPS);
  assert.equal(tl[1].start, 4);
  assert.equal(tl[1].voiceAt, 4350);
  assert.equal(tl[0].frames, 120);
});

test('camera moves start and end where they should', () => {
  assert.equal(cameraMove('in', 31).z, '1+0.12*on/30');
  assert.equal(cameraMove('out', 31).z, '1.12-0.12*on/30');
  assert.match(cameraMove('pan', 31).x, /on\/30/);
});

test('the ffmpeg graph has every scene, every voice, the jingle and the pitch shift', () => {
  const tl = timeline(pappy, pappy.scenes.map(() => 3));
  const g = filterGraph(pappy, tl, { font: '/f.ttf', captionFiles: [['/c1.txt'], ['/c2a.txt', '/c2b.txt']], pitch: 0.84 });
  const n = pappy.scenes.length;
  for (let i = 0; i < n; i++) {
    assert.ok(g.includes(`[${i}:v]`) && g.includes(`[${n + i}:a]`) && g.includes(`[v${i}]`));
  }
  assert.ok(g.includes(`[${2 * n}:a]volume=`));
  assert.match(g, new RegExp(`concat=n=${n}:v=1:a=0`));
  assert.match(g, /asetrate=24000\*0\.84.*atempo=1\.1905/);
  assert.match(g, /textfile=\/c2b\.txt:fontsize=56/);
  assert.ok(!g.includes("PAPPY'S"), 'captions go through files, never inline text');
});

test('the jingle is a clean, quiet-at-the-edges WAV', () => {
  const s = jingle(2, 8000);
  assert.equal(s.length, 16000);
  assert.ok(s.every((v) => v >= -1 && v <= 1));
  assert.equal(s[0], 0);
  assert.ok(Math.abs(s.at(-1)) < 0.01);
  assert.ok(s.some((v) => Math.abs(v) > 0.2), 'it actually makes sound');
  const b = wavBuffer(s, 8000);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.readUInt32LE(24), 8000);
  assert.equal(b.length, 44 + s.length * 2);
});
