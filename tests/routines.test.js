// Checks when Watson's daily routines fire. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTINES, routineDue } from '../server/routines.js';

const scan = ROUTINES.find((r) => r.key === 'casinoOfferScan');

test('casino email check runs once, between 7:30 AM and noon Central', () => {
  assert.equal(routineDue(scan, new Date('2026-10-26T12:29:00Z'), null), null);           // 7:29 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T12:30:00Z'), null), '2026-10-26');   // 7:30 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T15:00:00Z'), '2026-10-26'), null);   // already ran today
  assert.equal(routineDue(scan, new Date('2026-10-26T17:00:00Z'), null), null);           // noon: too late
  assert.equal(routineDue(scan, new Date('2026-12-10T13:30:00Z'), '2026-12-09'), '2026-12-10'); // 7:30 AM CST
  assert.equal(routineDue(scan, new Date('2026-12-10T12:30:00Z'), null), null);           // 6:30 AM CST
});

test('the routine prompt keeps purchase offers out', () => {
  assert.match(scan.prompt, /no purchase/);
  assert.match(scan.prompt, /add_offers/);
  assert.match(scan.prompt, /Leave out anything tied to buying/);
});
