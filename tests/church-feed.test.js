// Church reminders (Night Shift #64, 11/23): Trinity's notes -> the Wolf Hall church feed. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseChurchNotes, parseEvent, parsePrayer, isoNear, plain, placeOf, uploadChurchFeed } from '../server/church-feed.js';
import { ROUTINES, routineDue } from '../server/routines.js';

// Made-up notes in the digest's format (names and numbers invented).
const NOTES = `# Church notes: Central Church of Christ, Pflugerville

Last updated: 2026-11-21 (covers emails through the evening of Nov 21, 2026).

## Upcoming events

- **Sun Nov 22 worship**: preaching Sam Example; table Joe Doe.
- **Sat Dec 5, 10:30 AM**: annual **Ladies Cookie Exchange** (Ann, Nov 17), open to all, at the building.
- **Sat Dec 12, 10 AM to noon**: **Calendar Planning Meeting** at the building, to plan next year.
- **Sun Dec 13**: **Fellowship meal** after Sunday worship.
- **Fri Nov 20, 7 PM on Zoom**: BEE meeting (already over).
- **Nov 29 to Dec 6**: Nursing Home Drive.
- **Thu Jan 7, 6:15 PM**: **Zoom study** with the India church (Meeting ID 845 4510 6784, ann@example.com).
- **Wednesdays**: the food pantry.
- **Late November**: a pantry special, maybe.
- **Thanksgiving trip (van)**: no date.

## Prayer requests and care

- **Joe Doe** (Nov 21, men's list): his yard is overgrown and he asked if someone could mow it. Call 512-555-0199 or joe@example.com.
- **Ann Roe**, a member's daughter (Nov 20, from Horace): in the hospital with pneumonia. Ask Horace for an update.
- **Biopsy, Thu Nov 5**: Sam forwarded a post asking prayers for a biopsy, "praying for no cancer." (Whose is unclear.)
- Tom Example (Oct 23): pray for the Trunk-n-Treat.
- **No date here**: should be skipped.

## Announcements

- **Sat Dec 19**: not an event list item; announcements are ignored.
`;
const NOW = new Date('2026-11-23T18:00:00Z'); // Mon Nov 23, noon Central

test('the year lands nearest the notes date (December notes, January event -> next year)', () => {
  assert.equal(isoNear('Dec', 5, '2026-11-21'), '2026-12-05');
  assert.equal(isoNear('Jan', 7, '2026-11-21'), '2027-01-07');
  assert.equal(isoNear('Oct', 25, '2026-11-21'), '2026-10-25');
  assert.equal(isoNear('Feb', 30, '2026-11-21'), '');
  assert.equal(isoNear('Foo', 3, '2026-11-21'), '');
});

test('plain words: no markdown, email, phone or link', () => {
  assert.equal(plain('**Call** 512-555-0199 or joe@example.com, see https://x.y/z now'), 'Call or, see now');
  assert.ok(!/\d{3}-\d{4}|@|https?:/.test(plain('phone (512) 555-0199, a@b.co, www.site.cc')));
  assert.ok(plain('word '.repeat(100), 40).endsWith('…'));
  assert.equal(plain('Join zoom.us/j/845 or centralchurchofchrist.cc/live, ask @kirk, +1 512 555 0199 ok'), 'Join or, ask, ok');
});

test('events: date, time, title and place from the bold date line', () => {
  assert.deepEqual(parseEvent('**Sat Dec 5, 10:30 AM**: annual **Ladies Cookie Exchange** (Ann, Nov 17), open to all, at the building.', '2026-11-21'),
    { date: '2026-12-05', time: '10:30 AM', title: 'Ladies Cookie Exchange', place: 'at the church building' });
  assert.deepEqual(parseEvent('**Sat Dec 12, 10 AM to noon**: **Calendar Planning Meeting** at the building, to plan.', '2026-11-21'),
    { date: '2026-12-12', time: '10 AM to noon', title: 'Calendar Planning Meeting', place: 'at the church building' });
  assert.equal(parseEvent('**Sun Nov 22 worship**: preaching Sam.', '2026-11-21').title, 'Sunday worship');
  assert.equal(parseEvent('**Sun Dec 13**: **Fellowship meal** after Sunday worship.', '2026-11-21').place, 'after worship');
  const zoom = parseEvent('**Fri Nov 20, 7 PM on Zoom**: BEE meeting.', '2026-11-21');
  assert.equal(zoom.time, '7 PM'); assert.equal(zoom.place, 'on Zoom'); assert.equal(zoom.title, 'BEE meeting');
  assert.deepEqual(parseEvent('**Nov 29 to Dec 6**: Nursing Home Drive.', '2026-11-21'), { date: '2026-11-29', endDate: '2026-12-06', time: '', title: 'Nursing Home Drive', place: '' });
  for (const l of ['**Wednesdays**: the food pantry.', '**Late November**: maybe.', '**Thanksgiving trip (van)**: no date.', 'no bold at all Dec 5'])
    assert.equal(parseEvent(l, '2026-11-21'), null, l);
});

test('prayer requests: name, date and the first sentence or two, without Trinity\'s notes to herself', () => {
  const p = parsePrayer('**Joe Doe** (Nov 21, men\'s list): his yard is overgrown and he asked if someone could mow it. Call 512-555-0199 or joe@example.com.', '2026-11-21');
  assert.equal(p.name, 'Joe Doe'); assert.equal(p.date, '2026-11-21');
  assert.ok(p.text.startsWith('His yard is overgrown')); assert.ok(!/512|@/.test(p.text));
  const a = parsePrayer('**Ann Roe**, a member\'s daughter (Nov 20, from Horace): in the hospital with pneumonia. Ask Horace for an update.', '2026-11-21');
  assert.equal(a.text, 'In the hospital with pneumonia.');
  const b = parsePrayer('**Biopsy, Thu Nov 5**: Sam forwarded a post asking prayers for a biopsy, "praying for no cancer." (Whose is unclear.)', '2026-11-21');
  assert.equal(b.name, 'Biopsy'); assert.equal(b.date, '2026-11-05'); assert.ok(b.text.endsWith('cancer."'));
  assert.equal(parsePrayer('Tom Example (Oct 23): pray for the Trunk-n-Treat.', '2026-11-21').name, 'Tom Example');
  assert.equal(parsePrayer('**No date here**: should be skipped.', '2026-11-21'), null);
});

test('the whole file: upcoming dated events only (past and undated left out), prayers newest first, no private bits', () => {
  const f = parseChurchNotes(NOTES, NOW);
  assert.equal(f.notesUpdated, '2026-11-21');
  assert.deepEqual(f.events.map((e) => e.date), ['2026-11-29', '2026-12-05', '2026-12-12', '2026-12-13', '2027-01-07']);
  assert.equal(f.events[0].id, '2026-11-29-nursing-home-drive');
  assert.deepEqual(f.prayers.map((p) => p.name), ['Joe Doe', 'Ann Roe', 'Biopsy', 'Tom Example']);
  assert.equal(f.prayers[0].id, 'joe-doe-2026-11-21');
  const all = JSON.stringify(f);
  assert.ok(!/@|\d{3}-\d{4}|845 4510|https?:/.test(all), 'no email, phone, meeting id or link');
  assert.ok(!JSON.stringify(f.events).includes('Sat Dec 19'), 'announcements are not events (v368: they ride along as shared notes for Taylor\'s Trinity)');
});

test('a reworded line keeps its id, so a request is never pushed twice', () => {
  const a = parseChurchNotes(NOTES, NOW).prayers[0].id;
  const b = parseChurchNotes(NOTES.replace('his yard is overgrown', 'his lawn needs mowing badly'), NOW).prayers[0].id;
  assert.equal(a, b);
});

test('upload: posts the feed with the master key, then skips it when nothing changed that day', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-'));
  const file = path.join(dir, 'Church notes.md'); fs.writeFileSync(file, NOTES);
  let s = {}; const store = { get: () => s, set: (p) => { s = { ...s, ...p }; } };
  const calls = [];
  const fetchFn = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const quiet = { log() {} };
  const r1 = await uploadChurchFeed({ file, fetchFn, key: () => 'K', store, now: NOW, log: quiet });
  assert.equal(r1.ok, true); assert.equal(r1.events, 5); assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/church/feed')); assert.equal(calls[0].opts.method, 'POST'); assert.equal(calls[0].opts.headers['X-Worker-Key'], 'K');
  const sent = JSON.parse(calls[0].opts.body); assert.equal(sent.events.length, 5); assert.equal(sent.prayers.length, 4);
  const r2 = await uploadChurchFeed({ file, fetchFn, key: () => 'K', store, now: NOW, log: quiet });
  assert.equal(r2.unchanged, true); assert.equal(calls.length, 1);
  const r3 = await uploadChurchFeed({ file, fetchFn, key: () => 'K', store, now: new Date('2026-11-24T12:00:00Z'), log: quiet });
  assert.equal(r3.ok, true); assert.equal(calls.length, 2, 'a new day uploads again');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('upload never throws: no notes file, worker error, network down', async () => {
  const quiet = { log() {} }, store = { get: () => ({}), set() {} };
  assert.equal((await uploadChurchFeed({ file: '/nope/Church notes.md', store, log: quiet })).ok, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-')); const file = path.join(dir, 'n.md'); fs.writeFileSync(file, NOTES);
  const bad = await uploadChurchFeed({ file, store, log: quiet, key: () => 'K', fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ error: 'not allowed' }) }) });
  assert.deepEqual(bad, { ok: false, error: 'not allowed' });
  const down = await uploadChurchFeed({ file, store, log: quiet, key: () => 'K', fetchFn: async () => { throw new Error('offline'); } });
  assert.deepEqual(down, { ok: false, error: 'offline' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the routine: code only, at 6 AM and 6:30 PM Central (before the 7 AM and 7 PM pushes)', () => {
  const r = ROUTINES.find((x) => x.key === 'churchFeed');
  assert.ok(r && typeof r.run === 'function' && !r.agent && !r.prompt);
  assert.equal(routineDue(r, new Date('2026-11-23T11:59:00Z'), null), null); // 5:59 AM CST
  assert.equal(routineDue(r, new Date('2026-11-23T12:05:00Z'), null), '2026-11-23@06:00');
  assert.equal(routineDue(r, new Date('2026-11-23T12:30:00Z'), '2026-11-23@06:00'), null);
  assert.equal(routineDue(r, new Date('2026-11-24T00:35:00Z'), '2026-11-23@06:00'), '2026-11-23@18:30'); // 6:35 PM CST
});

test("Trinity's digest is asked to keep the two formats the reminders read", () => {
  const d = ROUTINES.find((x) => x.key === 'churchDigest');
  assert.match(d.prompt, /- \*\*Sat Dec 5, 10:30 AM\*\*: \*\*Ladies Cookie Exchange\*\* at the building\./);
  assert.match(d.prompt, /- \*\*Brian Hatherly\*\* \(Nov 21\): what to pray for\./);
  assert.match(d.prompt, /Read only, never reply or change email/);
});
