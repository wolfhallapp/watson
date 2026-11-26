// The clock-shift preload behind scripts/clock-ahead.mjs (Night Shift 2026-11-25). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'clock-shift.mjs');
const DAY = 86400000;
// Runs a snippet in a fresh node with the preload and CLOCK_SHIFT_DAYS, and returns what it printed as JSON.
const probe = (days, code) => JSON.parse(execFileSync(process.execPath, ['--import', PRELOAD, '--input-type=module', '-e', code],
  { env: { ...process.env, NODE_OPTIONS: '', CLOCK_SHIFT_DAYS: String(days) }, encoding: 'utf8' }));

// The child's real clock is performance.timeOrigin + performance.now() (the preload doesn't touch it), so these
// checks hold even when the sweep itself runs this file shifted.
const REAL = 'Math.round(performance.timeOrigin + performance.now())';

test('a shift moves now (Date.now, new Date(), Date()) ahead by whole days', () => {
  const r = probe(30, `console.log(JSON.stringify({ real: ${REAL}, now: Date.now(), nd: new Date().getTime(), str: Date.parse(Date()) }))`);
  for (const v of [r.now, r.nd]) assert.ok(Math.abs(v - r.real - 30 * DAY) < 5000, String(v - r.real));
  assert.ok(Math.abs(r.str - r.real - 30 * DAY) < 6000); // Date() as a string has whole seconds
});

test('dates built from a value stay put, and instanceof, UTC and parse still work', () => {
  const r = probe(7, `const d = new Date('2026-12-01T12:00:00Z'), p = new Date(2026, 11, 1);
    console.log(JSON.stringify({ iso: d.toISOString(), y: p.getFullYear(), inst: d instanceof Date, utc: Date.UTC(2026, 0, 1), parse: Date.parse('2026-01-01T00:00:00Z') }))`);
  assert.equal(r.iso, '2026-12-01T12:00:00.000Z');
  assert.equal(r.y, 2026);
  assert.equal(r.inst, true);
  assert.equal(r.utc, Date.UTC(2026, 0, 1));
  assert.equal(r.parse, Date.UTC(2026, 0, 1));
});

test('code run in a fresh vm context sees the same shift', () => {
  const r = probe(60, `import vm from 'node:vm';
    console.log(JSON.stringify({ real: ${REAL}, a: vm.runInNewContext('Date.now()'), b: vm.runInContext('new Date().getTime()', vm.createContext({})) }))`);
  for (const v of [r.a, r.b]) assert.ok(Math.abs(v - r.real - 60 * DAY) < 5000, String(v - r.real));
});

test('no shift (0 or unset) leaves Date alone', () => {
  const r = probe(0, `console.log(JSON.stringify({ real: ${REAL}, now: Date.now(), shifted: !!Date.__shifted }))`);
  assert.ok(Math.abs(r.now - r.real) < 5000);
  assert.equal(r.shifted, false);
});
