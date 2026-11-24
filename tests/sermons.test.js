// Sermon notes from Central's YouTube channel (Night Shift #74, 11/24). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { titleDate, parseItem, notedFrom, pickNew, cleanVtt, prepareSermons, sermonPrompt, marker, CHANNEL } from '../server/sermons.js';
import { ROUTINES, routineDue } from '../server/routines.js';
import { parseChurchNotes, DISH_RE } from '../server/church-feed.js';

// Real titles from the channel (11/24), in yt-dlp's "id|title|duration|live_status" print format.
const VIDEOS = [
  'n4ILGmkeKUI|Spanish Class and Worship  22 November 2026|7851|NA',
  'fyDPB0-4rz0|Parables of Jesus: The Persistent Widow - Luke 18:1-8 - 15 November 2026 AM|2150|NA',
  '5m-lRI8sjik|Parables of Jesus: The Pharisee and Tax Collector - Luke 18:9-14 - 15 November 2026 PM|2488|NA',
  'QPGzSQdCKpY|Q&A: Is Satan Bound? - Revelation 20:1-3 - 25 October 2026 QA|2700|NA',
  'Wl-F7eoqLvo|Parables of Jesus: The Dishonest Manager - Luke 16:1-15 - October 18 2026|4007|NA',
  '05aotS-a-8c|Live Like Jesus: He Loves (but does He like what you are doing)? - John 8:1-11 - 4 October 2026 AMPM|2726|NA',
  'vVPIQChL3iM|The Parables of Jesus: Searching and Seeking - Luke 15:1-32 - 20 September 2026 AM-PM|3916|NA',
  'Tsbh0peif0Q|Why is Philemon in the Canon of the Bible? - 27 September 2026|433|NA',
  'abcdefghijk|A short clip - 15 November 2026|90|NA',
];
const STREAMS = [
  'TlV_l1j5xpo|Live Stream November 29 2026|NA|is_upcoming',
  '_wLVng_aGTk|Live Stream Evening November 22, 2026|3051|was_live',
  '9QCcfk9KOIk|Live Stream November 22 2026|4540|was_live',
  'XCTbwOOh92k|Live Stream Evening November 15, 2026|3995|was_live',
  'Z99gHOL6BJo|Live Stream November 15 2026|5115|was_live',
];
const NOW = new Date('2026-11-24T09:00:00Z');
const vids = () => VIDEOS.map((l) => parseItem(l, 'video')).filter(Boolean);
const streams = () => STREAMS.map((l) => parseItem(l, 'stream')).filter(Boolean);

test('the channel is the one the church website links to', () => {
  assert.equal(CHANNEL, 'https://www.youtube.com/@centralchurchofchristatpfl7355');
});

test('dates in all three title styles, and impossible dates refused', () => {
  assert.equal(titleDate('X - 15 November 2026 AM'), '2026-11-15');
  assert.equal(titleDate('X - October 18 2026'), '2026-10-18');
  assert.equal(titleDate('Live Stream Evening November 22, 2026'), '2026-11-22');
  assert.equal(titleDate('Live Stream February 30 2026'), '');
  assert.equal(titleDate('No date here'), '');
});

test('titles -> services: AM, PM, Q&A, both-services videos, streams; Spanish, upcoming and clips left out', () => {
  const v = vids();
  assert.deepEqual(v.map((x) => x.key), ['2026-11-15 AM', '2026-11-15 PM', '2026-10-25 QA', '2026-10-18 AM', '2026-10-04 AM', '2026-09-20 AM', '2026-09-27 AM']);
  const s = streams();
  assert.deepEqual(s.map((x) => x.key), ['2026-11-22 PM', '2026-11-22 AM', '2026-11-15 PM', '2026-11-15 AM']);
  assert.ok(s.every((x) => x.kind === 'stream'));
  assert.equal(parseItem('bad line', 'video'), null);
  assert.equal(parseItem('short|Title 1 November 2026|NA|NA', 'video'), null);
});

test('picks newest first: streams only stand in where no edited video exists yet, within the look-back, at most 3', () => {
  const p = pickNew(vids(), streams(), notedFrom(''), { now: NOW, max: 10 });
  assert.deepEqual(p.map((x) => `${x.key} ${x.kind}`), [
    '2026-11-22 AM stream', '2026-11-22 PM stream',
    '2026-11-15 AM video', '2026-11-15 PM video',
    '2026-10-25 QA video', '2026-10-18 AM video',
  ]);
  assert.equal(pickNew(vids(), streams(), notedFrom(''), { now: NOW }).length, 3);
});

test('what is already in the notes is skipped, and a service written from its stream skips the later edited video', () => {
  const notes = `# Sermon notes\n## Sun Nov 22\n${marker({ id: '9QCcfk9KOIk', key: '2026-11-22 AM', kind: 'stream' })}\n## Sun Nov 15\n${marker({ id: 'fyDPB0-4rz0', key: '2026-11-15 AM', kind: 'video' })}\n`;
  const noted = notedFrom(notes);
  assert.ok(noted.ids.has('9QCcfk9KOIk') && noted.streamKeys.has('2026-11-22 AM') && !noted.streamKeys.has('2026-11-15 AM'));
  const edited = [...vids(), parseItem('zzzzzzzzzzz|Some Sermon - 22 November 2026 AM|2000|NA', 'video')];
  const p = pickNew(edited, streams(), noted, { now: NOW, max: 10 }).map((x) => x.key);
  assert.ok(!p.includes('2026-11-22 AM'), 'the edited video of a service noted from its stream is left alone');
  assert.ok(p.includes('2026-11-22 PM') && p.includes('2026-11-15 PM') && !p.includes('2026-11-15 AM'));
  // Two edited videos for the same service are both kept (a short extra lesson after the sermon).
  const two = [parseItem('aaaaaaaaaaa|Sermon - 8 November 2026 AM|2300|NA', 'video'), parseItem('bbbbbbbbbbb|Extra lesson - 8 November 2026|500|NA', 'video')];
  assert.equal(pickNew(two, [], notedFrom(''), { now: NOW }).length, 2);
});

test('rolling auto-captions are cleaned: no timings, tags or repeated lines', () => {
  const vtt = `WEBVTT\nKind: captions\nLanguage: en\n\n00:00:01.000 --> 00:00:02.000 align:start position:0%\n \n[music]\n\n00:00:02.000 --> 00:00:04.000 align:start position:0%\n \ngood<00:00:02.500><c> morning</c><c> church</c>\n\n00:00:04.000 --> 00:00:04.010 align:start position:0%\ngood morning church\n \n\n00:00:04.010 --> 00:00:06.000 align:start position:0%\ngood morning church\nturn<00:00:04.500><c> to</c><c> Luke</c><c> 18</c>\n`;
  assert.equal(cleanVtt(vtt), '[music] good morning church turn to Luke 18');
});

test('prepare saves captions once, skips services with no captions yet, and the prompt lists each with its marker', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sermons-test-'));
  const notesFile = path.join(dir, 'Sermon notes.md');
  let calls = 0;
  const list = async (tab) => (tab === 'videos' ? VIDEOS : STREAMS);
  const captions = async (id) => { calls++; return id === '_wLVng_aGTk' ? '' : 'word '.repeat(500); };
  const log = { log() {} };
  const ready = await prepareSermons({ list, captions, notesFile, dir: path.join(dir, 't'), now: NOW, log });
  assert.deepEqual(ready.map((r) => r.key), ['2026-11-22 AM', '2026-11-15 AM']); // 22 PM has no captions yet (tried again tomorrow); the cap of 3 stops before 15 PM
  assert.ok(fs.readFileSync(ready[0].file, 'utf8').startsWith('Live Stream November 22 2026\nhttps://www.youtube.com/watch?v=9QCcfk9KOIk'));
  const again = await prepareSermons({ list, captions, notesFile, dir: path.join(dir, 't'), now: NOW, log });
  assert.equal(calls, 3 + 1, 'saved transcripts are not fetched again; only the one with no captions is tried again');
  assert.equal(again.length, 2);
  const prompt = sermonPrompt(ready);
  assert.match(prompt, /<!-- sermon yt:9QCcfk9KOIk svc:2026-11-22 AM stream -->/);
  assert.match(prompt, /yours only/i);
  assert.match(prompt, /never post, comment, like or subscribe/i);
  assert.doesNotMatch(prompt, /show_on_screen\b(?!;)/);
  assert.equal(sermonPrompt([]), '', 'nothing new -> no prompt, so Trinity is not asked');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('routines: sermons every evening for Trinity; class prep Monday mornings; both quiet', () => {
  const s = ROUTINES.find((r) => r.key === 'sermonNotes');
  assert.equal(s.agent, 'trinity');
  assert.equal(typeof s.prepare, 'function');
  assert.equal(routineDue(s, new Date('2026-11-23T02:30:00Z'), null), '2026-11-22'); // Sun 8:30 PM Central
  assert.equal(routineDue(s, new Date('2026-11-23T01:30:00Z'), null), null); // 7:30 PM: not yet
  assert.equal(s.prompt([]), '');
  const c = ROUTINES.find((r) => r.key === 'classPrep');
  assert.equal(c.agent, 'trinity');
  assert.equal(routineDue(c, new Date('2026-11-23T15:00:00Z'), null), '2026-11-23'); // Mon 9 AM Central
  assert.equal(routineDue(c, new Date('2026-11-24T15:00:00Z'), null), null); // Tuesday
  assert.match(c.prompt, /no Monday class this week/);
  assert.match(c.prompt, /ESV/);
  assert.match(c.prompt, /Work quietly/);
});

test('church meals get "(bring a dish)" in the reminder, without changing the event id', () => {
  const notes = `Last updated: 2026-11-21\n\n## Upcoming events\n\n- **Sun Dec 13**: **Fellowship meal** after Sunday worship.\n- **Sun Dec 20**: **Potluck** after worship.\n- **Sat Dec 5, 10:30 AM**: **Ladies Cookie Exchange** at the building.\n`;
  const ev = parseChurchNotes(notes, new Date('2026-11-23T18:00:00Z')).events;
  const by = Object.fromEntries(ev.map((e) => [e.id, e.title]));
  assert.equal(by['2026-12-13-fellowship-meal'], 'Fellowship meal (bring a dish)');
  assert.equal(by['2026-12-20-potluck'], 'Potluck (bring a dish)');
  assert.equal(by['2026-12-05-ladies-cookie-exchange'], 'Ladies Cookie Exchange');
  assert.ok(DISH_RE.test('covered-dish lunch') && DISH_RE.test('bring a side') && !DISH_RE.test('Lord\'s Supper'));
});

test('the church week joins the uploaded feed (not the plain parse): Sunday says when to leave; a dated worship note wins', async () => {
  const { weeklyEvents } = await import('../server/church-feed.js');
  const w = weeklyEvents('2026-11-24');
  assert.deepEqual(w.map((e) => `${e.date} ${e.title}`), ['2026-11-25 Wednesday Bible study and devotional', '2026-11-29 Bible study 9:30 AM, worship 10:30 AM (leave by 8:30)']);
  assert.ok(w.every((e) => /-weekly$/.test(e.id)));
  const notes = `Last updated: 2026-11-24\n\n## Upcoming events\n\n- **Sun Nov 29, 10:30 AM**: **Special worship** with a guest preacher.\n`;
  const now = new Date('2026-11-24T18:00:00Z');
  assert.equal(parseChurchNotes(notes, now).events.length, 1, 'the plain parse is unchanged');
  const ev = parseChurchNotes(notes, now, { weekly: true }).events.map((e) => `${e.date} ${e.title}`);
  assert.deepEqual(ev, ['2026-11-25 Wednesday Bible study and devotional', '2026-11-29 Special worship']);
  let body = null;
  const fetchFn = async (url, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ ok: true }) }; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-test-'));
  const file = path.join(dir, 'Church notes.md'); fs.writeFileSync(file, notes);
  const { uploadChurchFeed } = await import('../server/church-feed.js');
  const store = { v: {}, get() { return this.v; }, set(x) { Object.assign(this.v, x); } };
  await uploadChurchFeed({ file, fetchFn, key: () => 'k', store, now, log: { log() {} } });
  assert.ok(body.events.some((e) => e.id === '2026-11-25-wednesday-night-weekly'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Trinity\'s digest knows Horace is "Levi" at church and turns his and Taylor\'s turns into reminders', () => {
  const d = ROUTINES.find((r) => r.key === 'churchDigest');
  assert.match(d.prompt, /goes by Levi/);
  assert.match(d.prompt, /Privileged to serve/);
  assert.match(d.prompt, /\*\*Sun Nov 29\*\*: \*\*Levi: closing prayer\*\*/);
});
