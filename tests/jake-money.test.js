// Night Shift #92 (Horace 11/23): the unclaimed-property search, Prolific and Respondent come off Horace's morning
// briefing (a Construct strategy can be marked briefing:false) and go to Jake's Accountant as cards from Horace.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Construct } from '../server/construct.js';
import { movesLine, prepareBriefingExtras } from '../server/briefing-extras.js';
import { plantGifts } from '../server/accountant.js';
import { ROUTINES } from '../server/routines.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jakemoney-'));
const seedRow = (id, name, status, steps) => ({ id, name, branch: '4 Paid opinions & testing', status, steps: steps.map((t, i) => ({ id: id + 't' + i, text: t, done: false })), notes: [], payouts: [] });
const fresh = () => {
  const dir = tmp(), file = path.join(dir, 'construct.json');
  fs.writeFileSync(file, JSON.stringify({ goal: 1000, branches: ['4 Paid opinions & testing', '6 Found money'], strategies: [
    seedRow('s009', 'Respondent paid interviews (strategist profile)', 'Started', ['Connect LinkedIn']),
    seedRow('s010', 'Prolific research studies', 'Started', ['Watch your Gmail for the invite']),
    seedRow('s013', 'Texas unclaimed property search (whole household)', 'Started', ['Search each kid: Tatiyana, Katana, Jake, Kai']),
    seedRow('s014', 'Fetch receipts', 'Started', ['Scan this week\'s receipts']),
  ] }));
  return new Construct(file, null);
};

test('briefing:false keeps a strategy on the tree but out of the moves', () => {
  const c = fresh();
  for (const s of ['respondent', 'prolific', 'unclaimed']) c.apply('update', { strategy: s, fields: { briefing: false } });
  const sum = c.summary();
  assert.deepEqual(sum.moves.map((m) => m.strategyId), ['s014']);
  assert.equal(sum.strategies.length, 4, 'all four still on the tree');
  assert.equal(sum.strategies.find((s) => s.id === 's010').status, 'Started', 'status untouched');
  assert.match(c.describe(), /Prolific research studies · 4 Paid opinions & testing · Started · off the briefing/);
  c.apply('update', { strategy: 'prolific', fields: { briefing: true } });
  assert.ok(c.summary().moves.some((m) => m.strategyId === 's010'), 'true puts it back');
  assert.equal(c.load().strategies.find((s) => s.id === 's010').briefing, undefined, 'back to the default, no leftover flag');
  assert.throws(() => c.apply('update', { strategy: 'fetch', fields: { briefing: 'no' } }), /true or false/);
});

test('the moves line: the remaining moves, capped, and nothing when there are none', () => {
  const c = fresh();
  for (const s of ['respondent', 'prolific', 'unclaimed']) c.apply('update', { strategy: s, fields: { briefing: false } });
  const line = movesLine(c.summary());
  assert.equal(line, "🏗️ The Architect's moves: Fetch receipts: Scan this week's receipts.");
  assert.doesNotMatch(line, /Prolific|Respondent|unclaimed/i);
  assert.equal(movesLine({ moves: [] }), null);
  assert.equal(movesLine(null), null);
  const many = { moves: Array.from({ length: 8 }, (_, i) => ({ strategy: 'S' + i, step: { text: 'go' } })) };
  assert.match(movesLine(many), /S5: go; plus 2 more on the Architect's page\.$/);
});

test('the prepared briefing carries the moves line, and the prompt says to use only it', async () => {
  const c = fresh();
  c.apply('update', { strategy: 'prolific', fields: { briefing: false } });
  const lines = await prepareBriefingExtras({ construct: () => c.summary(), get: async () => ({ status: 502, body: '' }), branches: () => [], statePath: path.join(tmp(), 'x.json'), log: () => {} });
  const mv = lines.find((l) => l.startsWith('🏗️'));
  assert.ok(mv && !/Prolific/.test(mv) && /Respondent/.test(mv));
  const brief = ROUTINES.find((r) => /morning briefing/i.test(r.prompt));
  assert.match(brief.prompt, /use only the "🏗️" line/);
  assert.match(brief.prompt, /Never list the unclaimed-property search, Prolific or Respondent/);
  // A broken tree never holds the briefing up.
  const safe = await prepareBriefingExtras({ construct: () => { throw new Error('bad json'); }, get: async () => ({ status: 502, body: '' }), branches: () => [], statePath: path.join(tmp(), 'y.json'), log: () => {} });
  assert.ok(!safe.some((l) => l.startsWith('🏗️')));
});

// ── Jake's side ──
const gifts = JSON.parse(fs.readFileSync(new URL('../server/accountant-gifts.json', import.meta.url), 'utf8')).gifts;
const fakeFetcher = (log) => async (method, p, body) => { log.push({ method, p, body }); return { status: 200, json: { ok: true, strategy: { id: 'new', name: body?.name } }, body: '' }; };
const quiet = { log() {}, warn() {} };
const jakeTree = () => ({ profile: { finishedAt: '2026-11-23T02:27:32Z' }, pending: [], strategies: [
  { id: 'u1', name: 'Unclaimed money search (ClaimItTexas)', notes: '', steps: [{ t: 'Search your full name on ClaimItTexas', d: true }, { t: 'File any claim on the official site', d: false }] },
  { id: 'm1', name: 'Mow lawns', notes: '', steps: [] },
] });

test('the gift cards are complete, legit and free', () => {
  assert.deepEqual(gifts.map((g) => g.key.split('-')[0]), ['unclaimed', 'prolific', 'respondent']);
  for (const g of gifts) {
    const p = g.plant;
    for (const k of ['name', 'branch', 'how', 'why', 'watch', 'needs', 'link', 'setup', 'dailyTime', 'risk']) assert.ok(p[k], `${g.key} needs ${k}`);
    assert.match(p.needs, /^\$0 to start/);
    assert.match(p.link, /^https:\/\//);
    assert.ok(p.steps.length >= 3 && p.steps.length <= 8);
    assert.ok(Number.isInteger(p.priority) && p.priority >= 1);
    assert.equal(p.status, 'Idea');
    assert.doesNotMatch(JSON.stringify(g), /password|SSN|social security|card number|account number/i);
  }
  assert.match(gifts[0].plant.link, /claimittexas\.gov/);
});

test('gifts: Jake already has an unclaimed card, so it gets the note and the kids step (his ticks kept); the others are planted from Horace', async () => {
  const log = [], statePath = path.join(tmp(), 'gifts.json');
  const done = await plantGifts(jakeTree(), { fetcher: fakeFetcher(log), statePath, log: quiet });
  assert.equal(done.length, 3);
  const upd = log.find((x) => x.body.action === 'update');
  assert.equal(upd.body.id, 'u1');
  assert.match(upd.body.notes, /^From Horace \(11\/23\): search the younger kids too/);
  assert.deepEqual(upd.body.steps.map((x) => x.d), [true, false, false], 'his finished step stays finished');
  assert.match(upd.body.steps[2].t, /Kai Wolf, Tatiyana Hall and Katana Hall/);
  const plants = log.filter((x) => x.body.action === 'plant');
  assert.deepEqual(plants.map((x) => x.body.name), ['Prolific research studies', 'Respondent paid interviews and studies']);
  assert.ok(plants.every((x) => x.body.plantedBy === 'Horace' && x.p === '/accountant/tree'));
  // Once only.
  const again = []; assert.deepEqual(await plantGifts(jakeTree(), { fetcher: fakeFetcher(again), statePath, log: quiet }), []);
  assert.equal(again.length, 0);
});

test('gifts wait for the Initiation and the intake, and retry after a failure', async () => {
  const log = [], statePath = path.join(tmp(), 'gifts.json');
  assert.deepEqual(await plantGifts({ ...jakeTree(), profile: null }, { fetcher: fakeFetcher(log), statePath, log: quiet }), []);
  assert.deepEqual(await plantGifts({ ...jakeTree(), strategies: [] }, { fetcher: fakeFetcher(log), statePath, log: quiet }), []);
  assert.deepEqual(await plantGifts({ ...jakeTree(), pending: [{ kind: 'Intake' }] }, { fetcher: fakeFetcher(log), statePath, log: quiet }), []);
  assert.equal(log.length, 0);
  let calls = 0;
  const flaky = async () => { calls++; return { status: 500, json: { ok: false, error: 'notion down' }, body: '' }; };
  assert.deepEqual(await plantGifts(jakeTree(), { fetcher: flaky, statePath, log: quiet }), []);
  assert.equal(calls, 3);
  const ok = []; assert.equal((await plantGifts(jakeTree(), { fetcher: fakeFetcher(ok), statePath, log: quiet })).length, 3, 'tried again next tick');
});

test('gifts: an existing card that already has the note and step is left alone', async () => {
  const t = jakeTree(), g = gifts[0];
  t.strategies[0].notes = 'mine\n\n' + g.ifThere.note; t.strategies[0].steps.push({ t: g.ifThere.step, d: false });
  const log = [];
  const done = await plantGifts(t, { fetcher: fakeFetcher(log), gifts: [g], statePath: path.join(tmp(), 'g.json'), log: quiet });
  assert.equal(log.length, 0);
  assert.match(done[0], /^already on Unclaimed money search/);
});

test('scripts/briefing-off.mjs flips the flag by id or name, and says so', async () => {
  const { execFileSync } = await import('node:child_process');
  const c = fresh();
  const out = execFileSync(process.execPath, ['scripts/briefing-off.mjs', '--file', c.file, 's009', 'prolific', 's013'], { encoding: 'utf8' });
  assert.match(out, /Off the briefing: Respondent paid interviews/);
  assert.deepEqual(c.summary().moves.map((m) => m.strategyId), ['s014']);
  execFileSync(process.execPath, ['scripts/briefing-off.mjs', '--on', '--file', c.file, 's010']);
  assert.ok(c.summary().moves.some((m) => m.strategyId === 's010'));
  assert.throws(() => execFileSync(process.execPath, ['scripts/briefing-off.mjs', '--file', c.file, 'nope-not-here'], { stdio: 'pipe' }));
});
