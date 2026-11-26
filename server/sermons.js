// Sermon notes for Trinity (Night Shift queue #74, 11/24; Horace 9B, 10, round 3: "sermon notes go to Trinity only").
// Central Church of Christ (Pflugerville) posts every Sunday on YouTube: the live streams (morning 10:30 AM, evening
// 5 PM) and, a few days later, edited sermon videos with the series, scripture and date in the title. Each evening
// this lists the channel in code (yt-dlp, no download, no sign-in), takes the English sermons from the last few
// weeks that aren't in Trinity's "Sermon notes.md" yet (the edited video when there is one, otherwise the stream),
// saves their free auto-captions as plain text in her study folder, and only then asks Trinity to write the notes.
// Nothing is posted, liked, commented or subscribed; nothing is pushed to anyone. Read only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STUDY, SERMON_FILE } from './trinity.js';

const run = promisify(execFile);
export const CHANNEL = 'https://www.youtube.com/@centralchurchofchristatpfl7355'; // linked from centralchurchofchrist.cc
export const SERMON_NOTES = SERMON_FILE;
export const TRANSCRIPTS = path.join(STUDY, 'Sermon transcripts');
export const SINCE_DAYS = 45; // look back this far; older services are left alone
export const MAX_PER_RUN = 3; // a cap on one evening's reading (a stream's captions run about 15,000 words)
const MIN_SECONDS = 240; // skip clips and announcements
const YTDLP = [path.join(os.homedir(), '.local/bin/yt-dlp'), 'yt-dlp'];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The service date in a title: "15 November 2026", "October 18 2026", "November 22, 2026" -> "2026-11-15". */
export function titleDate(title) {
  const t = String(title || '');
  let m = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s+(\d{4})\b/i.exec(t);
  let d, mon, y;
  if (m) [, d, mon, y] = m;
  else if ((m = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*,?\s+(\d{4})\b/i.exec(t))) [, mon, d, y] = m;
  else return '';
  const mi = MONTHS.indexOf(mon.toLowerCase());
  const iso = `${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const back = new Date(iso + 'T12:00:00Z');
  return back.getUTCMonth() === mi && back.getUTCDate() === Number(d) ? iso : '';
}

/**
 * One line of `yt-dlp --flat-playlist --print "%(id)s|%(title)s|%(duration)s|%(live_status)s"` -> a service, or
 * null for what isn't an English sermon: the Spanish class and worship (Horace worships in English), upcoming or
 * still-live streams, short clips, titles with no date.
 */
export function parseItem(line, kind) {
  const parts = String(line || '').trim().split('|');
  if (parts.length < 4) return null;
  const id = parts[0], status = parts[parts.length - 1], duration = Number(parts[parts.length - 2]);
  const title = parts.slice(1, -2).join('|').replace(/\s+/g, ' ').trim();
  if (!/^[\w-]{11}$/.test(id) || !title) return null;
  if (/spanish|espa[ñn]ol|iglesia|adoraci[oó]n/i.test(title)) return null;
  if (status === 'is_upcoming' || status === 'is_live') return null;
  if (!(duration >= MIN_SECONDS)) return null;
  const date = titleDate(title);
  if (!date) return null;
  let service = 'AM';
  if (kind === 'stream') service = /evening/i.test(title) ? 'PM' : 'AM';
  else if (/\bQ\s*&\s*A\b|\bQA\s*$/i.test(title)) service = 'QA';
  else if (/\bPM\s*$/i.test(title) && !/\bAM\s*-?\s*PM\s*$/i.test(title)) service = 'PM';
  return { id, title, date, service, key: `${date} ${service}`, kind, seconds: duration };
}

/** The line Trinity copies under each sermon's heading; the routine reads it to know that service is done. */
export const marker = (s) => `<!-- sermon yt:${s.id} svc:${s.key}${s.kind === 'stream' ? ' stream' : ''} -->`;

/** What Trinity has already written: video ids, and the services written up from a live stream. */
export function notedFrom(text) {
  const ids = new Set(), streamKeys = new Set();
  for (const m of String(text || '').matchAll(/<!--\s*sermon\s+yt:([\w-]{11})\s+svc:(\d{4}-\d{2}-\d{2} (?:AM|PM|QA))(\s+stream)?\s*-->/g)) {
    ids.add(m[1]);
    if (m[3]) streamKeys.add(m[2]);
  }
  return { ids, streamKeys };
}

/**
 * The services to write up next, newest first. Every edited sermon video counts (one Sunday can have a short
 * extra lesson as well); a live stream only stands in for a service that has no edited video yet, and once a
 * service has been written up from its stream, the edited video that comes later is left alone.
 */
export function pickNew(videos, streams, noted, { now = new Date(), sinceDays = SINCE_DAYS, max = MAX_PER_RUN } = {}) {
  const since = new Date(now.getTime() - sinceDays * 86400000).toISOString().slice(0, 10);
  const recent = (v) => v && v.date >= since;
  const edited = videos.filter(recent);
  const editedKeys = new Set(edited.map((v) => v.key));
  const picks = new Map();
  for (const v of edited) if (!noted.ids.has(v.id) && !noted.streamKeys.has(v.key) && !picks.has(v.id)) picks.set(v.id, v);
  for (const s of streams.filter(recent)) {
    if (noted.ids.has(s.id) || noted.streamKeys.has(s.key) || editedKeys.has(s.key)) continue;
    if ([...picks.values()].some((p) => p.key === s.key)) continue;
    picks.set(s.id, s);
  }
  const order = { AM: 0, PM: 1, QA: 2 };
  return [...picks.values()].sort((a, b) => b.date.localeCompare(a.date) || order[a.service] - order[b.service] || b.seconds - a.seconds).slice(0, max);
}

/** YouTube's rolling auto-captions (WEBVTT with <c> word timings, each line shown twice) -> plain paragraphs. */
export function cleanVtt(vtt) {
  const out = [];
  let last = '', before = '';
  for (const raw of String(vtt || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l === 'WEBVTT' || /^(Kind|Language):/.test(l) || /-->/.test(l) || /^\d+$/.test(l)) continue;
    const t = l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t === last || t === before) continue;
    if (/^\[(music|singing|chanting|applause|laughter)\]$/i.test(t) && /^\[/.test(last)) continue;
    before = last; last = t; out.push(t);
  }
  // About 80 words a paragraph, so Trinity can quote and skim.
  const words = out.join(' ').split(/\s+/).filter(Boolean);
  const paras = [];
  for (let i = 0; i < words.length; i += 80) paras.push(words.slice(i, i + 80).join(' '));
  return paras.join('\n\n');
}

async function ytdlp(args, opts = {}) {
  let err;
  for (const bin of YTDLP) {
    try { return await run(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: 180000, ...opts }); } catch (e) { err = e; if (e.code !== 'ENOENT') throw e; }
  }
  throw err;
}

/** The channel's uploads and streams, as raw print lines. */
export async function listChannel(tab) {
  const { stdout } = await ytdlp(['--flat-playlist', '--playlist-end', '30', '--print', '%(id)s|%(title)s|%(duration)s|%(live_status)s', `${CHANNEL}/${tab}`]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

/** Free English captions for one video (auto or uploaded), cleaned. '' when YouTube has none yet. */
export async function fetchCaptions(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sermon-'));
  try {
    await ytdlp(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'en', '--sub-format', 'vtt', '-o', path.join(dir, '%(id)s'), `https://www.youtube.com/watch?v=${id}`]);
    const f = fs.readdirSync(dir).find((n) => n.endsWith('.vtt'));
    return f ? cleanVtt(fs.readFileSync(path.join(dir, f), 'utf8')) : '';
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export const transcriptName = (s) => `${s.key} ${s.id}.txt`;

/**
 * Finds what's new and saves its captions. Returns the services ready for Trinity ([] when there's nothing new).
 * A service whose captions YouTube hasn't made yet is left for tomorrow evening.
 */
export async function prepareSermons({ list = listChannel, captions = fetchCaptions, notesFile = SERMON_NOTES, dir = TRANSCRIPTS, now = new Date(), max = MAX_PER_RUN, log = console } = {}) {
  let notes = ''; try { notes = fs.readFileSync(notesFile, 'utf8'); } catch { /* first run */ }
  const [vids, streams] = await Promise.all([list('videos'), list('streams')]);
  const picks = pickNew(vids.map((l) => parseItem(l, 'video')).filter(Boolean), streams.map((l) => parseItem(l, 'stream')).filter(Boolean), notedFrom(notes), { now, max });
  fs.mkdirSync(dir, { recursive: true });
  const ready = [];
  for (const s of picks) {
    const file = path.join(dir, transcriptName(s));
    let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { /* not saved yet */ }
    if (!text) {
      try { text = await captions(s.id); } catch (e) { log.log(`  Sermons: captions for ${s.key} failed (${String(e.message).split('\n')[0]})`); continue; }
      if (!text || text.split(/\s+/).length < 200) { log.log(`  Sermons: no captions yet for ${s.key}`); continue; }
      fs.writeFileSync(file, `${s.title}\nhttps://www.youtube.com/watch?v=${s.id}\n${s.kind === 'stream' ? 'Whole service (live stream)' : 'Sermon video'}, auto-captions (may mishear names and words)\n\n${text}\n`);
    }
    ready.push({ ...s, file, words: text.split(/\s+/).length });
  }
  return ready;
}

/** Trinity's job for the evening, or '' when nothing is new (the routine then skips her). */
export function sermonPrompt(ready) {
  if (!ready || !ready.length) return '';
  const list = ready.map((s) => `- ${s.key}: "${s.title}" (${s.kind === 'stream' ? 'the whole service from the live stream; find the sermon in it' : 'the sermon video'}), transcript: ${s.file}, marker: ${marker(s)}`).join('\n');
  return [
    '[Trinity routine, not from Horace. Work quietly: no show_on_screen; final reply one line.]',
    `New sermons from Central's YouTube channel. Read each transcript (YouTube auto-captions: names and some words are misheard; never present a misheard word as a quote) and add notes for it to ${SERMON_NOTES}.`,
    list,
    'For each one, add a section near the top of the file (newest first, under the "# Sermon notes" title; create the file with that title if it is missing) in exactly this shape:',
    '"## <Sun Nov 15, 2026>, morning|evening|Q&A: <sermon title>", then its marker line from the list above copied exactly (the routine reads it to know that sermon is done), then:',
    '- **Preacher:** (the name if said or in your church notes, else "not stated") - **Series:** (if any) - **Scripture:** (the main text and others read, ESV book names)',
    '- **Main points:** 3 to 6 short bullets in plain words.',
    '- **Quotes:** 2 or 3 short lines in the preacher\'s own words, only where the captions are clearly right.',
    '- **For this week:** one line Horace and Taylor could live out.',
    '- **Also mentioned:** announcements, events or prayer needs said from the pulpit, only if any (these help the church notes).',
    '- **Watch:** https://youtu.be/<video id>',
    'For a live stream, skip the songs, prayers and Lord\'s Supper and write up the sermon; if a stream has no sermon you can find, still add its section and marker with one line saying so.',
    'Sermon notes are yours only (Horace, 11/23): never share them, push them or put them in Wolf Hall. Read only: never post, comment, like or subscribe.',
    'Then reply with one line: which sermons you added.',
  ].join('\n');
}
