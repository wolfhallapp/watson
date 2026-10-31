// Screens survive a restart (night shift 2026-10-30): the Oracle's and the Architect's last
// show_on_screen items are kept in data/screens.json; Trinity and Morpheus stay in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeScreenStore, SCREEN_LIMIT, SAVED_SCREENS } from '../server/store.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scr-')), 'screens.json');
const scr = (n) => ({ type: 'screen', title: `Item ${n}`, content: `body ${n}`, format: 'markdown', at: `2026-10-30T0${n % 10}:00:00.000Z` });

test('saved screens come back after a restart, per channel', () => {
  const f = tmpFile();
  const before = makeScreenStore(f);
  assert.ok(before.save('oracle', [scr(1), scr(2)]));
  assert.ok(before.save('architect', [scr(3)]));
  const after = makeScreenStore(f); // a fresh store reading the same file = Watson restarted
  assert.deepEqual(after.load('oracle'), [scr(1), scr(2)]);
  assert.deepEqual(after.load('architect'), [scr(3)]);
});

test('only the Oracle and the Architect are written to disk', () => {
  const f = tmpFile();
  const s = makeScreenStore(f);
  assert.deepEqual(SAVED_SCREENS, ['oracle', 'architect']);
  assert.equal(s.save('morpheus', [scr(1)]), false);
  assert.equal(s.save('trinity', [scr(1)]), false);
  assert.equal(fs.existsSync(f), false);
  assert.deepEqual(s.load('morpheus'), []);
});

test('keeps only the newest items, and saving one channel leaves the other alone', () => {
  const f = tmpFile();
  const s = makeScreenStore(f);
  s.save('architect', [scr(9)]);
  s.save('oracle', Array.from({ length: 12 }, (_, i) => scr(i)));
  const got = makeScreenStore(f).load('oracle');
  assert.equal(got.length, SCREEN_LIMIT);
  assert.equal(got[0].title, 'Item 4');
  assert.equal(got.at(-1).title, 'Item 11');
  assert.deepEqual(makeScreenStore(f).load('architect'), [scr(9)]);
});

test('a missing or broken file starts empty instead of crashing', () => {
  const f = tmpFile();
  assert.deepEqual(makeScreenStore(f).load('oracle'), []);
  fs.writeFileSync(f, '{not json');
  assert.deepEqual(makeScreenStore(f).load('oracle'), []);
  fs.writeFileSync(f, JSON.stringify({ oracle: [scr(1), null, { type: 'other' }, 'x'] }));
  assert.deepEqual(makeScreenStore(f).load('oracle'), [scr(1)]);
  fs.writeFileSync(f, '[1,2]');
  assert.deepEqual(makeScreenStore(f).load('oracle'), []);
  assert.ok(makeScreenStore(f).save('oracle', [scr(2)])); // and a broken file is repaired on the next save
  assert.deepEqual(makeScreenStore(f).load('oracle'), [scr(2)]);
});

test('the server loads saved screens at start and saves on every new screen', () => {
  const src = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(src, /oracle: \{[^}]*screens: screens\.load\('oracle'\)/);
  assert.match(src, /architect: \{[^}]*screens: screens\.load\('architect'\)/);
  assert.match(src, /screens\.save\(ch\.key, ch\.screens\)/);
});
