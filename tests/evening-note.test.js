// The 8 PM evening note (Night Shift #106, 11/23). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { taskBranch, checksOf, whoFor, shortTitle, newSections, composeNote, eveningNote, gatherRelease, PUSH_MAX } from '../server/evening-note.js';
import { reportSections } from '../server/nightboard.js';
import { pushHorace } from '../server/signin-watch.js';
import { ROUTINES, routineDue } from '../server/routines.js';

function fakeStore(init = {}) { let s = { ...init }; return { get: () => s, set: (p) => { s = { ...s, ...p }; } }; }
const quiet = { log() {} };

const REPORT = `# Night Shift report

## Queue #79: Daily nudge for Jake to log the materials we already have (Horace 13A)
Jake gets a nudge.
**Agent Smith:** FAIL at first; fixed and re-checked: **PASS**. Suite 180/180 on 11/23.
**Branch:** oracle/next (task branch oracle/night-2026-11-24-onhand, commit 2d3e95a, v344)

**Waiting on you**
1. When should the nudge go out?
- A) 6 PM (my guess)
- B) 8 PM

## Queue #54: Wishlist price watch (blocked)
**Status:** blocked: the stores forbid it.
`;

test('a section on the rolling release names its task branch (and the Red Pill board reads it too)', () => {
  const secs = reportSections(REPORT, '2026-11-24');
  assert.equal(secs[0].branch, 'oracle/night-2026-11-24-onhand'); // was "oracle/next" before the fix
  assert.equal(taskBranch(secs[0]), 'oracle/night-2026-11-24-onhand');
  assert.equal(taskBranch({ branch: 'oracle/night-x', body: 'no task branch here' }), 'oracle/night-x');
});

test('checks: the last Agent Smith verdict and the whole-suite count, never a date', () => {
  assert.deepEqual(checksOf('**Agent Smith:** first FAIL, then **PASS**.\nSuite 180/180, run 11/23.'), { smith: 'PASS', tests: '180/180' });
  assert.deepEqual(checksOf('Tests: 6/6 new, on 11/23.'), { smith: null, tests: null });
  assert.deepEqual(checksOf('- agent-smith: FAIL on one gap'), { smith: 'FAIL', tests: null });
});

test('who it is for, and short phone titles', () => {
  assert.deepEqual(whoFor("Taylor's Ram service schedule"), ['Taylor']);
  assert.deepEqual(whoFor('Packing lists for Jake and Taylor'), ['Taylor', 'Jake']);
  assert.deepEqual(whoFor('speed audit of the live app'), ['everyone']);
  assert.equal(shortTitle('Queue #79: Daily nudge for Jake (Horace 13A)'), 'Daily nudge for Jake');
  const t = shortTitle('Packing lists, trip tally and the departure reminder in Away mode', 38);
  assert.ok(t.length <= 38 && t.endsWith('…'), t);
});

test('only today and tomorrow\'s reports count, and nothing is sent twice', () => {
  const secs = [...reportSections(REPORT, '2026-11-24'), ...reportSections('## Old task\nx\n', '2026-11-22'), ...reportSections('## Late run\nx\n', '2026-11-25')];
  const first = newSections(secs, [], '2026-11-24');
  assert.deepEqual(first.map((s) => s.title), ['Daily nudge for Jake to log the materials we already have (Horace 13A)', 'Wishlist price watch', 'Late run']);
  assert.equal(newSections(secs, first.map((s) => s.id), '2026-11-24').length, 0);
});

const ON = [{ branch: 'oracle/night-a', version: 'v345', title: 'Packing lists', who: ['Taylor'], smith: 'PASS', tests: '180/180' },
  { branch: 'oracle/night-b', version: 'v346', title: 'Cooking rotation', who: ['Jake'], smith: 'PASS', tests: null }];

test('the note: what finished, the release with "deploy", what is off it, open questions; under 300 characters', () => {
  const finished = newSections(reportSections(REPORT, '2026-11-24'), [], '2026-11-24');
  const n = composeNote({ day: '2026-11-24', finished, release: { mainVersion: 'v343', nextVersion: 'v346', ahead: 4, on: ON, off: [ON[0]] }, oracle: [ON[1]], questions: 3 });
  assert.equal(n.body, 'Finished 1: Daily nudge for Jake to log the… 1 blocked. Ready: Wolf Hall v346 (2 changes, Agent Smith passed all). Say "deploy" to ship it. 1 Wolf Hall + 1 Oracle branches not on it. 3 questions on the Red Pill board.');
  assert.ok(n.body.length <= PUSH_MAX);
  assert.match(n.md, /## On the release[\s\S]*\*\*Packing lists\*\* \(oracle\/night-a\) v345 · for Taylor · tests 180\/180 · Agent Smith PASS/);
  assert.match(n.md, /\(blocked\) Wishlist price watch/);
});

test('a big night still fits: titles give way, the release line never does', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ heading: `Queue #${i}: a fairly long task title number ${i} for the household`, body: 'done', date: '2026-11-24' }));
  const n = composeNote({ day: '2026-11-24', finished: many, release: { nextVersion: 'v350', on: ON, off: [] }, oracle: [], questions: 12 });
  assert.ok(n.body.length <= PUSH_MAX, n.body.length);
  assert.match(n.body, /^Finished 40: .*; \+\d+ more\. Ready: Wolf Hall v350 .*12 questions on the Red Pill board\.$/);
});

test('nothing finished, nothing waiting, no questions: no push', () => {
  assert.equal(composeNote({ day: '2026-11-24', finished: [], release: { on: [], off: [] }, oracle: [], questions: 0 }), null);
});

test('the 8 PM run pushes once, saves the summary, and does not repeat sections the next night', async () => {
  const store = fakeStore(), sent = [], files = {};
  const io = { now: new Date('2026-11-25T02:00:00Z'), sections: reportSections(REPORT, '2026-11-24'), store, log: quiet,
    gather: () => ({ release: { mainVersion: 'v343', nextVersion: 'v344', ahead: 1, on: [ON[0]], off: [] }, oracle: [] }), questions: () => 1,
    push: async (b, o) => { sent.push([o.title, b]); return { ok: true, sent: 1 }; }, writeFile: (p, t) => { files[p] = t; }, summaryFile: '/x/release-summary.md' };
  const r = await eveningNote(io);
  assert.equal(r.how, 'push');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'Tonight from the Night Shift');
  assert.match(files['/x/release-summary.md'], /# Release summary, 2026-11-24/);
  assert.equal(store.get().eveningNote.seen.length, 2);
  await eveningNote({ ...io, now: new Date('2026-11-25T03:00:00Z') }); // the same report again (a restart, or tomorrow's run)
  assert.match(sent[1][1], /^Night Shift: nothing new finished today\. Ready: Wolf Hall v344/);
});

test('a failed push falls back to a Windows notification', async () => {
  const toasts = [];
  const r = await eveningNote({ now: new Date('2026-11-25T02:00:00Z'), sections: reportSections(REPORT, '2026-11-24'), store: fakeStore(), log: quiet,
    gather: () => ({ release: { on: [], off: [] }, oracle: [] }), questions: () => 0, writeFile: () => {},
    push: async () => ({ ok: false, sent: 0, error: 'HTTP 500' }), toast: async (t) => { toasts.push(t); return true; } });
  assert.equal(r.how, 'windows');
  assert.equal(toasts.length, 1);
});

test('pushHorace sends the title it is given (the sign-in watch keeps its own)', async () => {
  const bodies = [];
  const fetchImpl = async (url, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ ok: true, sent: 1 }) }; };
  await pushHorace('hi', { fetchImpl, key: () => 'k', title: 'Tonight from the Night Shift' });
  await pushHorace('hi', { fetchImpl, key: () => 'k' });
  assert.deepEqual(bodies.map((b) => b.title), ['Tonight from the Night Shift', 'Deploy sign-in']);
});

test('the release from git: on oracle/next, off it, and already-live branches left out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evening-')), g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const sw = (v, msg) => { fs.writeFileSync(path.join(dir, 'sw.js'), `const CACHE = 'wolfhall-${v}';\n`); g('add', '.'); g('commit', '-qm', msg); };
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  sw('v343', 'live');
  g('checkout', '-qb', 'oracle/night-2026-11-22-old'); sw('v340', 'old, shipped another way');
  g('checkout', '-q', 'main'); g('checkout', '-qb', 'oracle/night-2026-11-24-a'); sw('v344', 'packing');
  g('branch', 'oracle/next');
  g('checkout', '-qb', 'oracle/night-2026-11-24-b'); sw('v345', 'cooking');
  g('checkout', '-q', 'main');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const { release, oracle } = gatherRelease({ dir, oracleDir: dir, today, sections: [] });
  assert.equal(release.mainVersion, 'v343');
  assert.equal(release.nextVersion, 'v344');
  assert.equal(release.ahead, 1);
  assert.deepEqual(release.on.map((b) => b.branch), ['oracle/night-2026-11-24-a']);
  assert.deepEqual(release.off.map((b) => [b.branch, b.version]), [['oracle/night-2026-11-24-b', 'v345']]);
  assert.equal(oracle.length, 3); // the same repo stands in for the Oracle's: every waiting branch, no version filter
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the routine is code only and due from 8 PM Central', () => {
  const r = ROUTINES.find((x) => x.key === 'eveningNote');
  assert.ok(r && typeof r.run === 'function' && !r.agent && !r.prompt);
  assert.equal(routineDue(r, new Date('2026-11-25T01:59:00Z'), null), null); // 7:59 PM
  assert.equal(routineDue(r, new Date('2026-11-25T02:00:00Z'), null), '2026-11-24'); // 8:00 PM
  assert.equal(routineDue(r, new Date('2026-11-25T03:00:00Z'), '2026-11-24'), null); // once a day
});
