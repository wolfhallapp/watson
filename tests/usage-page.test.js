import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usageReport, readUsageReport, parseLog, jobKind, windowDelta, centralDate } from '../server/usage.js';

const R = { sessionResets: 1000, weekResets: 9000 };
const job = (at, agent, origin, ask, b, a, costUsd, extra = {}) => ({ at, agent, origin, ask, before: { ...R, ...b }, after: { ...R, ...a }, costUsd, turns: 5, ms: 60000, ...extra });
const NIGHT = '[Oracle routine: the Night Shift. Not from Horace; he is asleep.] Read the task queue';

test('each job gets a plain name: who ran it and why', () => {
  assert.equal(jobKind({ agent: 'night', origin: 'routine', ask: NIGHT }), 'Night Shift');
  assert.equal(jobKind({ agent: 'routine', origin: 'routine', ask: '[Oracle routine, not from Horace.] Casino emails: read…' }), 'Casino email check');
  assert.equal(jobKind({ agent: 'routine', origin: 'routine', ask: '[Oracle routine, not from Horace.] Prepare the morning briefing' }), 'Morning briefing prep');
  assert.equal(jobKind({ agent: 'trinity', origin: 'routine', ask: '[Trinity routine] Update the church notes' }), 'Trinity church notes');
  assert.equal(jobKind({ agent: 'oracle', origin: 'claude-code', ask: 'Bill fixes from Horace' }), 'Oracle (from Claude Code)');
  assert.equal(jobKind({ agent: 'oracle', origin: 'abc-123', ask: '[Relayed by Claude Code for Horace] budget q' }), 'Oracle (from Claude Code)');
  assert.equal(jobKind({ agent: 'architect', origin: 'abc-123', ask: 'what next' }), 'Architect (talking with you)');
});

test('a window that reset mid-job, or a missing reading, counts nothing instead of a wrong number', () => {
  assert.equal(windowDelta(job('2026-11-05T12:00:00Z', 'night', 'routine', NIGHT, { week: 38 }, { week: 40 }, 1), 'week'), 2);
  assert.equal(windowDelta(job('2026-11-05T12:00:00Z', 'night', 'routine', NIGHT, { session: 90 }, { session: 4, sessionResets: 2000 }, 1), 'session'), null);
  assert.equal(windowDelta({ before: null, after: { week: 3 } }, 'week'), null);
});

test('days are Central dates: 9 PM Thursday in Texas is still Thursday, not UTC Friday', () => {
  assert.equal(centralDate('2026-11-06T03:21:16Z'), '2026-11-05');
  assert.equal(centralDate('2026-11-06T06:30:00Z'), '2026-11-06');
});

test('the report sums dollars and week points by day and by kind, oldest day first, empty days included', () => {
  const jobs = [
    job('2026-11-04T15:00:00Z', 'oracle', 'sess', 'hi', { session: 10, week: 10 }, { session: 14, week: 11 }, 2.5),
    job('2026-11-06T03:21:16Z', 'night', 'routine', NIGHT, { session: 35, week: 50 }, { session: 52, week: 51 }, 3.38),
    job('2026-11-06T03:28:11Z', 'night', 'routine', NIGHT, { session: 52, week: 51 }, { session: 66, week: 52 }, 0.55),
    job('2026-11-06T02:30:27Z', 'morpheus', 'sess', 'a private thing', { session: 27, week: 49 }, { session: 34, week: 50 }, 1.2),
  ];
  const r = usageReport(jobs, { now: new Date('2026-11-06T04:00:00Z'), days: 3 });
  assert.deepEqual(r.days.map((d) => d.date), ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(r.days[0].jobs, 0);
  assert.equal(r.days[1].usd, 2.5);
  const thu = r.days[2];
  assert.equal(thu.jobs, 3);
  assert.equal(thu.usd, 5.13);
  assert.equal(thu.kinds['Night Shift'].usd, 3.93);
  assert.equal(thu.kinds['Night Shift'].week, 2);
  assert.equal(r.now.week, 52);
  assert.equal(r.thisWeek.usd, 7.63);
  assert.equal(r.thisWeek.byKind[0].kind, 'Night Shift');
  assert.deepEqual(r.thisWeek.nightQuick, { jobs: 1, usd: 0.55 });
  assert.equal(r.biggest[0].usd, 3.38);
  assert.equal(r.biggest.find((b) => b.kind.startsWith('Morpheus')).ask, '(private talk)', 'Morpheus talks stay private');
});

test('only jobs in the current weekly window count toward this week', () => {
  const jobs = [
    job('2026-11-01T15:00:00Z', 'oracle', 's', 'old', { week: 90, weekResets: 5000 }, { week: 95, weekResets: 5000 }, 9),
    job('2026-11-05T15:00:00Z', 'oracle', 's', 'new', { week: 1 }, { week: 3 }, 1),
  ];
  const r = usageReport(jobs, { now: new Date('2026-11-05T16:00:00Z') });
  assert.equal(r.thisWeek.jobs, 1);
  assert.equal(r.thisWeek.usd, 1);
  assert.equal(r.days.length, 14);
});

test('a missing or half-written log gives an empty report, not a crash', () => {
  assert.equal(parseLog('{"at":"2026-11-05T01:00:00Z"}\n{broken\n\n').length, 1);
  const r = readUsageReport({ now: new Date('2026-11-05T16:00:00Z'), days: 7 }, path.join(os.tmpdir(), 'no-such-usage-log.jsonl'));
  assert.equal(r.now, null);
  assert.equal(r.thisWeek.jobs, 0);
  assert.equal(r.days.length, 7);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-')), 'log.jsonl');
  fs.writeFileSync(f, JSON.stringify(job('2026-11-05T15:00:00Z', 'oracle', 's', 'x', { week: 1 }, { week: 2 }, 0.5)) + '\n');
  assert.equal(readUsageReport({ now: new Date('2026-11-05T16:00:00Z') }, f).thisWeek.usd, 0.5);
});
