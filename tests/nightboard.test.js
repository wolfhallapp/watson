// The Red Pill board (Wolf Hall v310): night branches and their questions up to the app, Horace's taps back to
// night-answers.md. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reportSections, sectionTitle, parseQuestions, buildBoard, branchPrefix, answerLines, syncOnce, taylorLines } from '../server/nightboard.js';
import { ROUTINES } from '../server/routines.js';

const REPORT = `# Night report

## Queue #37 (11/23 add): Away mode for the Thanksgiving trip (done; generic version per Q1)
**What:** stuff. Screens in \`2026-11-23-away-phone.png\`.
**Branch:** oracle/night-2026-11-23-away (worktree ~/night/wolf-hall-1123-away), commits e8a3ffd.
**Waiting on you:**
1. Red pill to merge and deploy.
2. Are the dates right? A: Wed 11/25 noon to Sun 11/29 7 PM (my guess). B: different dates (you can also change them in Settings).
3. Is there a sitter? A: no, just the three of us (my guess). B: yes (name added later). C: Other.

## Night-branch cleanup report (11/22 push #14) — report only
Branches oracle/night-2026-11-23-away and oracle/night-2026-11-01 are old.
**Waiting on you (answers only):**
1. Delete them?
   - A) Yes (my guess)
   - B) No

## 11/22 push #10: worker security audit (done)
**Branch:** oracle/night-2026-11-23-security-v293, commits 70e1624.
**Waiting on you:**
- **Questions** (answer like "1A 2B..."):
  1. **Wishlist prices for Jake.** Jake still sees each amount.
     - A) Hide them (my guess)
     - B) Hide only the paid price
     - C) Leave it
     - D) Other
  2. **PIN length.**
     - A) Keep 4 digits (my guess)
     - B) Move to 6 digits
- **Smaller notes, not fixed:**
  - 3. not a question
`;

test('report sections: title, branch from its own Branch line, screenshots', () => {
  const s = reportSections(REPORT, '2026-11-23');
  assert.equal(s.length, 3);
  assert.equal(s[0].title, 'Away mode for the Thanksgiving trip');
  assert.equal(s[0].branch, 'oracle/night-2026-11-23-away');
  assert.deepEqual(s[0].shots, ['2026-11-23-away-phone.png']);
  assert.equal(s[1].branch, null, 'a cleanup report that only mentions branches is about none of them');
  assert.equal(s[2].branch, 'oracle/night-2026-11-23-security-v293');
  assert.equal(sectionTitle('Task #30 (11/23 add): 3D Land on phones'), '3D Land on phones');
});

test('inline questions: letters, guess, Other dropped, non-questions skipped', () => {
  const q = parseQuestions(reportSections(REPORT, 'x')[0].body, 'wh:away');
  assert.deepEqual(q.map((x) => x.id), ['wh:away#2', 'wh:away#3']);
  assert.equal(q[0].text, 'Are the dates right?');
  assert.deepEqual(q[0].options.map((o) => o.k), ['A', 'B']);
  assert.equal(q[0].options[0].t, 'Wed 11/25 noon to Sun 11/29 7 PM');
  assert.equal(q[0].guess, 'A');
  assert.deepEqual(q[1].options.map((o) => o.k), ['A', 'B'], 'C: Other is left to the app\'s own Other box');
});

test('listed questions under a bold Questions line', () => {
  const q = parseQuestions(reportSections(REPORT, 'x')[2].body, 'wh:sec');
  assert.equal(q.length, 2);
  assert.equal(q[0].text, 'Wishlist prices for Jake. Jake still sees each amount.');
  assert.deepEqual(q[0].options.map((o) => o.k + o.t), ['AHide them', 'BHide only the paid price', 'CLeave it']);
  assert.equal(q[0].guess, 'A');
  assert.equal(q[1].id, 'wh:sec#2');
});

test('board: newest section per branch, hand-written questions merged, twins asked once', () => {
  const secs = reportSections(REPORT, '2026-11-23');
  const branches = [
    { repo: 'wolf-hall', branch: 'oracle/night-2026-11-23-away', version: 'v309', date: '2026-11-23', commits: 3, subject: 'commit msg' },
    { repo: 'oracle', branch: 'oracle/night-2026-11-23-away', date: '2026-11-23', subject: 'oracle side' },
    { repo: 'wolf-hall', branch: 'oracle/night-2026-11-01', date: '2026-11-01', subject: 'Old work' },
  ];
  const extra = [{ branch: 'oracle/night-2026-11-01', questions: [{ id: 'wh:v290-firewise', text: 'Shared?', options: [{ k: 'A', t: 'Yes' }, { k: 'B', t: 'No' }], day: { pick: 'A', note: 'Q7' } }] }];
  const b = buildBoard(branches, secs, extra);
  assert.equal(b.branches.length, 3);
  const wh = b.branches.find((x) => x.repo === 'wolf-hall' && x.branch.endsWith('away'));
  assert.equal(wh.summary, 'Away mode for the Thanksgiving trip');
  assert.equal(wh.questions.length, 2);
  assert.equal(wh.questions[0].id, 'wh:2026-11-23-away#2');
  assert.equal(b.branches.find((x) => x.repo === 'oracle').questions.length, 0, 'same-named Oracle branch does not repeat them');
  const old = b.branches.find((x) => x.branch === 'oracle/night-2026-11-01');
  assert.equal(old.summary, 'Old work', 'no report section: the last commit message');
  assert.equal(old.questions[0].day.pick, 'A');
  assert.equal(b.branches[b.branches.length - 1].branch, 'oracle/night-2026-11-01', 'newest first');
  assert.equal(branchPrefix('oracle', 'oracle/night-2026-11-23'), 'or:2026-11-23');
});

test('answers: only new or changed ones are copied, undo is noted', () => {
  const board = buildBoard([{ repo: 'wolf-hall', branch: 'oracle/night-2026-11-23-away', version: 'v309', date: '2026-11-23' }], reportSections(REPORT, 'x'));
  const a1 = { 'wh:2026-11-23-away#2': { pick: 'B', other: '', at: 't1' }, 'wh:2026-11-23-away#3': { pick: 'Other', other: 'Mrs. Smith next door', at: 't2' } };
  const r1 = answerLines(board, a1, {});
  assert.equal(r1.lines.length, 2);
  assert.match(r1.lines[0], /wh:2026-11-23-away#2 \[oracle\/night-2026-11-23-away v309\] "Are the dates right\?": B \(different dates/);
  assert.match(r1.lines[1], /Other: Mrs\. Smith next door/);
  assert.equal(answerLines(board, a1, r1.synced).lines.length, 0, 'nothing new the second time');
  const r3 = answerLines(board, { 'wh:2026-11-23-away#2': { pick: 'A', at: 't3' } }, r1.synced);
  assert.equal(r3.lines.length, 2);
  assert.match(r3.lines[0], /: A \(Wed/);
  assert.match(r3.lines[1], /away#3: Horace took back his answer/);
});

test('sync: uploads only when the board changes, appends answers, touches only /night-board', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
  const paths = { state: path.join(dir, 'state.json'), answers: path.join(dir, 'answers.md'), extra: path.join(dir, 'none.json'), reports: dir };
  fs.writeFileSync(paths.answers, '# Horace\'s answers\n');
  const calls = []; let answers = {};
  const io = {
    paths, sections: reportSections(REPORT, '2026-11-23'),
    branches: () => [{ repo: 'wolf-hall', branch: 'oracle/night-2026-11-23-away', version: 'v309', date: '2026-11-23' }],
    worker: async (method, p, body) => { calls.push(method + ' ' + p); if (method === 'PUT') return { ok: true }; return { ok: true, board: body || null, answers }; },
  };
  let r = await syncOnce(io);
  assert.equal(r.uploaded, true); assert.equal(r.copied, 0);
  r = await syncOnce(io);
  assert.equal(r.uploaded, false, 'unchanged board is not uploaded again');
  answers = { 'wh:2026-11-23-away#2': { pick: 'A', other: '', at: '2026-11-23T15:00:00Z' } };
  r = await syncOnce(io);
  assert.equal(r.copied, 1);
  const md = fs.readFileSync(paths.answers, 'utf8');
  assert.match(md, /## From the Red Pill board/);
  assert.match(md, /away#2.*: A \(Wed 11\/25/);
  r = await syncOnce(io);
  assert.equal(r.copied, 0, 'copied once');
  assert.ok(calls.every((c) => c === 'PUT /night-board' || c === 'GET /night-board'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Taylor\'s new answers (Wolf Hall v346): copied when they change, never twice, nothing on an error', async () => {
  assert.deepEqual(taylorLines(null).lines, []);
  assert.deepEqual(taylorLines({ error: 'boom' }, 'x'), { lines: [], sig: 'x' });
  assert.deepEqual(taylorLines({ done: false, items: [] }).lines, []);
  const more = { done: false, items: [{ id: 'dayAheadTime', q: 'When should yours come?', a: '4:30 AM' }, { id: 'passports', q: 'Who has a passport?', a: 'Me, Jake' }] };
  const t1 = taylorLines(more);
  assert.equal(t1.lines.length, 2);
  assert.match(t1.lines[0], /^- dayAheadTime "When should yours come\?": 4:30 AM$/);
  assert.deepEqual(taylorLines(more, t1.sig).lines, [], 'unchanged: nothing');
  assert.equal(taylorLines({ ...more, done: true }, t1.sig).lines.length, 2, 'Finish copies again');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbt-'));
  const paths = { state: path.join(dir, 'state.json'), answers: path.join(dir, 'answers.md'), extra: path.join(dir, 'none.json'), reports: dir };
  fs.writeFileSync(paths.answers, '# answers\n');
  let taylorMore = null;
  const io = { paths, sections: [], branches: () => [],
    worker: async (method, p, body) => (method === 'PUT' ? { ok: true } : { ok: true, board: body || null, answers: {}, taylorMore }) };
  let r = await syncOnce(io);
  assert.equal(r.copied, 0);
  taylorMore = more;
  r = await syncOnce(io);
  assert.equal(r.copied, 2);
  r = await syncOnce(io);
  assert.equal(r.copied, 0, 'copied once');
  taylorMore = { ...more, done: true };
  r = await syncOnce(io);
  assert.equal(r.copied, 2);
  const md = fs.readFileSync(paths.answers, 'utf8');
  assert.match(md, /## From Taylor's new questions in his app \(copied .*still in progress\)/);
  assert.match(md, /he tapped Finish\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Night Shift writes questions the board can read', () => {
  const p = ROUTINES.find((r) => r.key === 'nightShift').prompt;
  assert.match(p, /Red Pill board/);
  assert.match(p, /"- A\) \.\.\."/);
  assert.match(p, /\(my guess\)/);
});
