// Persephone (2026-11-06): her email ledger, pattern math, site matching, the no-buying guard, the routine
// gate, the prompt's house rules and that the email check is hers now. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persephone-'));
process.env.PERSEPHONE_DIR = dir;
const P = await import('../server/persephone.js');
const { unattendedBlock } = await import('../server/agent.js');
const { ROUTINES } = await import('../server/routines.js');

test('the email ledger keeps one row per Gmail id and updates a re-read', () => {
  const r1 = P.recordEmails([
    { emailId: 'a1', receivedAt: '2026-11-06T13:05:00Z', from: 'x@chumba.com', site: 'Chumba Casino', subject: 'Free SC', category: 'free_sc', freeSc: 2, summary: '2 free SC' },
    { emailId: 'a2', receivedAt: '2026-11-06T23:40:00Z', from: 'y@stake.us', site: 'Stake.us', subject: '50% off', category: 'deal', dealPrice: 9.99, summary: 'deal' },
  ]);
  assert.deepEqual([r1.added, r1.updated, r1.total], [2, 0, 2]);
  const r2 = P.recordEmails([{ emailId: 'a1', receivedAt: '2026-11-06T13:05:00Z', from: 'x@chumba.com', site: 'Chumba Casino', subject: 'Free SC', category: 'free_sc', freeSc: 2, summary: '2 free SC', addedToApp: true }]);
  assert.deepEqual([r2.added, r2.updated, r2.total], [0, 1, 2]);
  const rows = P.readJsonl('emails.jsonl');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((e) => e.emailId === 'a1').addedToApp, true);
});

test('patterns: claims, average SC, usual hour (Central), email kinds, balance growth and play-run net are real sums', () => {
  const items = [
    { id: 'c1', type: 'Bonus Claim', site: 'Chumba Casino', at: '2026-11-04T14:10:00Z', day: '2026-11-04', sc: 1 },
    { id: 'c2', type: 'Bonus Claim', site: 'Chumba Casino', at: '2026-11-05T14:20:00Z', day: '2026-11-05', sc: 3 },
    { id: 'c3', type: 'Bonus Claim', site: 'Chumba Casino', at: '2026-11-06T02:00:00Z', day: '2026-11-05', sc: null },
    { id: 'p1', type: 'Play Run', site: 'Chumba Casino', at: '2026-11-05T20:00:00Z', day: '2026-11-05', won: 14, wagered: 10 },
  ];
  const balances = [
    { at: '2026-11-01T12:00:00Z', site: 'Chumba Casino', sc: 10 },
    { at: '2026-11-05T12:00:00Z', site: 'Chumba Casino', sc: 18 },
  ];
  const p = P.patterns({ items, emails: P.readJsonl('emails.jsonl'), balances });
  const c = p.sites.find((s) => s.name === 'Chumba Casino');
  assert.equal(c.claims, 3);
  assert.equal(c.daysClaimed, 2);
  assert.equal(c.avgScPerClaim, 2); // (1 + 3) / 2 claims with an amount
  assert.equal(c.usualHour, 8); // 14:10Z and 14:20Z are 8 AM Central (CST)
  assert.equal(c.playNet, 4);
  assert.equal(c.balance, 18);
  assert.equal(c.scPerDay, 2); // +8 SC over 4 days
  assert.equal(c.freeEmails, 1);
  assert.equal(c.emailSc, 2);
  assert.deepEqual(p.emails.kinds, { free_sc: 1, deal: 1 });
  assert.equal(p.playRuns.net, 4);
  assert.match(P.patternsText(p), /Chumba Casino: 3 claims on 2 days, avg 2 SC a claim, usually 8 AM/);
});

test('site names match loosely, and paused sites can still be found', () => {
  const run = { sites: [{ id: 's1', name: 'Chumba Casino' }, { id: 's2', name: 'Stake.us' }], paused: [{ id: 's3', name: 'Pulsz', status: 'Paused' }] };
  assert.equal(P.findSite(run, 'chumba').id, 's1');
  assert.equal(P.findSite(run, 'stake').id, 's2');
  assert.equal(P.findSite(run, 'Pulsz').id, 's3');
  assert.equal(P.findSite(run, 's2').id, 's2');
  assert.equal(P.findSite(run, 'mcluck'), undefined);
});

test('she never gets a purchase or payment tool, but keeps her own', () => {
  assert.match(P.blockTool('mcp__someshop__purchase_coins'), /never buys/);
  assert.match(P.blockTool('mcp__bank__make_payment'), /never buys/);
  assert.equal(P.blockTool('mcp__persephone__set_balance'), null);
  assert.equal(P.blockTool('mcp__claude_ai_Gmail__search_threads'), null);
});

test('her unattended email check may only read, record and add free bonuses', () => {
  assert.match(unattendedBlock('mcp__persephone__set_balance', {}), /casino sites/);
  assert.match(unattendedBlock('mcp__persephone__remove_site', {}), /casino sites/);
  assert.match(unattendedBlock('mcp__persephone__log_play_run', {}), /casino sites/);
  for (const ok of ['add_offers', 'record_emails', 'history_sync', 'casino_state', 'patterns']) assert.equal(unattendedBlock(`mcp__persephone__${ok}`, {}), null);
});

test('the casino email check is hers now, and asks for the full ledger', () => {
  const r = ROUTINES.find((x) => x.key === 'casinoOfferScan');
  assert.equal(r.agent, 'persephoneRoutine');
  assert.equal(r.fresh, true);
  assert.match(r.prompt, /^\[Persephone routine/);
  assert.match(r.prompt, /record EVERY casino email/);
  assert.match(r.prompt, /history_sync/);
  assert.doesNotMatch(r.prompt, /casino tool/);
});

test('her prompt carries the house rules', () => {
  const t = P.persephonePrompt();
  assert.match(t, /never encourage buying coins, chasing losses/);
  assert.match(t, /never buy, deposit, pay or redeem/);
  assert.match(t, /Only SC/);
  assert.match(t, /ask for all the times as a list/);
});
