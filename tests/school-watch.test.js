// School attendance alerts (Night Shift #110, 11/24): the 4:10 PM school-day Gmail check. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCHOOL_GMAIL_QUERY, schoolDayToday, cleanNotice, postSchoolNotices, schoolPrompt } from '../server/school-watch.js';
import { ROUTINES, routineDue } from '../server/routines.js';
import { unattendedBlock } from '../server/agent.js';

const quiet = { log: () => {} };
const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const key = () => 'k';

test('the Gmail search: the district domain, two days back, attendance words', () => {
  assert.match(SCHOOL_GMAIL_QUERY, /^from:jarrellisd\.org newer_than:2d /);
  for (const w of ['absence', 'absense', 'tardy', 'attendance']) assert.ok(SCHOOL_GMAIL_QUERY.includes(w), w);
});

test('school day: asks the app for today in Central time with the key', async () => {
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return reply(200, { ok: true, day: { school: true } })(); };
  const yes = await schoolDayToday({ fetchFn, key, now: new Date('2026-12-01T22:10:00Z'), log: quiet });
  assert.equal(yes, true);
  assert.match(seen.url, /\/school\?day=2026-12-01$/);
  assert.equal(seen.init.headers['X-Worker-Key'], 'k');
  // 11:30 PM Central on Dec 1 is still Dec 1 there (Dec 2 in UTC)
  await schoolDayToday({ fetchFn, key, now: new Date('2026-12-02T05:30:00Z'), log: quiet });
  assert.match(seen.url, /day=2026-12-01$/);
});

test('school day: a holiday, the app down, or v359 not live yet all mean skip', async () => {
  assert.equal(await schoolDayToday({ fetchFn: reply(200, { ok: true, day: { school: false, why: 'Thanksgiving Break' } }), key, log: quiet }), false);
  assert.equal(await schoolDayToday({ fetchFn: reply(404, { error: 'not found' }), key, log: quiet }), false);
  assert.equal(await schoolDayToday({ fetchFn: async () => { throw new Error('offline'); }, key, log: quiet }), false);
});

test('cleanNotice trims and keeps only his own Gmail link', () => {
  const n = cleanNotice({ emailId: 'abc', from: 'no-reply_skyward@jarrellisd.org', subject: 'Student Absence', body: 'x'.repeat(5000), date: '2026-11-10T21:55:27Z', link: 'https://mail.google.com/mail/?x' });
  assert.equal(n.body.length, 3000);
  assert.equal(n.link, 'https://mail.google.com/mail/?x');
  assert.equal(cleanNotice({ emailId: 'a', link: 'https://evil.example/' }).link, undefined);
});

test('postSchoolNotices: POST /school/absence with the key, at most 30', async () => {
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return reply(200, { ok: true, pushed: [], skipped: [] })(); };
  const r = await postSchoolNotices(Array.from({ length: 40 }, (_, i) => ({ emailId: 'e' + i, from: 'a@jarrellisd.org', subject: 's', body: 'b', date: '2026-11-10T21:55:27Z' })), { fetchFn, key });
  assert.equal(r.status, 200);
  assert.match(seen.url, /\/school\/absence$/);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['X-Worker-Key'], 'k');
  assert.equal(JSON.parse(seen.init.body).notices.length, 30);
});

test('the routine: 4:10 PM, the routine session, retries, school-day guard, read-only prompt', () => {
  const r = ROUTINES.find((x) => x.key === 'schoolAttendance');
  assert.ok(r);
  assert.equal(r.agent, 'routine');
  assert.ok(r.fresh && r.retryOnFail);
  assert.deepEqual(r.times, [{ hour: 16, minute: 10 }]);
  assert.equal(typeof r.guard, 'function');
  assert.equal(r.prompt, schoolPrompt());
  assert.match(r.prompt, /read only/);
  assert.match(r.prompt, /school_attendance/);
  assert.match(r.prompt, /Never reply to, label, archive or change any email/);
  // 4:09 PM Central: not yet; 4:10: due; 8 PM: too late; once done, not again that day
  assert.equal(routineDue(r, new Date('2026-12-01T22:09:00Z'), null), null);
  assert.equal(routineDue(r, new Date('2026-12-01T22:10:00Z'), null), '2026-12-01@16:10');
  assert.equal(routineDue(r, new Date('2026-12-02T02:00:00Z'), null), null);
  assert.equal(routineDue(r, new Date('2026-12-01T23:00:00Z'), '2026-12-01@16:10'), null);
});

test('it runs before the Night Shift in the list (pace mode keeps the night session busy by day)', () => {
  const i = ROUTINES.findIndex((x) => x.key === 'schoolAttendance'), n = ROUTINES.findIndex((x) => x.key === 'nightShift');
  assert.ok(i >= 0 && n >= 0 && i < n);
});

test('the scheduler waits for an async guard', () => {
  const src = fs.readFileSync(new URL('../server/routines.js', import.meta.url), 'utf8');
  assert.match(src, /if \(r\.guard && !\(await r\.guard\(\)\)\)/);
});

test('an unattended routine may use the school tool and read Gmail, but not change email', () => {
  assert.equal(unattendedBlock('mcp__watson__school_attendance', { notices: [] }), null);
  assert.equal(unattendedBlock('mcp__claude_ai_Gmail__search_threads', {}), null);
  assert.equal(unattendedBlock('mcp__claude_ai_Gmail__get_thread', {}), null);
  assert.ok(unattendedBlock('mcp__claude_ai_Gmail__send_message', {}));
  assert.ok(unattendedBlock('mcp__claude_ai_Gmail__label_message', {}));
});

test('the tool is registered and posts through postSchoolNotices', () => {
  const src = fs.readFileSync(new URL('../server/tools.js', import.meta.url), 'utf8');
  assert.match(src, /'school_attendance'/);
  assert.match(src, /postSchoolNotices\(notices\)/);
});
