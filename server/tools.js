// The Oracle's own tools, served in-process to the agent as the "watson" MCP server.
import crypto from 'node:crypto';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { memory, reminders, state } from './store.js';
import { describeConnection } from './starlink.js';
import { claudeMemories, searchSessions, workerGet, workerGetWrites, workerPostGambling, workerPostMorning } from './knowledge.js';

const text = (t) => ({ content: [{ type: 'text', text: t }] });

export function userTimeZone() {
  return state.get().timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatLocal(date, tz = userTimeZone()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

/** `send(event)` broadcasts an event to every connected the Oracle screen. */
export function createWatsonTools(send, currentSessionId = () => null) {
  return createSdkMcpServer({
    name: 'watson',
    version: '0.1.0',
    instructions: 'The Oracle\'s own tools: put things on the screen, remember facts about the user, set spoken reminders, search past Claude Code conversations, and read the live Wolf Hall budget.',
    tools: [
      tool(
        'show_on_screen',
        'Show something on the Oracle screen instead of reading it aloud: diffs, code, lists, tables, long explanations, links. Use this whenever the content is longer than a sentence or two or is hard to listen to. The screen keeps the latest few items.',
        {
          title: z.string().describe('Short heading, e.g. "Diff for the forecast fix"'),
          content: z.string().describe('The content. Markdown is supported.'),
          format: z.enum(['markdown', 'diff', 'code', 'text']).optional().describe('How to render it. Default markdown.'),
        },
        async ({ title, content, format = 'markdown' }) => {
          send({ type: 'screen', title, content, format, at: new Date().toISOString() });
          return text('Shown on screen.');
        },
      ),
      tool(
        'now',
        'Get the current date and time in the user\'s time zone. Use before setting reminders or answering time questions.',
        {},
        async () => {
          const d = new Date();
          return text(`${formatLocal(d)} (ISO ${d.toISOString()}, time zone ${userTimeZone()})`);
        },
      ),
      tool(
        'remember',
        'Save a lasting fact or preference about the user so the Oracle knows it in future conversations (e.g. "Horace prefers short answers"). One fact per call.',
        { fact: z.string().min(3) },
        async ({ fact }) => { memory.add(fact); return text(`Remembered: ${fact}`); },
      ),
      tool(
        'forget',
        'Remove remembered facts that contain the given text.',
        { match: z.string().min(2) },
        async ({ match }) => text(`Forgot ${memory.remove(match)} item(s).`),
      ),
      tool(
        'list_memories',
        'List everything the Oracle has remembered about the user.',
        {},
        async () => { const all = memory.all(); return text(all.length ? all.map((f) => `- ${f}`).join('\n') : 'Nothing remembered yet.'); },
      ),
      tool(
        'search_past_conversations',
        'Search every past Claude Code conversation on this PC (sessions run in the repo, in Windows folders, in the desktop app, and the Oracle\'s own earlier sessions) for what Horace and Claude said. Use it when Horace refers to something discussed before ("what did we decide about...", "the thing you fixed yesterday"), or before redoing work that may already have been done. Every word must appear; use 1 to 3 distinctive words. Newest first.',
        {
          query: z.string().min(2).describe('Distinctive words, e.g. "rollover phantom" or "CLAUDE_KEY"'),
          limit: z.number().int().min(1).max(30).optional(),
        },
        async ({ query, limit = 12 }) => {
          const hits = await searchSessions(query, { limit, skipSessionId: currentSessionId() });
          if (!hits.length) return text(`Nothing in past conversations matches "${query}". Try fewer or different words.`);
          return text(hits.map((h) => `[${h.when.slice(0, 16).replace('T', ' ')} | ${h.project} | ${h.role}] ${h.snippet}`).join('\n\n'));
        },
      ),
      tool(
        'list_claude_memories',
        'List the Claude Code memory files (the notes Claude Code sessions saved about Horace, the app and its hazards), newest first, with their full text. Your prompt already has them as of session start; call this to see any saved since.',
        {},
        async () => {
          const all = claudeMemories();
          return text(all.length ? all.map((m) => `## ${m.name} (${m.modified.slice(0, 10) || 'undated'})\n${m.file}\n${m.description}\n${m.body}`).join('\n\n') : 'No Claude Code memory files found.');
        },
      ),
      tool(
        'wolf_hall',
        'Read live data from the Wolf Hall budget app\'s worker with a GET request, for quick budget answers. Useful paths: /pool (money in the pool), /upcoming (bills coming up), /bills2 (bills with paid status), /savings (goals), /credit-accounts (cards), /payday-helper, /notifications/needs-attention, /week-budget?offset=-1 (last week), /gambling/bonus-run (daily free casino bonuses: ready now, streaks, SC collected), /health (version). Only GET; this tool can never pay, log or change anything. Two paths do write to Notion and will stop for Horace\'s yes: /forecast (rewrites the Forecast Snapshot) and /week-budget for the current week (writes rollover balances). Check your memory notes for hazards before asking for those.',
        { path: z.string().describe('Path with optional query string, e.g. /upcoming or /week-budget?offset=-1') },
        async ({ path: p }) => {
          try {
            const { status, body } = await workerGet(p);
            const shown = body.length > 30000 ? body.slice(0, 30000) + '\n…(cut off)' : body;
            return { ...text(`HTTP ${status}${workerGetWrites(p) ? ' (this call also wrote to Notion)' : ''}\n${shown}`), ...(status >= 400 ? { isError: true } : {}) };
          } catch (e) {
            return { ...text(`Could not reach the worker: ${e.message}`), isError: true };
          }
        },
      ),
      tool(
        'casino',
        'Update Horace\'s casino Bonus Run in the Wolf Hall app (Gambling screen). Actions: '
          + 'claim {site} = he collected that site\'s daily bonus; '
          + 'ten_plus {site, on} = the site\'s balance passed 10 SC (on:true) or was played down (on:false); '
          + 'play_run {results:[{site, won}]} = he did 10 spins at 1 SC on each listed site and won that many SC (this also takes them off 10+); '
          + 'add_offers {offers:[{site, what, expires?, link?, emailId, claimLink?, notes?}]} = truly free (no purchase) bonuses found in his casino emails; expires is ISO 8601 with offset if the email gives an end time; link is the email\'s Gmail viewUrl; emailId is the Gmail message id (always give it: repeats are skipped and the app uses it to open that exact email); claimLink is the https URL behind the email\'s own claim button, if any. '
          + 'Site names are matched loosely ("chumba" finds Chumba Casino). This never touches the Pool or any money data.',
        {
          action: z.enum(['claim', 'ten_plus', 'play_run', 'add_offers']),
          site: z.string().optional(),
          on: z.boolean().optional(),
          results: z.array(z.object({ site: z.string(), won: z.number().min(0) })).optional(),
          offers: z.array(z.object({
            site: z.string(), what: z.string(), expires: z.string().optional(), link: z.string().optional(),
            emailId: z.string().optional(), claimLink: z.string().optional(), notes: z.string().optional(),
          })).optional(),
        },
        async ({ action, site, on, results, offers }) => {
          try {
            const post = async (p, b) => {
              const r = await workerPostGambling(p, b);
              return { ...text(`HTTP ${r.status}\n${r.body.slice(0, 4000)}`), ...(r.status >= 400 || (r.json && r.json.ok === false) ? { isError: true } : {}) };
            };
            if (action === 'add_offers') {
              if (!offers?.length) return { ...text('Give offers.'), isError: true };
              return post('/gambling/offers', { offers });
            }
            const run = JSON.parse((await workerGet('/gambling/bonus-run')).body);
            const all = [...(run.sites || []), ...(run.paused || [])];
            const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const find = (name) => all.find((x) => norm(x.name) === norm(name))
              || all.find((x) => norm(x.name).startsWith(norm(name)) || norm(x.name).includes(norm(name)));
            if (action === 'play_run') {
              if (!results?.length) return { ...text('Give results.'), isError: true };
              const mapped = results.map((r) => ({ hit: find(r.site), r }));
              const missing = mapped.filter((m) => !m.hit).map((m) => m.r.site);
              if (missing.length) return { ...text(`No site matched: ${missing.join(', ')}. Sites: ${all.map((x) => x.name).join(', ')}`), isError: true };
              return post('/gambling/play-run', { results: mapped.map((m) => ({ siteId: m.hit.id, won: m.r.won })) });
            }
            const hit = find(site);
            if (!hit) return { ...text(`No site matched "${site}". Sites: ${all.map((x) => x.name).join(', ')}`), isError: true };
            if (action === 'claim') return post('/gambling/claim', { siteId: hit.id });
            return post('/gambling/site', { siteId: hit.id, tenPlus: on !== false });
          } catch (e) {
            return { ...text(`Could not reach the app: ${e.message}`), isError: true };
          }
        },
      ),
      tool(
        'morning',
        'Horace\'s morning check-in ("Wake up, Neo"): the Morning Log shared with the Wolf Hall app\'s Morning screen, shown live on the Morning tab of your screen. '
          + 'view = today\'s entry, streak and last 7 days (call it first: he may have filled some on his phone). '
          + 'save = set any fields he gave you (only what he said; never guess a number). Set checkIn:true once the check-in is complete. '
          + 'briefing = save today\'s briefing text (plain sentences, no markdown) so his phone shows it. '
          + 'Times like "11:30 pm" or "7:05" are fine. Scales are 1 to 5. A weight also goes to the Health log. Never touches money.',
        {
          action: z.enum(['view', 'save', 'briefing']),
          focus: z.boolean().optional().describe('Switch his screen to the Morning tab (use at the start of the check-in)'),
          date: z.string().optional().describe('YYYY-MM-DD, only to fill in a past day'),
          bedtime: z.string().optional(), wake: z.string().optional(),
          sleepQuality: z.number().int().min(1).max(5).optional(), energy: z.number().int().min(1).max(5).optional(), mood: z.number().int().min(1).max(5).optional(),
          weight: z.number().min(50).max(700).optional(),
          meds: z.boolean().optional(), medsNote: z.string().optional(),
          water: z.number().int().min(0).max(40).optional(), caffeine: z.number().int().min(0).max(20).optional(),
          waterAdd: z.number().int().min(-10).max(10).optional(), caffeineAdd: z.number().int().min(-10).max(10).optional(),
          keto: z.string().optional(), gratitude: z.string().optional(), note: z.string().optional(),
          top1: z.string().optional(), top2: z.string().optional(), top3: z.string().optional(),
          top1Done: z.boolean().optional(), top2Done: z.boolean().optional(), top3Done: z.boolean().optional(),
          checkIn: z.boolean().optional(),
          text: z.string().optional().describe('For action briefing: the briefing'),
        },
        async ({ action, focus, text: briefingText, ...fields }) => {
          try {
            let data;
            if (action === 'view') {
              const r = await workerGet('/morning?person=Horace');
              data = JSON.parse(r.body);
              if (!data.ok) return { ...text(`Could not read the Morning Log: ${data.error}`), isError: true };
            } else {
              const body = action === 'briefing' ? { briefing: String(briefingText || '').trim() } : fields;
              if (action === 'briefing' && !body.briefing) return { ...text('Give the briefing text.'), isError: true };
              const r = await workerPostMorning(body);
              data = r.json;
              if (!data?.ok) return { ...text(`Not saved: ${data?.error || r.body.slice(0, 300)}`), isError: true };
            }
            send({ type: 'morning', data, focus: !!focus });
            const e = data.entry || {};
            const filled = Object.entries(e).filter(([k, v]) => !['id', 'day', 'person', 'edited', 'weightLogId', 'briefing', 'briefingAt'].includes(k) && v !== null && v !== '' && v !== false).map(([k, v]) => `${k}: ${v}`);
            return text(`${action === 'view' ? 'Today' : 'Saved'} (${data.today}). Streak ${data.streak} days. ${data.entry ? '' : 'Nothing logged yet today. '}`
              + (filled.length ? `Filled: ${filled.join('; ')}.` : '') + (e.briefing ? ` Briefing saved at ${e.briefingAt}.` : ' No briefing yet.')
              + ` Week: ${JSON.stringify(data.week)}` + (data.warning ? ` Warning: ${data.warning}` : ''));
          } catch (e) {
            return { ...text(`Could not reach the app: ${e.message}`), isError: true };
          }
        },
      ),
      tool(
        'network_check',
        'Check the home internet (Starlink) for real: reads the Starlink dish (outages, latency and whole-house speed over the last 15 minutes) and, with speed_test, times a 5 MB download. Use this whenever Horace asks about his internet, or deploys, downloads or your own requests keep failing. Read-only.',
        { speed_test: z.boolean().optional().describe('Also run a 5 MB download test (takes up to 30 seconds).') },
        async ({ speed_test = false }) => {
          const r = await describeConnection({ speedTest: speed_test });
          return text(`${r.text}\n\nDetails: ${JSON.stringify({ dish: r.dish, test: r.test })}`);
        },
      ),
      tool(
        'set_reminder',
        'Set a reminder that the Oracle will say out loud (and show as a notification) at a time. Give either in_minutes or at. The Oracle must be running at that time; if no screen is open it will speak it when one connects.',
        {
          text: z.string().describe('What to remind about, phrased to be spoken, e.g. "Time to pay the Verizon bill"'),
          in_minutes: z.number().positive().optional(),
          at: z.string().optional().describe('ISO 8601 date-time WITH a UTC offset, e.g. 2026-10-24T17:30:00-05:00. Call `now` first to get the offset.'),
        },
        async ({ text: what, in_minutes, at }) => {
          let due;
          if (in_minutes) due = new Date(Date.now() + in_minutes * 60000);
          else if (at) due = new Date(at);
          if (!due || Number.isNaN(due.getTime())) return { ...text('Give in_minutes or a valid ISO `at` time.'), isError: true };
          if (due.getTime() < Date.now() - 60000) return { ...text('That time is in the past.'), isError: true };
          const r = reminders.add({ id: crypto.randomUUID().slice(0, 8), text: what, due: due.toISOString(), created: new Date().toISOString() });
          send({ type: 'reminders_changed' });
          return text(`Reminder ${r.id} set for ${formatLocal(due)}.`);
        },
      ),
      tool(
        'list_reminders',
        'List upcoming reminders.',
        {},
        async () => {
          const list = reminders.all().filter((r) => !r.fired);
          return text(list.length ? list.map((r) => `${r.id}: ${formatLocal(new Date(r.due))}: ${r.text}`).join('\n') : 'No reminders.');
        },
      ),
      tool(
        'cancel_reminder',
        'Cancel a reminder by its id (from list_reminders).',
        { id: z.string() },
        async ({ id }) => { const ok = reminders.remove(id); send({ type: 'reminders_changed' }); return text(ok ? 'Cancelled.' : 'No reminder with that id.'); },
      ),
    ],
  });
}

/**
 * Fires due reminders. `deliver(reminder)` returns true once a screen has
 * received it, or 'toasted' when it was shown as a Windows notification
 * instead (it is then still spoken once a screen connects).
 */
export function startReminderLoop(deliver) {
  const tick = () => {
    const list = reminders.all();
    let changed = false;
    for (const r of list) {
      if (r.fired || new Date(r.due).getTime() > Date.now()) continue;
      const result = deliver(r);
      if (result === true) { r.fired = new Date().toISOString(); changed = true; }
      else if (result === 'toasted') { r.toasted = new Date().toISOString(); changed = true; }
    }
    // Keep a short tail of fired reminders, drop the rest.
    const kept = list.filter((r) => !r.fired || Date.now() - new Date(r.fired).getTime() < 7 * 864e5);
    if (changed || kept.length !== list.length) reminders.save(kept);
  };
  tick();
  return setInterval(tick, 15000);
}
