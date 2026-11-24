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
  for (const ok of ['add_offers', 'record_emails', 'history_sync', 'casino_state', 'patterns', 'update_deals']) assert.equal(unattendedBlock(`mcp__persephone__${ok}`, {}), null);
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

test('her deals list may be posted to the app, other worker routes stay closed (11/12)', async () => {
  const { workerPostGambling } = await import('../server/knowledge.js');
  const realFetch = global.fetch;
  global.fetch = async () => new Response('{"ok":true,"saved":0}', { status: 200 });
  try {
    await assert.rejects(workerPostGambling('/gambling/bills', {}), /Only the \/gambling\/ write routes/);
    // /gambling/deals passes the allowlist (it may still fail later on a machine without the app repo, but not on the allowlist)
    await workerPostGambling('/gambling/deals', { deals: [] }).catch((e) => assert.doesNotMatch(e.message, /Only the \/gambling\/ write routes/));
  } finally { global.fetch = realFetch; }
});

// Wolf Hall v378 (queue #85): her books go to the app's Gambling screen.
test('books snapshot: her patterns plus the newest 40 emails, only the fields the screen draws', () => {
  const emails = Array.from({ length: 45 }, (_, i) => ({ emailId: `e${i}`, threadId: `t${i}`, from: 'x@site.com', terms: 'long terms', claimLink: 'https://x',
    receivedAt: new Date(Date.UTC(2026, 10, 1, i)).toISOString(), recordedAt: `2026-11-2${i % 3}T10:00:00Z`, site: 'Chumba Casino', subject: `S${i}`, category: 'free_sc', freeSc: 1, summary: 'one SC' }));
  emails.push({ emailId: 'bad', receivedAt: 'not a date', site: 'X', subject: 'x', category: 'other', summary: '' });
  const snap = P.booksSnapshot({ items: [], emails, balances: [], syncedAt: '2026-11-24T10:00:00Z' });
  assert.equal(snap.emails.length, P.BOOKS_EMAILS);
  assert.equal(snap.emails[0].emailId, 'e44'); // newest first
  assert.ok(snap.emails.every((e) => !('from' in e) && !('terms' in e) && !('claimLink' in e) && !('threadId' in e)));
  assert.equal(snap.syncedAt, '2026-11-24T10:00:00Z');
  assert.equal(snap.checkedAt, '2026-11-22T10:00:00Z');
  assert.equal(snap.patterns.emails.total, 46);
  assert.ok(Array.isArray(snap.patterns.sites));
});

test('publishBooks posts to /gambling/persephone and reports a refusal', async () => {
  let sent = null;
  const ok = await P.publishBooks({ snapshot: () => ({ patterns: { sites: [] }, emails: [] }), postImpl: async (p, b) => { sent = [p, b]; return { status: 200, json: { ok: true, sites: 0, emails: 0 } }; } });
  assert.equal(sent[0], '/gambling/persephone');
  assert.equal(ok.ok, true);
  await assert.rejects(P.publishBooks({ snapshot: () => ({}), postImpl: async () => ({ status: 404, json: { error: 'Not found' } }) }), /Not found/);
});

test('the gambling write allowlist lets her books through, and nothing new besides', async () => {
  const src = fs.readFileSync(new URL('../server/knowledge.js', import.meta.url), 'utf8');
  assert.match(src, /\(claim\|site\|sites\\\/add\|play-run\|offers\|offer\|deals\|persephone\)\$/);
  const ps = fs.readFileSync(new URL('../server/persephone.js', import.meta.url), 'utf8');
  assert.match(ps, /const r = await syncActivity\(\); changed\(\);\s*\/\/ v378[^\n]*\n\s*let books; try \{ const b = await publishBooks\(\)/);
  assert.match(P.persephonePrompt(), /YOUR BOOKS/);
  assert.match(P.persephonePrompt(), /twice a day \(7 AM and 8 PM/);
  const idx = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(idx, /^startPersephoneBooks\(\);/m);
});
