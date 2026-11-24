// Checks when Watson's daily routines fire. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTINES, routineDue } from '../server/routines.js';

const scanReal = ROUTINES.find((r) => r.key === 'casinoOfferScan');
const scan = scanReal;

test('the casino email check is back on (Horace, 11/23 round 7: twice a day); the briefing still leaves casinos out (11/19)', () => {
  assert.notEqual(scanReal.off, true);
  assert.deepEqual(scanReal.times, [{ hour: 7, minute: 0 }, { hour: 20, minute: 0 }]);
  const brief = ROUTINES.find((r) => r.key === 'morningBriefing').prompt;
  assert.doesNotMatch(brief, /Casino deals:/);
  assert.doesNotMatch(brief, /the casino Bonus Run,/);
  assert.match(brief, /Leave out anything about casinos or gambling/);
});

test('casino email check runs at 7 AM and 8 PM Central, once per slot (11/23)', () => {
  assert.equal(routineDue(scan, new Date('2026-10-26T11:59:00Z'), null), null);                       // 6:59 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T12:00:00Z'), null), '2026-10-26@07:00');         // 7 AM CDT
  assert.equal(routineDue(scan, new Date('2026-10-26T15:00:00Z'), '2026-10-26@07:00'), null);         // already ran this slot
  assert.equal(routineDue(scan, new Date('2026-10-26T17:00:00Z'), '2026-10-26@07:00'), null);         // noon: no check any more
  assert.equal(routineDue(scan, new Date('2026-10-26T21:10:00Z'), '2026-10-26@07:00'), null);         // 4:10 PM: no check any more
  assert.equal(routineDue(scan, new Date('2026-10-27T01:05:00Z'), '2026-10-26@07:00'), '2026-10-26@20:00'); // 8:05 PM
  assert.equal(routineDue(scan, new Date('2026-10-27T01:30:00Z'), '2026-10-26@20:00'), null);         // already ran this slot
  assert.equal(routineDue(scan, new Date('2026-10-27T04:00:00Z'), '2026-10-26@20:00'), null);         // 11 PM: too late
  assert.equal(routineDue(scan, new Date('2026-12-10T13:00:00Z'), '2026-12-09@20:00'), '2026-12-10@07:00'); // 7 AM CST
  assert.equal(routineDue(scan, new Date('2026-12-10T12:30:00Z'), null), null);                       // 6:30 AM CST
  assert.equal(routineDue(scan, new Date('2026-10-27T08:30:00Z'), null), '2026-10-27@03:30');         // Tuesday 3:30 AM
  assert.match(scan.prompt, /it runs at 7 AM and 8 PM/);
  assert.match(scan.prompt, /Finish with history_sync[^.]*Gambling screen/);
});

test('the routine prompt keeps purchase offers out', () => {
  assert.match(scan.prompt, /no purchase/);
  assert.match(scan.prompt, /add_offers/);
  assert.match(scan.prompt, /update_deals/);
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

test('a failed casino check is retried in the same slot, 15 minutes apart, at most 8 times (11/12)', async () => {
  const { noteRoutineFailure, retryWaiting, clearRetries, RETRY_MS, RETRY_MAX } = await import('../server/routines.js');
  assert.equal(scan.retryOnFail, true);
  clearRetries();
  const k = '__retry_test__', slot = '2026-11-12@12:00', t0 = Date.parse('2026-11-12T18:00:00Z'); // never in routinesDone, so no state write
  assert.match(noteRoutineFailure(k, slot, '2026-11-12@07:00', 'rate_limit', t0), /will retry .*try 1 of 8/);
  assert.equal(retryWaiting(k, slot, t0 + RETRY_MS - 1), true);
  assert.equal(retryWaiting(k, slot, t0 + RETRY_MS), false);
  assert.equal(retryWaiting(k, '2026-11-12@16:00', t0), false); // the next slot is never held back
  for (let i = 2; i <= RETRY_MAX; i++) assert.match(noteRoutineFailure(k, slot, null, 'x', t0), new RegExp(`try ${i} of`));
  assert.match(noteRoutineFailure(k, slot, null, 'x', t0), /gave up/);
  assert.match(noteRoutineFailure(k, '2026-11-12@16:00', null, 'x', t0), /try 1 of/); // a new slot starts over
  clearRetries();
});

test('the Friday briefing reports the Claude upgrade date from the read-only route (11/19)', () => {
  const brief = ROUTINES.find((r) => r.key === 'morningBriefing');
  assert.match(brief.prompt, /On Fridays, also add a line starting "💻 Claude upgrade:"/);
  assert.match(brief.prompt, /GET \/upgrade-ready \(read-only, never \/forecast\)/);
  assert.match(brief.prompt, /needs one look to refresh it/);
});
