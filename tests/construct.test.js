// The Construct's tree store (the Architect's data): seeding, adding, steps, payouts and totals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Construct, dayStr } from '../server/construct.js';

function fresh(seed = { strategies: [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  const seedFile = path.join(dir, 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify(seed));
  return new Construct(path.join(dir, 'construct.json'), seedFile);
}
const seedRow = (id, name, branch, extra = {}) => ({ id, name, branch, status: 'Idea', steps: [], notes: [], payouts: [], ...extra });

test('seeds from the Notion copy on first load, then keeps its own file', () => {
  const real = new Construct(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-')), 'c.json'));
  const d = real.load();
  assert.equal(d.strategies.length, 23);
  assert.equal(d.branches.length, 10);
  assert.ok(d.strategies.find((s) => /EcoSport/.test(s.name)).status === 'Dropped');
  assert.ok(fs.existsSync(real.file));
});

test('add plants new ideas, skips duplicates and checks the branch', () => {
  const c = fresh({ strategies: [seedRow('s001', 'Prolific research studies', '4 Paid opinions & testing')] });
  let r = c.apply('add', { strategies: [{ name: 'Swagbucks', branch: '3 Rewards & points', estMonthly: 5 }, { name: 'prolific research studies', branch: '4 Paid opinions & testing' }] });
  assert.match(r.message, /Planted 1; already on the tree: prolific/);
  assert.equal(c.load().strategies.length, 2);
  assert.equal(c.load().strategies[1].status, 'Idea');
  assert.throws(() => c.apply('add', { name: 'X', branch: 'Crypto moonshots' }), /Unknown branch/);
  assert.throws(() => c.apply('add', { name: 'Y', branch: '3 Rewards & points', risk: 'Huge' }), /risk must be/);
  c.apply('add_branch', { name: 'Local gigs' });
  assert.equal(c.load().branches.at(-1), '11 Local gigs');
  c.apply('add', { name: 'Pet sitting on Rover', branch: '11 Local gigs' });
  assert.equal(c.load().strategies.length, 3);
});

test('steps move a strategy along; loose names find it', () => {
  const c = fresh({ strategies: [seedRow('s001', 'Fetch receipt scanning', '2 Cashback & receipts')] });
  c.apply('add_steps', { strategy: 'fetch', steps: ['Install Fetch', 'Scan this week\'s receipts'] });
  assert.equal(c.load().strategies[0].status, 'Researching');
  const r = c.apply('step', { strategy: 's001', number: 1 });
  assert.match(r.message, /1 step left/);
  assert.equal(c.load().strategies[0].status, 'Started');
  const sum = c.summary();
  assert.equal(sum.moves.length, 1);
  assert.equal(sum.moves[0].step.text, "Scan this week's receipts");
  assert.throws(() => c.apply('step', { strategy: 'nothing like it', number: 1 }), /No strategy matches/);
});

test('payouts: validation, Earning status, totals and undo', () => {
  const c = fresh({ strategies: [seedRow('s001', 'Prolific', '4 Paid opinions & testing', { status: 'Started' }), seedRow('s002', 'Old idea', '6 Found money', { status: 'Dropped' })] });
  assert.throws(() => c.apply('payout', { strategy: 's001', amount: 0.001 }), /at least/);
  assert.throws(() => c.apply('payout', { strategy: 's001', amount: 2, date: '2026-13-45' }), /real YYYY-MM-DD/);
  assert.throws(() => c.apply('payout', { strategy: 's001', amount: 2, date: '2999-01-01' }), /not in the future/);
  assert.throws(() => c.apply('payout', { strategy: 's001', amount: 2, kind: 'Bitcoin' }), /kind must be/);
  c.apply('payout', { strategy: 'prolific', amount: 12.5 });
  c.apply('payout', { strategy: 's001', amount: 3.333, date: '2026-01-02', kind: 'Gift card' });
  c.apply('payout', { strategy: 's002', amount: 1 });
  const d = c.load();
  assert.equal(d.strategies[0].status, 'Earning');
  assert.equal(d.strategies[1].status, 'Dropped', 'a dropped strategy keeps its status');
  const sum = c.summary();
  assert.equal(sum.totals.earnedAll, 16.83);
  assert.equal(sum.totals.earnedWeek, 13.5);
  assert.equal(sum.strategies.find((s) => s.id === 's001').earned, 15.83);
  assert.equal(sum.recentPayouts[0].date, dayStr());
  const pid = d.strategies[0].payouts[0].id;
  c.apply('undo_payout', { payoutId: pid });
  assert.equal(c.summary().totals.earnedAll, 4.33);
  assert.throws(() => c.apply('undo_payout', { payoutId: pid }), /No payout/);
});

test('every change tells the screens; describe gives the Architect ids', () => {
  const c = fresh({ strategies: [seedRow('s001', 'Upside gas cash back', '2 Cashback & receipts', { estMonthly: 3 })] });
  const seen = [];
  c.onChange((s) => seen.push(s.totals.strategies));
  c.apply('note', { strategy: 'upside', text: 'HEB on 290 is in it' });
  c.apply('add', { name: 'Ibotta', branch: '2 Cashback & receipts' });
  assert.deepEqual(seen, [1, 2]);
  const txt = c.describe();
  assert.match(txt, /\[s001\] Upside gas cash back · 2 Cashback & receipts · Idea · est \$3\/mo/);
  assert.match(c.describe({ branch: 'cashback' }), /Ibotta/);
});
