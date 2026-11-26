// Morpheus's evening journaling prompt (Night Shift #115): picking a prompt from his day, the 9 PM routine
// (skip rules, push, Windows fallback), "Answer" and "Not tonight", on a temp private folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jprompt-'));
process.env.MORPHEUS_DIR = dir;
const J = await import('../server/journal-prompt.js');
const M = await import('../server/morpheus.js');
const { ROUTINES } = await import('../server/routines.js');

// 9 PM Central on Mon 11/23 (03:00 UTC Tue) and Tue 11/24.
const MON = new Date('2026-11-24T03:00:00Z');
const TUE = new Date('2026-11-25T03:00:00Z');
const reset = () => { fs.rmSync(J.STATE(), { force: true }); fs.rmSync(M.JOURNAL, { force: true }); };
const quiet = { log() {} };

test('the day key is the Central date, not UTC', () => {
  assert.equal(J.dayKey(MON), '2026-11-23');
});

test('his morning comes first: top 3, then gratitude, then his note, then the church night', () => {
  const c = J.dayCandidates({ top1: 'Fix the cart', top2: 'Call Tati', top3: 'Shower', top1Done: true, gratitude: 'Taylor', note: 'One step' }, MON);
  assert.match(c[0], /^Your top 3 today: Fix the cart, Call Tati, Shower\. Which part are you proudest of/);
  assert.match(c[1], /grateful for "Taylor"/);
  assert.match(c[2], /told yourself: "One step"/);
  assert.match(c[3], /Ephesians class tonight/);
  const all = J.dayCandidates({ top1: 'A', top2: 'B', top1Done: true, top2Done: true }, MON);
  assert.match(all[0], /You finished your top 2 today/);
  assert.deepEqual(J.dayCandidates(null, TUE), ['A long Tuesday at the office. What got you through it, and what do you want to set down tonight?']);
});

test('a prompt used in the last 3 nights is not repeated; the bank fills in', () => {
  const day = J.dayCandidates(null, MON)[0];
  assert.equal(J.pickPrompt({ now: MON }), day);
  const p = J.pickPrompt({ now: MON, recent: [day] });
  assert.ok(J.BANK.includes(p));
  assert.notEqual(J.pickPrompt({ now: MON, recent: [day, p] }), p);
  // Long quotes are clipped so the push stays under the worker's 300-character limit.
  const long = J.pickPrompt({ now: MON, entry: { gratitude: 'x'.repeat(500) } });
  assert.ok(long.length < 160);
  assert.ok(J.pushText('y'.repeat(400)).length <= 300);
});

test('9 PM: offers one prompt, pushes it as Morpheus, and never twice in a night', async () => {
  reset();
  const pushed = [];
  const out = await J.eveningJournalPrompt({ now: MON, log: quiet, morning: async () => ({ gratitude: 'the girls at Christmas' }), push: async (b) => { pushed.push(b); return { ok: true, sent: 2 }; } });
  assert.match(out, /^offered \(2 phone\(s\)\)/);
  assert.equal(pushed.length, 1);
  assert.match(pushed[0], /grateful for "the girls at Christmas".*Not tonight/);
  assert.deepEqual(J.current(MON), { date: '2026-11-23', prompt: J.current(MON).prompt, status: 'offered' });
  assert.match(await J.eveningJournalPrompt({ now: MON, push: async () => assert.fail('pushed twice') }), /already offered/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(J.STATE()).mode & 0o777, 0o600);
  // The next night is a new night, and the card from last night is gone.
  assert.equal(J.current(TUE), null);
});

test('no Morning Log and no phone: the day prompt goes to a Windows notification', async () => {
  reset();
  const toasts = [];
  const out = await J.eveningJournalPrompt({ now: TUE, log: quiet, morning: async () => { throw new Error('offline'); }, push: async () => ({ ok: false, sent: 0 }), toast: async (t) => toasts.push(t) });
  assert.match(out, /Windows notification/);
  assert.match(toasts[0], /^Morpheus: A long Tuesday/);
});

test('no prompt on a night he already talked with Morpheus', async () => {
  reset();
  M.journalAdd({ entry: 'Talked through the drive home.' }, new Date('2026-11-24T01:30:00Z')); // 7:30 PM Mon
  assert.ok(J.journaledToday(MON));
  assert.match(await J.eveningJournalPrompt({ now: MON, push: async () => assert.fail('pushed') }), /already journaled/);
  assert.equal(J.current(MON), null);
});

test('"Answer" frames his next message for Morpheus once, then the card closes', async () => {
  reset();
  await J.eveningJournalPrompt({ now: MON, log: quiet, push: async () => ({ ok: true, sent: 1 }) });
  const seen = [];
  const off = J.onPromptChange((p) => seen.push(p && p.status));
  assert.equal(J.frameAnswer('hello', MON), 'hello'); // not answering yet: untouched
  assert.ok(J.startAnswer(MON));
  assert.equal(J.current(MON).status, 'answering');
  const framed = J.frameAnswer('It went better than I thought.', MON);
  assert.match(framed, /answering tonight's journaling prompt: "Ephesians class tonight/);
  assert.match(framed, /journal_add \(tag evening-prompt\)/);
  assert.match(framed, /It went better than I thought\.$/);
  assert.equal(J.frameAnswer('and one more thing', MON), 'and one more thing');
  assert.equal(J.current(MON), null);
  assert.deepEqual(seen, ['answering', null]);
  off();
  assert.equal(J.startAnswer(MON), false); // already answered
});

test('"Not tonight" closes the card and keeps the 9 PM routine quiet', async () => {
  reset();
  await J.eveningJournalPrompt({ now: MON, log: quiet, push: async () => ({ ok: true, sent: 1 }) });
  J.skipTonight(MON);
  assert.equal(J.current(MON), null);
  assert.match(await J.eveningJournalPrompt({ now: MON, push: async () => assert.fail('pushed') }), /already skipped/);
  // The prompt it offered still counts as used, so tomorrow's isn't the same.
  assert.equal(JSON.parse(fs.readFileSync(J.STATE(), 'utf8')).history.length, 1);
});

test('the routine runs at 9 PM, code only', () => {
  const r = ROUTINES.find((x) => x.key === 'eveningJournal');
  assert.ok(r && typeof r.run === 'function' && !r.prompt);
  assert.equal(r.hour, 21);
});

test('Morpheus\'s page has the card and loads its script; the nav says Trinity', () => {
  const html = fs.readFileSync(new URL('../public/morpheus.html', import.meta.url), 'utf8');
  for (const id of ['jp-card', 'jp-text', 'jp-answer', 'jp-skip', 'jp-go']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<script src="journal-prompt\.js" defer><\/script>/);
  assert.match(html, /href="trinity\.html" title="Go to Trinity">Trinity</);
});
