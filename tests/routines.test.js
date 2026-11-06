// Checks when Watson's daily routines fire. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTINES, routineDue } from '../server/routines.js';

const scan = ROUTINES.find((r) => r.key === 'casinoOfferScan');

test('casino email check runs at 7:30 AM and 7 PM Central, once per slot', () => {
  assert.equal(routineDue(scan, new Date('2026-10-26T12:29:00Z'), null), null);                       // 7:29 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T12:30:00Z'), null), '2026-10-26@07:30');         // 7:30 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T15:00:00Z'), '2026-10-26@07:30'), null);         // already ran this slot
  assert.equal(routineDue(scan, new Date('2026-10-26T18:00:00Z'), '2026-10-26@07:30'), null); // 1 PM: no longer a slot
  assert.equal(routineDue(scan, new Date('2026-10-27T00:05:00Z'), '2026-10-26@07:30'), '2026-10-26@19:00'); // 7:05 PM
  assert.equal(routineDue(scan, new Date('2026-10-27T04:00:00Z'), '2026-10-26@07:30'), null);         // 11 PM: too late
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

test('the casino email check always passes emailId and saves the email\'s claim button (10/31)', () => {
  assert.match(scan.prompt, /emailId \(ALWAYS/);
  assert.match(scan.prompt, /claimLink/);
  assert.match(scan.prompt, /never a purchase, deposit or unsubscribe link/);
});

test('the casino email scrub relays only free SC or free spins (11/5)', () => {
  assert.match(scan.prompt, /FULL body/);
  assert.match(scan.prompt, /ONLY the ones that are actually free SC or free spins/);
  assert.match(scan.prompt, /GC-only promos/);
  assert.match(scan.prompt, /SENT in this window/);
  assert.match(scan.prompt, /SKIP standing site features/);
  assert.match(scan.prompt, /login streaks/);
  assert.match(scan.prompt, /keep "up to" in what/);
  for (const dropped of ['Splash Coins', 'Chanced', 'SlotsWise', 'Pulsz Bingo', 'Poly Casino']) assert.ok(scan.prompt.includes(dropped), dropped);
  assert.match(scan.prompt, /not in Casino Sites/);
  assert.match(scan.prompt, /the sites you skipped/);
});

test('the Night Shift picks its own task when the queue is empty (10/31)', () => {
  const night = ROUTINES.find((r) => r.key === 'nightShift');
  assert.doesNotMatch(night.guard.toString(), /readQueue/);
  assert.match(night.prompt, /IF THE QUEUE HAS NO UNCHECKED TASK, choose one yourself/);
  assert.match(night.prompt, /\(self-chosen\)/);
});
