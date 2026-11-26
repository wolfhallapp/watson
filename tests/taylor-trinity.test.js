// Taylor's own Trinity (Wolf Hall v368, Night Shift #68): the shared church notes (private marks honored) and the PC
// side that answers his questions from them. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sharedNotes, parseChurchNotes, PRIVATE_MARK } from '../server/church-feed.js';
import { taylorTrinityPathOk, trinityFetch, trinityTradition, taylorTrinitySystemPrompt, taylorTrinityInput, taylorTrinityBlock, processTaylorTrinity } from '../server/taylor-trinity.js';
import { ROUTINES } from '../server/routines.js';

// Made-up notes in the digest's format (names invented).
const NOTES = `# Church notes: Central Church of Christ, Pflugerville

Last updated: 2026-11-23

## Upcoming events

- **Sat Dec 5, 10:30 AM**: **Cookie Exchange** at the building.

## Prayer requests and care

- **Joe Doe** (Nov 21): PRAYER-NEVER-SHARED.

## Announcements

- **Bulletin for 11/22**: have a blessed week. Questions to kirk@example.com or 512-555-0199.
- **Board meeting (private)**: SECRET-BOARD.
  - nested under a private line: SECRET-NESTED.
  - also nested: SECRET-NESTED-2.
- **Food pantry**: over 40 families served.
  - Kept nested detail.
- 🔒 Horace's own aside: SECRET-LOCK.

## Daily readings and sermon notes

The church emails a Daily Bible Reading each morning.
- **Nov 23**: Acts 27-28. Jim's devo: Acts 28:28, the salvation of God.
- **Nov 22**: 1 Corinthians 13. Love is patient.
- **Nov 21**: Acts 21-23 [private] SECRET-READING.
- **Sunday sermon**: Kirk on the Bereans (Acts 17:11).

## Shared: Horace's study notes

- Ephesians 2 is about grace.

## My private thoughts (private)

- SECRET-SECTION.

## Members

- **Kirk Tooley**: MEMBER-NEVER-SHARED.

## Emails already noted (Gmail thread ids)

- 19a1b2c3: EMAIL-NEVER-SHARED.
`;

test('shared notes: readings parsed, private lines (and what is nested under them) left out', () => {
  const { readings, shared } = sharedNotes(NOTES, '2026-11-23');
  const s = JSON.stringify({ readings, shared });
  for (const x of ['SECRET-BOARD', 'SECRET-NESTED', 'SECRET-NESTED-2', 'SECRET-LOCK', 'SECRET-READING', 'SECRET-SECTION', 'PRAYER-NEVER-SHARED', 'MEMBER-NEVER-SHARED', 'EMAIL-NEVER-SHARED']) assert.ok(!s.includes(x), x);
  assert.deepEqual(readings.map((r) => [r.date, r.passage]), [['2026-11-23', 'Acts 27-28'], ['2026-11-22', '1 Corinthians 13']]);
  assert.match(readings[0].note, /^Jim's devo/);
  assert.deepEqual(shared.map((x) => x.heading), ['Announcements', 'Daily readings and sermon notes', "Horace's study notes"]);
  assert.ok(shared[0].items.some((i) => /Kept nested detail/.test(i)), 'a nested line under a shared line stays');
  assert.ok(shared[1].items.some((i) => /Bereans/.test(i)), 'sermon notes that are not a dated reading stay as items');
  assert.ok(!/@|555/.test(s), 'no email or phone');
});

test('the private mark: (private), [private] or the lock', () => {
  assert.ok(PRIVATE_MARK.test('x (Private)') && PRIVATE_MARK.test('[private] y') && PRIVATE_MARK.test('🔒 z'));
  assert.ok(!PRIVATE_MARK.test('privately funded pantry'));
});

test('the feed carries readings and shared notes; events and prayers are as before', () => {
  const f = parseChurchNotes(NOTES, new Date('2026-11-23T18:00:00Z'));
  assert.equal(f.events.length, 1);
  assert.equal(f.prayers.length, 1);
  assert.equal(f.readings.length, 2);
  assert.equal(f.shared.length, 3);
});

test('the digest keeps the formats and the private marks', () => {
  const p = ROUTINES.find((r) => r.key === 'churchDigest').prompt;
  assert.match(p, /\(private\)" or 🔒/);
  assert.match(p, /\*\*Nov 23\*\*: Acts 27-28/);
});

test('the PC side reaches only her two routes', async () => {
  assert.ok(taylorTrinityPathOk('/trinity/pending') && taylorTrinityPathOk('/trinity/chat/abcdef1234567890'));
  for (const p of ['/trinity', '/prayers', '/pool', '/trinity/chat/../pool', '/trinity/pending?x=1', '/accountant/pending']) assert.ok(!taylorTrinityPathOk(p), p);
  await assert.rejects(trinityFetch('GET', '/pool', null, { fetchImpl: async () => { throw new Error('should not fetch'); }, key: () => 'k' }), /only reaches/);
});

test('her prompt: the tradition from knowledge/trinity.md, never Horace\'s own parameters', () => {
  const md = fs.readFileSync(new URL('../knowledge/trinity.md', import.meta.url), 'utf8') + '\n## Horace\'s own parameters\n- HORACE-PRIVATE-PARAM\n';
  const t = trinityTradition(md), sp = taylorTrinitySystemPrompt(md);
  assert.match(t, /baptized by immersion/);
  assert.match(t, /988/);
  assert.ok(!sp.includes('HORACE-PRIVATE-PARAM'));
  assert.match(sp, /Taylor Wolf/);
  assert.match(sp, /never email|don't read anyone's email/i);
});

test('the input: shared notes, history and the question', () => {
  const s = taylorTrinityInput({ question: 'Who were the Bereans?' }, { today: { passage: 'Acts 17' }, readings: [{ day: 'Mon Nov 23', passage: 'Acts 17' }], events: [{ day: 'Sat Dec 5', title: 'Cookie Exchange' }], shared: [{ heading: 'Announcements', items: ['Pantry Friday'] }] }, [{ question: 'Q1', answer: 'A1' }]);
  assert.match(s, /Today's church reading: Acts 17/);
  assert.match(s, /Coming up at church: Sat Dec 5 Cookie Exchange/);
  assert.match(s, /- Pantry Friday/);
  assert.match(s, /Taylor asked: Q1\nYou answered: A1/);
  assert.ok(s.endsWith('Taylor asks: Who were the Bereans?'));
  assert.match(taylorTrinityInput({ question: 'x' }, null), /No shared church notes yet/);
});

test('only the Bible lookup is allowed', () => {
  assert.equal(taylorTrinityBlock('mcp__scripture__bible'), null);
  for (const t of ['Bash', 'Read', 'WebSearch', 'WebFetch', 'mcp__ledger__plant', 'mcp__watson__wolf_hall']) assert.ok(taylorTrinityBlock(t), t);
});

test('a pass: Working, then Answered (markdown stripped); a failure is marked Failed; nothing deployed yet is quiet', async () => {
  const calls = [];
  const fetcher = async (m, p, b) => {
    calls.push([m, p, b]);
    if (p === '/trinity/pending') return { status: 200, json: { ok: true, pending: [{ id: 'aaaaaaaa11', question: 'Q1' }, { id: 'bbbbbbbb22', question: 'Q2' }], church: { shared: [] }, history: [] }, body: '' };
    return { status: 200, json: { ok: true }, body: '' };
  };
  const run = async (req) => { if (req.id === 'bbbbbbbb22') throw new Error('boom'); return '**Acts 17:11** says they searched the Scriptures.'; };
  const n = await processTaylorTrinity({ fetcher, run, log: { warn() {} }, force: true });
  assert.equal(n, 1);
  assert.deepEqual(calls.slice(1).map(([m, p, b]) => [m, p, b.status]), [['PATCH', '/trinity/chat/aaaaaaaa11', 'Working'], ['PATCH', '/trinity/chat/aaaaaaaa11', 'Answered'], ['PATCH', '/trinity/chat/bbbbbbbb22', 'Working'], ['PATCH', '/trinity/chat/bbbbbbbb22', 'Failed']]);
  assert.equal(calls[2][2].answer, 'Acts 17:11 says they searched the Scriptures.');
  assert.equal(await processTaylorTrinity({ fetcher: async () => ({ status: 404, body: '' }), force: true }), 0);
  await assert.rejects(processTaylorTrinity({ fetcher: async () => ({ status: 403, body: 'no' }), force: true }), /HTTP 403/);
});

test('checked at most every 30 seconds', async () => {
  let gets = 0;
  const fetcher = async () => { gets++; return { status: 200, json: { ok: true, pending: [] }, body: '' }; };
  const t0 = Date.now() + 1e9; // after any earlier pass
  await processTaylorTrinity({ fetcher, now: t0 });
  await processTaylorTrinity({ fetcher, now: t0 + 10000 });
  await processTaylorTrinity({ fetcher, now: t0 + 31000 });
  assert.equal(gets, 2);
});

test('the Workshop Helper tick runs it', () => {
  const src = fs.readFileSync(new URL('../server/workshop.js', import.meta.url), 'utf8');
  assert.match(src, /await import\('\.\/taylor-trinity\.js'\); await processTaylorTrinity\(\)/);
});
