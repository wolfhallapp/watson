// Watson's own tools, served in-process to the agent as the "watson" MCP server.
import crypto from 'node:crypto';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { memory, reminders, state } from './store.js';
import { claudeMemories, searchSessions, workerGet, workerGetWrites } from './knowledge.js';

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

/** `send(event)` broadcasts an event to every connected Watson screen. */
export function createWatsonTools(send, currentSessionId = () => null) {
  return createSdkMcpServer({
    name: 'watson',
    version: '0.1.0',
    instructions: 'Watson\'s own tools: put things on the screen, remember facts about the user, set spoken reminders, search past Claude Code conversations, and read the live Wolf Hall budget.',
    tools: [
      tool(
        'show_on_screen',
        'Show something on the Watson screen instead of reading it aloud: diffs, code, lists, tables, long explanations, links. Use this whenever the content is longer than a sentence or two or is hard to listen to. The screen keeps the latest few items.',
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
        'Save a lasting fact or preference about the user so Watson knows it in future conversations (e.g. "Horace prefers short answers"). One fact per call.',
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
        'List everything Watson has remembered about the user.',
        {},
        async () => { const all = memory.all(); return text(all.length ? all.map((f) => `- ${f}`).join('\n') : 'Nothing remembered yet.'); },
      ),
      tool(
        'search_past_conversations',
        'Search every past Claude Code conversation on this PC (sessions run in the repo, in Windows folders, in the desktop app, and Watson\'s own earlier sessions) for what Horace and Claude said. Use it when Horace refers to something discussed before ("what did we decide about...", "the thing you fixed yesterday"), or before redoing work that may already have been done. Every word must appear; use 1 to 3 distinctive words. Newest first.',
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
        'set_reminder',
        'Set a reminder that Watson will say out loud (and show as a notification) at a time. Give either in_minutes or at. Watson must be running at that time; if no screen is open it will speak it when one connects.',
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
