// Checks the suggestion log that learns (2026-11-11). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kindScore, foldItems, scoreKinds, rankOpen, briefingLine, scoreSummary, makeSuggestionLog } from '../server/suggestions.js';
import { ROUTINES } from '../server/routines.js';

const tmpLog = () => makeSuggestionLog(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sugg-')), 'suggestions.jsonl'));
const at = (d) => new Date(`2026-11-${String(d).padStart(2, '0')}T12:00:00Z`);

test('a new kind starts at 50% and the score follows the design formula', () => {
  assert.equal(kindScore({}), 0.5);
  assert.equal(kindScore({ offered: 4, accepted: 3, changed: 1 }), (3 + 0.5 + 1) / 6);
  assert.equal(kindScore({ offered: 3 }), 1 / 5);
});

test('offered, then answered: the latest answer wins and his words are kept', () => {
  const log = tmpLog();
  const e = log.log({ outcome: 'offered', source: 'night', kind: 'fix', title: 'Overdue bills in the forecast' }, at(10));
  assert.match(e.id, /^overdue-bills-in-the-forecast-[0-9a-f]{4}$/);
  log.log({ outcome: 'changed', id: 'overdue bills', note: 'yes but flag them red' }, at(11));
  const [it] = log.items(at(11));
  assert.equal(it.status, 'changed');
  assert.equal(it.note, 'yes but flag them red');
  assert.equal(it.kind, 'fix');
  assert.equal(log.events().length, 2);
});

test('unanswered for more than 7 days counts as ignored, not open', () => {
  const items = foldItems([{ at: at(1).toISOString(), id: 'a', source: 'oracle', kind: 'polish', title: 'A', outcome: 'offered' }], at(9));
  assert.equal(items[0].status, 'ignored');
  assert.equal(foldItems([{ at: at(5).toISOString(), id: 'a', source: 'oracle', kind: 'polish', title: 'A', outcome: 'offered' }], at(9))[0].status, 'open');
});

test('open ideas rank by their kind\'s score, and the briefing line says why', () => {
  const log = tmpLog();
  for (const t of ['Fix one', 'Fix two']) {
    log.log({ outcome: 'offered', source: 'night', kind: 'fix', title: t }, at(1));
    log.log({ outcome: 'accepted', id: t }, at(2));
  }
  log.log({ outcome: 'offered', source: 'oracle', kind: 'polish', title: 'Shiny thing' }, at(1));
  log.log({ outcome: 'rejected', id: 'shiny' }, at(2));
  log.log({ outcome: 'offered', source: 'night', kind: 'polish', title: 'Polish the Payday Helper' }, at(9));
  log.log({ outcome: 'offered', source: 'night', kind: 'fix', title: 'Fix the sleep hook test' }, at(9));
  const items = log.items(at(10));
  assert.deepEqual(rankOpen(items).map((i) => i.title), ['Fix the sleep hook test', 'Polish the Payday Helper']);
  assert.equal(briefingLine(items), '💡 Top idea today: Fix the sleep hook test (you said yes to 2 of 3 fix ideas).');
  assert.match(scoreSummary(items), /fix: score 60%/);
});

test('nothing open means no briefing line; an empty log reads plainly', () => {
  assert.equal(briefingLine([]), null);
  assert.match(scoreSummary([]), /No suggestions logged yet/);
  assert.equal(tmpLog().items().length, 0);
});

test('bad input is refused, and an answer to an unknown idea is not invented', () => {
  const log = tmpLog();
  assert.throws(() => log.log({ outcome: 'offered', source: 'morpheus', kind: 'fix', title: 'x' }), /source must be/);
  assert.throws(() => log.log({ outcome: 'offered', source: 'oracle', kind: 'gossip', title: 'x' }), /kind must be/);
  assert.throws(() => log.log({ outcome: 'maybe', source: 'oracle', kind: 'fix', title: 'x' }), /outcome must be/);
  assert.throws(() => log.log({ outcome: 'accepted', id: 'nothing like this' }), /No suggestion matches/);
  assert.equal(log.events().length, 0);
});

test('an idea answered on the spot (no offered line) still counts once', () => {
  const log = tmpLog();
  log.log({ outcome: 'accepted', source: 'oracle', kind: 'oracle', title: 'Louder voice' }, at(3));
  const scores = scoreKinds(log.items(at(3)));
  assert.equal(scores.oracle.offered, 1);
  assert.equal(scores.oracle.accepted, 1);
});

test('the Night Shift and the briefing use the suggestion log', () => {
  const night = ROUTINES.find((r) => r.key === 'nightShift');
  const brief = ROUTINES.find((r) => r.key === 'morningBriefing');
  assert.match(night.prompt, /suggestion tool \(action list\)/);
  assert.match(night.prompt, /as offered \(source night\)/);
  assert.match(brief.prompt, /suggestion tool \(action top\)/);
});
