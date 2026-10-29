// Morpheus (2026-10-29): the journal, the insights page for the Oracle, and text/call search, on temp files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'morpheus-'));
process.env.MORPHEUS_DIR = dir;
const M = await import('../server/morpheus.js');

test('journal entries are appended, dated, and searchable', () => {
  M.journalAdd({ entry: 'Talked about Riki and owning my part.', mood: 'heavy', tags: ['relationships'], followUps: ['check in Sunday'] }, new Date('2026-10-29T21:00:00Z'));
  M.journalAdd({ entry: 'Felt proud after the budget fix.', tags: ['money'] }, new Date('2026-10-30T13:00:00Z'));
  const all = M.journalRead({ last: 10 });
  assert.equal(all.length, 2);
  assert.match(all[0], /^## Thu, Oct 29, 2026, 4:00 PM · mood: heavy · #relationships/);
  assert.match(all[0], /Follow up: check in Sunday/);
  assert.deepEqual(M.journalRead({ query: 'budget' }).length, 1);
  assert.equal(M.journalRead({ query: 'nothing-like-this' }).length, 0);
  assert.equal(fs.statSync(M.JOURNAL).mode & 0o777, 0o600);
});

test('the Oracle only sees the insights page once Morpheus has written one', () => {
  assert.equal(M.morpheusForOracle(), '');
  fs.writeFileSync(M.INSIGHTS, '- Values loyalty; humor is how he copes.\n');
  const o = M.morpheusForOracle();
  assert.match(o, /What Morpheus knows about Horace/);
  assert.match(o, /humor is how he copes/);
  assert.match(o, /journal\.md/);
});

test('texts: search by words, person, dates and direction; stats by year', () => {
  const f = path.join(dir, 'texts.jsonl');
  fs.writeFileSync(f, [
    { k: 'sms', date: String(Date.parse('2025-03-01T15:00:00Z')), name: 'Taylor', type: '2', body: 'On my way home' },
    { k: 'sms', date: String(Date.parse('2025-03-01T15:05:00Z')), name: 'Taylor', type: '1', body: 'Grab milk' },
    { k: 'mms', date: String(Date.parse('2026-01-10T18:00:00Z')), name: 'Kristen', box: '2', body: 'Happy birthday!', addrs: [] },
    { k: 'sms', date: String(Date.parse('2026-02-10T18:00:00Z')), name: '(Unknown)', addr: '+15550001111', type: '1', body: 'Your code is 1234' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\nnot json\n');
  const rows = M.loadTexts(f);
  assert.equal(rows.length, 4);
  assert.equal(M.searchTexts({ person: 'tay' }, rows).total, 2);
  assert.equal(M.searchTexts({ person: 'tay', mine: true }, rows).total, 1);
  assert.equal(M.searchTexts({ query: 'happy birthday' }, rows).shown[0].who, 'Kristen');
  assert.equal(M.searchTexts({ from: '2026-01-01' }, rows).total, 2);
  assert.equal(M.searchTexts({ person: '1111' }, rows).total, 1);
  const s = M.textStats({}, rows);
  assert.deepEqual(s.byYear[2025], { sent: 1, received: 1 });
  assert.equal(s.top[0][0], 'Taylor');
});

test('calls: parsed from the newest calls-*.xml', () => {
  fs.writeFileSync(path.join(dir, 'calls-20261029.xml'), `<?xml version='1.0'?><calls count="2">
<call number="+15125550000" duration="125" date="${Date.parse('2026-10-01T15:00:00Z')}" type="2" contact_name="Mama" />
<call number="+18005550000" duration="0" date="${Date.parse('2026-10-02T15:00:00Z')}" type="5" contact_name="(Unknown)" />
</calls>`);
  const c = M.loadCalls(dir);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].who, c[0].kind, c[0].secs], ['Mama', 'outgoing', 125]);
  assert.deepEqual([c[1].who, c[1].kind], ['+18005550000', 'rejected']);
});

test('the schedule page shows up in his prompt once written', () => {
  fs.writeFileSync(M.SCHEDULE, '# Schedule\n- Tuesdays: leaves at 4:00 AM, home about 6 PM.\n');
  assert.match(M.MORPHEUS.prompt(), /Tuesdays: leaves at 4:00 AM/);
  assert.match(M.MORPHEUS.prompt(), /Day planner/);
});
