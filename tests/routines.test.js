// Checks when Watson's daily routines fire. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTINES, routineDue } from '../server/routines.js';

const scan = ROUTINES.find((r) => r.key === 'casinoOfferScan');

test('casino email check runs at 7:30 AM, 1 PM and 7 PM Central, once per slot', () => {
  assert.equal(routineDue(scan, new Date('2026-10-26T12:29:00Z'), null), null);                       // 7:29 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T12:30:00Z'), null), '2026-10-26@07:30');         // 7:30 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T15:00:00Z'), '2026-10-26@07:30'), null);         // already ran this slot
  assert.equal(routineDue(scan, new Date('2026-10-26T18:00:00Z'), '2026-10-26@07:30'), '2026-10-26@13:00'); // 1 PM
  assert.equal(routineDue(scan, new Date('2026-10-27T00:05:00Z'), '2026-10-26@13:00'), '2026-10-26@19:00'); // 7:05 PM
  assert.equal(routineDue(scan, new Date('2026-10-27T04:00:00Z'), '2026-10-26@13:00'), null);         // 11 PM: too late
  assert.equal(routineDue(scan, new Date('2026-12-10T13:30:00Z'), '2026-12-09@19:00'), '2026-12-10@07:30'); // 7:30 AM CST
  assert.equal(routineDue(scan, new Date('2026-12-10T12:30:00Z'), null), null);                       // 6:30 AM CST
  assert.equal(routineDue(scan, new Date('2026-10-27T08:30:00Z'), null), '2026-10-27@03:30');         // Tuesday 3:30 AM
});

test('the routine prompt keeps purchase offers out', () => {
  assert.match(scan.prompt, /no purchase/);
  assert.match(scan.prompt, /add_offers/);
  assert.match(scan.prompt, /Never add anything tied to buying/);
  assert.match(scan.prompt, /no recommendation to buy/);
});

test('the Night Shift picks its own task when the queue is empty (10/31)', () => {
  const night = ROUTINES.find((r) => r.key === 'nightShift');
  assert.doesNotMatch(night.guard.toString(), /readQueue/);
  assert.match(night.prompt, /IF THE QUEUE HAS NO UNCHECKED TASK, choose one yourself/);
  assert.match(night.prompt, /\(self-chosen\)/);
});
