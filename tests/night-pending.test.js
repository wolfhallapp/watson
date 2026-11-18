// Night work waiting on Horace (11/18): unmerged night branches, minus what a newer stack or main carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingNightBranches, findPendingNightWork, nightPendingLine, formatPending, branchDate } from '../server/night-pending.js';
import { ROUTINES } from '../server/routines.js';

const S = '\x1f', E = '\x1e';
// A fake repo: branch -> { t, commits: [[sha, subject, body]] } (newest first), plus main's subjects.
function fakeGit(branches, mainSubjects = []) {
  return (dir, args) => {
    if (args[0] === 'for-each-ref') return Object.entries(branches).map(([n, b]) => `${n}${S}${b.t}`).join('\n') + '\n';
    if (args[0] === 'log' && args.includes('main')) return mainSubjects.join('\n') + '\n';
    if (args[0] === 'log') {
      const b = branches[args[args.length - 1].replace(/^main\.\./, '')];
      return b.commits.map(([sha, s, body = '']) => `${sha}${S}${s}${S}${body}${E}\n`).join('');
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

const repo = fakeGit({
  'oracle/night-2026-11-01': { t: 100, commits: [['aaa1111', 'v219: toasts'], ['ba4be7b0', 'v219: worker today is Central'], ['3246f5a0', 'v219: app today is Central']] },
  'oracle/night-2026-11-05': { t: 150, commits: [] }, // merged: nothing main doesn't have
  'oracle/night-2026-11-12-retry': { t: 200, commits: [['ccc', 'v242: Try again links']] },
  'oracle/night-2026-11-13-stack': { t: 300, commits: [['d1', 'v244: worker today', '(port of ba4be7b)'], ['d2', 'v244: app today (port of 3246f5a)'], ['d3', 'v242: Try again links']] },
  'oracle/night-2026-11-18': { t: 400, commits: [['e1', 'v245: Wishlist look'], ['d1', 'v244: worker today'], ['d2', 'v244: app today (port of 3246f5a)'], ['d3', 'v242: Try again links']] },
  'oracle/night-2026-11-18-tests': { t: 390, commits: [['f1', 'Tests: card-payment']] },
  'oracle/night-2026-11-19': { t: 500, commits: [['g1', 'v239: already cherry-picked to main']] },
}, ['v239: already cherry-picked to main', 'v241: something']);

test('lists only branches with work that main or a newer branch does not carry', () => {
  const list = pendingNightBranches('/x', repo);
  assert.deepEqual(list.map((b) => b.name), ['oracle/night-2026-11-01', 'oracle/night-2026-11-18', 'oracle/night-2026-11-18-tests']);
  const old = list[0];
  assert.equal(old.commits, 3);
  assert.equal(old.waiting, 1); // the two Central-time fixes were ported onto the stack; the toasts were not
  assert.equal(old.date, '2026-11-01');
  assert.equal(old.newest, 'v219: toasts');
  assert.equal(list[1].waiting, 4); // the newest stack carries itself
});

test('an older branch never hides a newer one with the same commit', () => {
  // Same subject on both: only the newer branch (by commit time) counts as the carrier.
  const g = fakeGit({ 'oracle/night-2026-11-12': { t: 1, commits: [['a', 'same']] }, 'oracle/night-2026-11-13': { t: 2, commits: [['b', 'same']] } });
  assert.deepEqual(pendingNightBranches('/x', g).map((b) => b.name), ['oracle/night-2026-11-13']);
});

test('the briefing line counts branches per repo with the oldest date, and is empty when nothing waits', () => {
  const found = findPendingNightWork([{ name: 'Wolf Hall', dir: '/w' }, { name: 'Oracle', dir: '/o' }], (dir, args) => (dir === '/w' ? repo(dir, args) : fakeGit({ 'oracle/night-2026-11-05': { t: 1, commits: [['x', 'Briefing: Taylor notes']] } })(dir, args)));
  assert.equal(nightPendingLine(found), '🧩 Night work waiting on your red pill: Wolf Hall 3 branches (oldest from 11/01), Oracle 1 branch (oldest from 11/05). Ask me what\'s waiting for the list.');
  assert.equal(nightPendingLine([{ name: 'Oracle', branches: [] }]), '');
  assert.match(formatPending(found), /oracle\/night-2026-11-01: 1 of 3 commits not carried/);
});

test('a repo that cannot be read is reported, not fatal', () => {
  const found = findPendingNightWork([{ name: 'Wolf Hall', dir: '/w' }, { name: 'Oracle', dir: '/o' }], (dir, args) => { if (dir === '/w') throw new Error('not a git repository\nmore'); return repo(dir, args); });
  assert.equal(found[0].error, 'not a git repository');
  assert.equal(found[1].branches.length, 3);
  assert.match(formatPending(found), /could not read: not a git repository/);
  assert.match(nightPendingLine(found), /^🧩 .*Oracle 3 branches/);
});

test('branch dates come from the name', () => {
  assert.equal(branchDate('oracle/night-2026-11-12-retry'), '2026-11-12');
  assert.equal(branchDate('oracle/night-misc'), '');
});

test('the morning briefing adds the 🧩 line only when something is waiting, and its prepare never throws', async () => {
  const r = ROUTINES.find((x) => x.key === 'morningBriefing');
  assert.equal(typeof r.prepare, 'function');
  assert.match(r.prompt('🧩 Night work waiting on your red pill: Oracle 1 branch (oldest from 11/05).'), /Add this line as is, right after the 🌙 line .*🧩 Night work waiting/);
  assert.doesNotMatch(r.prompt(''), /🧩|Add this line as is/);
  assert.equal(typeof (await r.prepare()), 'string'); // real repos (or none): a string either way
});
