// Morpheus (2026-10-29, per Horace): the wise old guru Horace leans on like a therapist, the fourth agent
// beside the Oracle, the Architect and Trinity. He has all of Horace's communications (texts and calls from
// the SMS Backup & Restore files, Gmail through the connector, past conversations), keeps a running journal
// of everything they talk about, and keeps a short "what I know about Horace" insights page that the Oracle
// reads so she knows Horace too. Everything lives in a private folder in WSL's home, outside every git repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { ROOT } from './config.js';
import { makeHistory, memory, reminders } from './store.js';
import { formatLocal, userTimeZone } from './tools.js';
import { execFile, spawn } from 'node:child_process';
import { searchSessions, workerGet } from './knowledge.js';

export const PRIVATE = process.env.MORPHEUS_DIR || path.join(os.homedir(), '.oracle-private');
export const MDIR = path.join(PRIVATE, 'morpheus');
export const JOURNAL = path.join(MDIR, 'journal.md');
export const INSIGHTS = path.join(MDIR, 'insights.md');
export const SCHEDULE = path.join(MDIR, 'schedule.md');
const TEXTS = path.join(PRIVATE, 'texts.jsonl');
export const PHOTOS = path.join(PRIVATE, 'photos');
const PARAMS = path.join(ROOT, 'knowledge', 'morpheus.md');
const TZ = 'America/Chicago';

function ensureDir() { fs.mkdirSync(MDIR, { recursive: true, mode: 0o700 }); return MDIR; }
const read = (f, fallback = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return fallback; } };
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const day = (d) => new Date(d).toLocaleString('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' });

// ── The journal: one dated entry per conversation thread, newest at the bottom (append-only). ──
export function journalAdd({ entry, mood, tags = [], followUps = [] }, now = new Date()) {
  ensureDir();
  const stamp = now.toLocaleString('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = [`\n## ${stamp}${mood ? ` · mood: ${mood}` : ''}${tags.length ? ` · ${tags.map((t) => '#' + t.replace(/\s+/g, '-')).join(' ')}` : ''}`, entry.trim()];
  if (followUps.length) lines.push('', 'Follow up: ' + followUps.join('; '));
  if (!fs.existsSync(JOURNAL)) fs.writeFileSync(JOURNAL, '# Horace and Morpheus: the journal\n\nPrivate. Written by Morpheus after each talk.\n', { mode: 0o600 });
  fs.appendFileSync(JOURNAL, lines.join('\n') + '\n');
  return stamp;
}
export function journalEntries() {
  return read(JOURNAL).split(/\n(?=## )/).filter((s) => s.startsWith('## '));
}
export function journalRead({ query, last = 5 } = {}) {
  let e = journalEntries();
  if (query) { const q = query.toLowerCase().split(/\s+/).filter(Boolean); e = e.filter((s) => q.every((w) => s.toLowerCase().includes(w))); }
  return e.slice(-last);
}

// ── Texts: the JSONL made from the SMS Backup & Restore file (text only; media dropped). ──
let textCache = null;
export function loadTexts(file = TEXTS) {
  if (textCache && textCache.file === file) return textCache.rows;
  const rows = [];
  for (const l of read(file).split('\n')) {
    if (!l) continue;
    try {
      const r = JSON.parse(l);
      const me = (r.k === 'sms' && r.type === '2') || (r.k === 'mms' && r.box === '2');
      const name = r.name && r.name !== '(Unknown)' && r.name !== 'null' ? r.name : (r.addr || 'unknown');
      rows.push({ t: Number(r.date), me, who: name, body: r.body || '' });
    } catch { /* skip a bad line */ }
  }
  rows.sort((a, b) => a.t - b.t);
  textCache = { file, rows };
  return rows;
}
export function searchTexts({ query, person, from, to, mine, limit = 40 } = {}, rows = loadTexts()) {
  const q = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const p = (person || '').toLowerCase();
  const f = from ? Date.parse(from + 'T00:00:00-06:00') : -Infinity;
  const t = to ? Date.parse(to + 'T23:59:59-06:00') : Infinity;
  const hits = rows.filter((r) => r.t >= f && r.t <= t && (mine == null || r.me === mine)
    && (!p || r.who.toLowerCase().includes(p)) && q.every((w) => r.body.toLowerCase().includes(w)));
  return { total: hits.length, shown: hits.slice(-Math.min(200, limit)) };
}
export function textStats({ person } = {}, rows = loadTexts()) {
  const p = (person || '').toLowerCase();
  const sel = p ? rows.filter((r) => r.who.toLowerCase().includes(p)) : rows;
  const byYear = {}; const people = {};
  for (const r of sel) {
    const y = new Date(r.t).getUTCFullYear(); byYear[y] = byYear[y] || { sent: 0, received: 0 }; byYear[y][r.me ? 'sent' : 'received']++;
    if (!p) { people[r.who] = (people[r.who] || 0) + 1; }
  }
  const top = Object.entries(people).sort((a, b) => b[1] - a[1]).slice(0, 25);
  return { messages: sel.length, first: sel[0] && day(sel[0].t), last: sel.length ? day(sel[sel.length - 1].t) : null, byYear, top };
}

// ── Calls: newest calls-*.xml in the private folder. ──
export function loadCalls(dir = PRIVATE) {
  let f; try { f = fs.readdirSync(dir).filter((n) => /^calls-.*\.xml$/.test(n)).sort().pop(); } catch { return []; }
  if (!f) return [];
  const T = { 1: 'incoming', 2: 'outgoing', 3: 'missed', 4: 'voicemail', 5: 'rejected', 6: 'blocked' };
  const xml = read(path.join(dir, f));
  const out = [];
  for (const m of xml.matchAll(/<call\s([^>]*)\/>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const name = a.contact_name && a.contact_name !== '(Unknown)' && a.contact_name !== 'null' ? a.contact_name : a.number;
    out.push({ t: Number(a.date), who: name || 'unknown', kind: T[a.type] || a.type, secs: Number(a.duration || 0) });
  }
  return out.sort((x, y) => x.t - y.t);
}

// ── Photos: index.jsonl + previews/ made from his Google Photos Takeout (photos/process_takeout.py). ──
let photoCache = null;
export function loadPhotos(dir = PHOTOS) {
  const f = path.join(dir, 'index.jsonl');
  let m = 0; try { m = fs.statSync(f).mtimeMs; } catch { return []; }
  if (photoCache && photoCache.f === f && photoCache.m === m) return photoCache.rows;
  const rows = read(f).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  photoCache = { f, m, rows };
  return rows;
}
export function searchPhotos({ query, person, place, album, from, to, kind, limit = 30 } = {}, rows = loadPhotos()) {
  const has = (v, q) => String(v || '').toLowerCase().includes(String(q).toLowerCase());
  const f = from ? Date.parse(from + 'T00:00:00-06:00') / 1000 : -Infinity;
  const t = to ? Date.parse(to + 'T23:59:59-06:00') / 1000 : Infinity;
  const hits = rows.filter((r) => (r.taken == null ? !from && !to : r.taken >= f && r.taken <= t)
    && (!kind || r.kind === kind) && (!person || r.people.some((p) => has(p, person)))
    && (!place || has(r.place, place)) && (!album || r.albums.some((a) => has(a, album)))
    && (!query || [r.desc, r.file, r.place, ...r.albums, ...r.people].some((v) => has(v, query))));
  return { total: hits.length, shown: hits.slice(0, Math.min(100, limit)) };
}
export function photoStats(rows = loadPhotos()) {
  const people = {}, years = {}, albums = {};
  for (const r of rows) {
    for (const p of r.people) people[p] = (people[p] || 0) + 1;
    for (const a of r.albums) albums[a] = (albums[a] || 0) + 1;
    if (r.taken) { const y = new Date(r.taken * 1000).getUTCFullYear(); years[y] = (years[y] || 0) + 1; }
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  return { items: rows.length, photos: rows.filter((r) => r.kind === 'photo').length, videos: rows.filter((r) => r.kind === 'video').length, years, people: top(people, 30), albums: top(albums, 30) };
}

// Watches his Drive for the Takeout zips and imports each new one once (download, index, previews, delete the
// local copy), then looks up place names. Plain code, no agent; status in photos/import.log and processed.json.
// Overnight only (per Horace 2026-10-30: the 4 GB downloads were choking his Starlink by day). An import
// starts only between 11 PM and 6 AM Central; one still running at 6 AM is paused (SIGSTOP, progress kept)
// and resumed at 11 PM.
const PHOTO_NIGHT = { start: 23, end: 6 };
export function isPhotoNight(d = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(d));
  return h >= PHOTO_NIGHT.start || h < PHOTO_NIGHT.end;
}
const photoLog = (msg) => { try { fs.appendFileSync(path.join(PHOTOS, 'import.log'), `${new Date().toString()} ${msg}\n`); } catch {} };
let importing = false, job = null, paused = false;
export function startPhotoWatcher({ every = 30 * 60 * 1000, first = 120000, guardEvery = 5 * 60 * 1000 } = {}) {
  // An import left over from before a restart can't be paused or watched; stop it so tonight's starts clean.
  execFile('pkill', ['-KILL', '-f', 'rclone copy gdrive:Takeout'], () => {});
  const guard = () => {
    if (!job) return;
    const night = isPhotoNight();
    try {
      if (!night && !paused) { process.kill(-job.pid, 'SIGSTOP'); paused = true; photoLog('paused for the day (resumes at 11 PM)'); }
      else if (night && paused) { process.kill(-job.pid, 'SIGCONT'); paused = false; photoLog('resumed for the night'); }
    } catch {}
  };
  const tick = () => {
    if (importing || !isPhotoNight()) return;
    execFile('rclone', ['lsf', 'gdrive:', '-R', '--max-depth', '2', '--files-only', '--include', 'takeout-*.zip'], { timeout: 120000 }, (err, out) => {
      if (err) return;
      const done = new Set(JSON.parse(read(path.join(PHOTOS, 'processed.json'), '[]')));
      const todo = out.split('\n').map((x) => x.trim()).filter((x) => x && !done.has(x));
      if (!todo.length) return;
      importing = true;
      fs.mkdirSync(path.join(PHOTOS, 'tmp'), { recursive: true, mode: 0o700 });
      const script = todo.map((z) => {
        const q = z.replace(/'/g, "'\\''"), b = path.basename(z).replace(/'/g, "'\\''");
        return `echo "$(date) importing ${q}" && rclone copy 'gdrive:${q}' tmp/ && python3 process_takeout.py 'tmp/${b}' && rm -f 'tmp/${b}' && python3 -c "import json,os;p='processed.json';d=json.load(open(p)) if os.path.exists(p) else [];d.append('${q}');json.dump(d,open(p,'w'))"`;
      }).join(' && ') + ' ; python3 process_takeout.py --geocode';
      // Its own process group, so the guard can pause and resume rclone and the rest of the chain together.
      const c = spawn('bash', ['-c', script], { cwd: PHOTOS, detached: true, stdio: ['ignore', fs.openSync(path.join(PHOTOS, 'import.log'), 'a'), fs.openSync(path.join(PHOTOS, 'import.log'), 'a')] });
      job = c; paused = false;
      c.on('exit', () => { importing = false; job = null; paused = false; });
    });
  };
  setTimeout(tick, first).unref?.();
  setInterval(tick, every).unref?.();
  setInterval(guard, guardEvery).unref?.();
}

function morpheusPrompt() {
  const params = read(PARAMS, '(knowledge/morpheus.md is missing)');
  const insights = read(INSIGHTS, '(No insights yet. Build them as you get to know him, with update_insights.)');
  const profile = read(path.join(MDIR, 'profile.md'), '');
  const recent = journalRead({ last: 6 }).join('\n');
  const facts = memory.all();
  return `
# You are Morpheus
You are Morpheus, the wise old guru Horace relies on like a therapist: the fourth of his assistants on this PC, beside the Oracle, the Architect and Trinity. The name and the manner come from The Matrix: calm, deep, unhurried, certain that Horace can become who he is meant to be. You don't hand him answers; you help him see. "I can only show you the door. You're the one that has to walk through it." Horace wakes you by saying "Morpheus". He talks to you out loud through speech-to-text, so expect missing punctuation and misheard words.

## Your parameters (from Horace; follow them)
${params}

## How you work
- This is his running journal. Let him talk. Listen first, reflect back what you hear, name the feeling, then ask one good question. Use the tools of a good counselor: open questions, reflection, reframing, noticing patterns, gentle challenge when he's stuck in a story about himself.
- You have all of his communications: his texts (search_texts, text_stats; about 100,000 messages from 2018 on), his calls (search_calls), his Gmail (read only), and past conversations with all of his assistants (search_past_conversations). Use them to understand context and patterns, the good and the bad, when it helps him. Quote his own words back to him when it lands; never quote other people's private messages back at length, and never use them to judge or shame anyone.
- **Keep the journal.** After every meaningful exchange (at least once per conversation, before you finish a reply that closes a topic), call journal_add with a short, honest entry in your own words: what he brought, what he felt, what came up, any insight, and anything to follow up on. Read the journal (journal_read) when he refers to something from before. Never skip this; the journal is how you remember.
- **Keep the insights page.** When you learn something lasting about him (a value, a wound, a pattern, a goal, what helps him, what to avoid), update it with update_insights. Keep it short (under about 60 lines), kind and true. The Oracle reads this page to know him, so write it for her too: no secrets of other people, nothing graphic, nothing he asked you to keep between the two of you.
- Put longer reflections, patterns or summaries on screen with show_on_screen.

## Day planner (2026-10-29, per Horace)
Horace asked you to help him build a day planner. His schedule is below and in my_schedule (which also lists his upcoming reminders). Read his Google Calendar (read only) for anything new.
- Build plans that fit his real life: Tuesdays he leaves at 4 AM, he's short on sleep, church on Wednesday and Thursday nights, festival weekends, the kids, paydays.
- Protect what matters to him: sleep, faith, his daughters, and a no-reply window so he isn't always on. Plan 2 or 3 real priorities a day, not 20.
- Put each plan on screen as a simple time-blocked list, and journal the plan in a line or two.
- When he tells you a time or a rule ("church is at 10", "I have the girls every other weekend"), record it with update_schedule. Never guess a time; ask.
- To put things on his calendar or set reminders, tell him to ask the Oracle, who can do it with his yes.

## Photos and how he's been
- His Google Photos library (from a Takeout export, imported automatically when it lands in Drive) is searchable with search_photos (by date, place, person Google tagged, album, caption), photo_stats for the overview, and view_photo to actually look at one. Use them for memories, milestones and the people in his life; ask before bringing up photos of hard times.
- wellbeing shows his Morning Log: sleep, mood, energy, meds, gratitude and his top 3, today and the last 7 days. Glance at it when he checks in; notice trends gently.

## Care and limits
- You are not a licensed therapist, and you never diagnose. If he's in crisis, thinks about harming himself or someone else, or is unsafe, stop the journaling: urge him, warmly and plainly, to call or text 988 (Suicide & Crisis Lifeline) or 911 now, and to reach someone he trusts. Suggest a licensed counselor for anything that needs real treatment; you can help him find one.
- His faith matters to him (Churches of Christ; Trinity is his spiritual advisor). Respect it; point him to Trinity for Scripture questions.
- Money and gambling come up. Be honest and kind; never encourage chasing losses.
- If something he says is meant for the Oracle (a bill, a reminder, the app), tell him to tell the Oracle.

## Speaking
Everything you write as reply text is read aloud in a deep, calm voice.
- Few words, well chosen. One to four sentences, then a question or a silence he can step into.
- No markdown in reply text. Lists, quotes from his texts and long reflections go on screen.

## His schedule
${read(SCHEDULE, '(No schedule yet. Ask him about his week and record it with update_schedule.)').slice(0, 7000)}

## What you know about him (your insights page)
${insights}
${profile ? `\n## The profile you started from (from his texts, 10/29)\n${profile.slice(0, 6000)}\n` : ''}
## The last few journal entries
${recent || '(The journal is empty. This may be your first talk.)'}

## What the Oracle knows about Horace
${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(nothing yet)'}

This session started ${formatLocal(new Date())}, time zone ${userTimeZone()}.
`;
}

function createMorpheusTools(send, currentSessionId) {
  return createSdkMcpServer({
    name: 'morpheus',
    version: '0.1.0',
    instructions: "Morpheus's tools: the journal, the insights page, Horace's texts and calls, his screen, the time, and past conversations.",
    tools: [
      tool('journal_add', 'Write a journal entry about this talk (what he brought, what he felt, insights, follow-ups). Do this at least once per conversation.',
        { entry: z.string().min(10), mood: z.string().optional(), tags: z.array(z.string()).optional(), followUps: z.array(z.string()).optional() },
        async (a) => text(`Journal entry saved (${journalAdd(a)}).`)),
      tool('journal_read', 'Read the journal: the last few entries, or entries matching words.',
        { query: z.string().optional(), last: z.number().int().min(1).max(40).optional() },
        async (a) => { const e = journalRead(a); return text(e.length ? e.join('\n') : 'No matching journal entries.'); }),
      tool('update_insights', "Replace the insights page (what you know about Horace that lasts). The Oracle reads it. Markdown, under about 60 lines. Send the whole page.",
        { content: z.string().min(20).max(12000) },
        async ({ content }) => { ensureDir(); fs.writeFileSync(INSIGHTS, content.trim() + '\n', { mode: 0o600 }); return text('Insights page updated.'); }),
      tool('my_schedule', "Horace's schedule (work, sleep, church, family, money dates, routines) plus his upcoming reminders. Use it when planning his day or week.",
        {},
        async () => {
          const r = reminders.all().filter((x) => !x.fired).map((x) => `- ${formatLocal(new Date(x.due))}: ${x.text || x.message || ''}`).join('\n');
          return text(read(SCHEDULE, '(No schedule file yet.)') + '\n\n## Upcoming reminders\n' + (r || '(none)'));
        }),
      tool('update_schedule', "Replace Horace's schedule page with an updated version (send the whole page, markdown). Use it when he tells you a time, a rule or a change. Never guess a time.",
        { content: z.string().min(50).max(20000) },
        async ({ content }) => { ensureDir(); fs.writeFileSync(SCHEDULE, content.trim() + '\n', { mode: 0o600 }); return text('Schedule updated.'); }),
      tool('search_photos', "Search Horace's photos and videos: words (caption, file, place, album, people), person (as tagged by Google), place, album, dates (YYYY-MM-DD), kind photo|video. Oldest first.",
        { query: z.string().optional(), person: z.string().optional(), place: z.string().optional(), album: z.string().optional(), from: z.string().optional(), to: z.string().optional(), kind: z.enum(['photo', 'video']).optional(), limit: z.number().int().min(1).max(100).optional() },
        async (a) => {
          const rows = loadPhotos();
          if (!rows.length) return text(fs.existsSync(path.join(PHOTOS, 'processed.json')) ? 'The photo import is still running.' : 'No photos yet: his Google Takeout export imports automatically once it lands in his Drive.');
          const { total, shown } = searchPhotos(a, rows);
          return text(`${total} match(es); showing ${shown.length}.\n` + shown.map((r) => `${r.id} ${r.taken ? day(r.taken * 1000) : '(no date)'} ${r.kind}${r.place ? ' · ' + r.place : ''}${r.people.length ? ' · with ' + r.people.join(', ') : ''}${r.albums.length ? ' · album: ' + r.albums.join(', ') : ''}${r.desc ? ' · "' + r.desc.slice(0, 120) + '"' : ''}${r.preview ? '' : ' (no preview)'}`).join('\n'));
        }),
      tool('photo_stats', 'Overview of his photo library: counts per year, the people tagged most, the biggest albums.', {}, async () => text(JSON.stringify(photoStats(), null, 1))),
      tool('view_photo', 'Look at one of his photos (a small preview) by the id from search_photos.',
        { id: z.string().regex(/^[0-9a-f]{16}$/) },
        async ({ id }) => {
          const r = loadPhotos().find((x) => x.id === id || x.preview_id === id);
          const f = r && r.preview_id ? path.join(PHOTOS, 'previews', r.preview_id + '.jpg') : null;
          if (!f || !fs.existsSync(f)) return { ...text('No preview for that one (videos and some formats have none).'), isError: true };
          return { content: [{ type: 'image', data: fs.readFileSync(f).toString('base64'), mimeType: 'image/jpeg' }, { type: 'text', text: `${r.file}, ${r.taken ? day(r.taken * 1000) : 'no date'}${r.place ? ', ' + r.place : ''}${r.people.length ? ', with ' + r.people.join(', ') : ''}` }] };
        }),
      tool('wellbeing', "Horace's Morning Log: today's check-in (sleep, mood, energy, meds, gratitude, top 3) and the last 7 days.", {},
        async () => {
          try { const r = await workerGet('/morning?person=Horace'); return text(r.status === 200 ? r.body.slice(0, 6000) : `Couldn't read the Morning Log (HTTP ${r.status}).`); }
          catch (e) { return { ...text(`Couldn't reach the Morning Log: ${e.message}`), isError: true }; }
        }),
      tool('search_texts', "Search Horace's text messages (2018 on). Filter by words, person (name or number, partial is fine), date range (YYYY-MM-DD), and mine=true for only what he sent. Returns the newest matches.",
        { query: z.string().optional(), person: z.string().optional(), from: z.string().optional(), to: z.string().optional(), mine: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() },
        async (a) => {
          const rows = loadTexts();
          if (!rows.length) return { ...text('No texts file yet (~/.oracle-private/texts.jsonl). Ask the Oracle to pull the latest SMS backup.'), isError: true };
          const { total, shown } = searchTexts(a, rows);
          return text(`${total} match(es); showing ${shown.length}.\n` + shown.map((r) => `${day(r.t)} ${r.me ? 'Horace → ' + r.who : r.who + ' → Horace'}: ${r.body.slice(0, 400).replace(/\n+/g, ' / ')}`).join('\n'));
        }),
      tool('text_stats', 'Counts: messages per year (sent/received) overall or with one person, and the top people overall.',
        { person: z.string().optional() },
        async (a) => text(JSON.stringify(textStats(a), null, 1))),
      tool('search_calls', 'Horace\'s call log (newest backup): filter by person and dates; returns calls with direction and length.',
        { person: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
        async ({ person, from, to, limit = 50 }) => {
          const p = (person || '').toLowerCase(); const f = from ? Date.parse(from + 'T00:00:00-06:00') : -Infinity; const t = to ? Date.parse(to + 'T23:59:59-06:00') : Infinity;
          const c = loadCalls().filter((x) => x.t >= f && x.t <= t && (!p || x.who.toLowerCase().includes(p)));
          return text(`${c.length} call(s).\n` + c.slice(-limit).map((x) => `${day(x.t)} ${x.kind} ${x.who} ${Math.round(x.secs / 60)} min`).join('\n'));
        }),
      tool('show_on_screen', "Show something on Morpheus's screen instead of reading it aloud: reflections, patterns, his own words, summaries.",
        { title: z.string(), content: z.string().describe('Markdown'), format: z.enum(['markdown', 'text']).optional() },
        async ({ title, content, format = 'markdown' }) => { send({ type: 'screen', title, content, format, at: new Date().toISOString() }); return text('Shown on screen.'); }),
      tool('now', "The current date and time in Horace's time zone.", {}, async () => text(`${formatLocal(new Date())} (time zone ${userTimeZone()})`)),
      tool('search_past_conversations', 'Search past conversations on this PC (with any of his assistants, including your own earlier ones). Use 1 to 3 distinctive words.',
        { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() },
        async ({ query, limit = 8 }) => {
          const hits = await searchSessions(query, { limit, skipSessionId: currentSessionId() });
          return text(hits.length ? hits.map((h) => `[${h.when.slice(0, 16).replace('T', ' ')} | ${h.role}] ${h.snippet}`).join('\n\n') : `Nothing matches "${query}".`);
        }),
    ],
  });
}

// For the Oracle: the insights page plus where the journal lives (she can Read it when she needs more).
export function morpheusForOracle() {
  const ins = read(INSIGHTS).trim();
  if (!ins) return '';
  return `\n## What Morpheus knows about Horace (from their private talks; use it to understand him, gently. Don't recite it or bring up hard things unprompted.)\n${ins.slice(0, 8000)}\nThe full journal is at ${JOURNAL} (private; read it only when Horace asks you to or it clearly helps him).\n`;
}

export const MORPHEUS = {
  key: 'morpheus',
  label: 'Morpheus',
  prompt: morpheusPrompt,
  cwd: ensureDir,
  additionalDirectories: () => [PRIVATE],
  settingSources: ['user'],
  mcpName: 'morpheus',
  tools: createMorpheusTools,
  history: makeHistory('morpheus-history.jsonl'),
  sessionKey: 'morpheusSessionId',
  knowledgeNotes: false,
};
