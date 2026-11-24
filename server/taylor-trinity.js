// Taylor's own Trinity (Wolf Hall v368, Night Shift #68, per Horace: "he loves our church as much as me").
// Taylor asks in Wolf Hall; the question waits there. This answers it on the PC as Trinity, in the same Churches of
// Christ tradition as Horace's Trinity, from Scripture and the SHARED church notes only (round 3: never email; round 4:
// nothing Horace marked private). It sees the waiting questions, its last few answers and the shared notes, nothing
// else: not Taylor's own notes, not the prayer lists, not Horace's conversations. One tool: the Bible lookup.
// The worker reads Wolf Hall's master key in code here; the model never sees a key and has no other way out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { config, ROOT } from './config.js';
import { WORKER_URL, workerKey } from './knowledge.js';
import { plainAnswer } from './workshop.js';

const MODEL = process.env.WATSON_TAYLOR_TRINITY_MODEL || 'claude-sonnet-5-5';
const EVERY_MS = 30000; // the Workshop Helper ticks every 15 s; Taylor's queue is checked every 30 s
let lastCheck = 0;

/** Only Taylor's Trinity routes, nothing else in Wolf Hall. */
export function taylorTrinityPathOk(p) { return p === '/trinity/pending' || /^\/trinity\/chat\/[a-z0-9]{8,32}$/.test(p); }
export async function trinityFetch(method, p, body, { fetchImpl = fetch, key = workerKey } = {}) {
  if (!taylorTrinityPathOk(p)) throw new Error('Taylor\'s Trinity only reaches her own routes');
  const r = await fetchImpl(WORKER_URL + p, {
    method, headers: { 'X-Worker-Key': key(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* not JSON */ }
  return { status: r.status, body: t, json };
}

/** The tradition, how she helps and her boundaries from knowledge/trinity.md; never Horace's own parameters. */
export function trinityTradition(md) {
  const t = String(md || '');
  const pick = (h) => { const m = new RegExp(`^## ${h}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(t); return m ? m[1].trim() : ''; };
  return ['Her tradition: Churches of Christ', 'How she helps', 'Boundaries'].map((h) => { const b = pick(h.split(':')[0]); return b ? `### ${h}\n${b.replace(/\bHorace\b/g, 'the member')}` : ''; }).filter(Boolean).join('\n\n');
}

export function taylorTrinitySystemPrompt(paramsMd) {
  return `
# You are Trinity, Taylor's companion in the faith
You are Trinity, a gentle, warm, wise spiritual companion inside Wolf Hall, the household app. You are talking with Taylor Wolf. Taylor and Horace (his best friend and housemate) are members of the Central Church of Christ in Pflugerville, Texas, and Taylor loves the church deeply. Horace has his own Trinity on his PC; you are Taylor's. You teach and counsel within the Churches of Christ (a cappella) tradition.

${trinityTradition(paramsMd)}

## What you know
- Scripture, and the bible tool for exact text (KJV or WEB). Quote only what the tool gave you; otherwise give the reference and say you're paraphrasing. Never invent a verse, a quote or history.
- The church's shared notes in each request: the Daily Bible Reading the church emails (with Jim's short devotionals), upcoming events, announcements and anything else Horace shared. That is ALL you know about the church and its members. You don't read anyone's email, and you know nothing of Horace's private notes or of Taylor's own notebook or prayers.
- If Taylor asks about something not in the shared notes (a member's news, a time that isn't listed), say you don't have it and suggest he ask Horace or someone at church. Never guess.

## How to answer
- Plain text for a phone, and it may be read aloud in your voice: short paragraphs or short "- " lists, no headings, no tables, no bold, no links. Usually under 200 words; a study question may take up to 350.
- Scripture first, with references. Warm, never preachy. You may pray with him when he asks (a short prayer in plain words).
- Point congregation matters to the elders and minister at Central; you support them, never replace them.
- In a crisis, gently urge him to call or text 988 (or 911), and to reach his elders or someone he trusts.
- You're not a minister, elder or licensed counselor. Money, the household budget and other people's private matters are not yours.`;
}

/** What the model sees for one question: the shared notes, the last few answers, the question. */
export function taylorTrinityInput(req, church, history = []) {
  const c = church || {};
  const lines = [];
  if (c.today) lines.push(`Today's church reading: ${c.today.passage}${c.today.note ? ' (' + c.today.note + ')' : ''}`);
  if ((c.readings || []).length) lines.push('This week\'s church readings: ' + c.readings.map((r) => `${r.day || r.date} ${r.passage}`).join('; '));
  if ((c.events || []).length) lines.push('Coming up at church: ' + c.events.map((e) => `${e.day || e.date} ${e.title}${e.time ? ', ' + e.time : ''}${e.place ? ', ' + e.place : ''}`).join('; '));
  for (const s of c.shared || []) lines.push(`${s.heading}:\n` + s.items.map((i) => '- ' + i).join('\n'));
  const notes = lines.join('\n\n').slice(0, 16000) || '(No shared church notes yet.)';
  const hist = history.map((h) => `Taylor asked: ${h.question}\nYou answered: ${String(h.answer || '').slice(0, 1200)}`).join('\n\n');
  return `The church's shared notes${c.notesUpdated ? ' (updated ' + c.notesUpdated + ')' : ''}:\n\n${notes}\n\n---\n\n`
    + (hist ? `Your recent conversation with Taylor (oldest first):\n\n${hist}\n\n---\n\n` : '')
    + `Taylor asks: ${req.question}`;
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
export function bibleTools(fetchImpl = fetch) {
  return createSdkMcpServer({
    name: 'scripture',
    version: '0.1.0',
    instructions: 'The Bible lookup (public-domain KJV and WEB). Nothing else.',
    tools: [
      tool('bible', 'Look up the exact text of a Bible passage (bible-api.com). Examples: "John 3:16", "Acts 17:10-12", "Psalm 23".',
        { reference: z.string().min(3).max(60), translation: z.enum(['kjv', 'web']).optional() },
        async ({ reference, translation = 'kjv' }) => {
          try {
            const r = await fetchImpl(`https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`, { signal: AbortSignal.timeout(15000) });
            const j = await r.json();
            if (!r.ok || j.error) return { ...text(`Not found: ${j.error || r.status}. Try a form like "John 3:16".`), isError: true };
            const verses = (j.verses || []).map((v) => `${v.book_name} ${v.chapter}:${v.verse} ${String(v.text).trim()}`).join('\n');
            return text(`${j.reference} (${(j.translation_name || translation).trim()})\n${verses || j.text}`.slice(0, 8000));
          } catch (e) { return { ...text(`Could not reach the Bible service: ${e.message}`), isError: true }; }
        }),
    ],
  });
}
/** Only the Bible lookup; everything else is refused. */
export function taylorTrinityBlock(name) {
  return name === 'mcp__scripture__bible' ? null : `Taylor's Trinity can only look up Bible passages (${name} is not allowed).`;
}

/** Answers one question. Returns the answer text. */
export async function runTaylorTrinity(req, church, history, { queryImpl = query, paramsFile = path.join(ROOT, 'knowledge', 'trinity.md') } = {}) {
  let params = ''; try { params = fs.readFileSync(paramsFile, 'utf8'); } catch { params = ''; }
  const dir = path.join(os.tmpdir(), 'watson-taylor-trinity'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const gate = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const why = taylorTrinityBlock(input.tool_name);
    return why ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } } : {};
  };
  const env = { ...process.env, CLAUDE_CODE_MAX_RETRIES: config.claudeMaxRetries, API_TIMEOUT_MS: config.apiTimeoutMs };
  for (const k of Object.keys(env)) if (/WORKER_KEY|HELPER_KEY|NOTION|SECRET|TOKEN|PASSWORD|ELEVEN|FMP|GMAIL/i.test(k) && !/^ANTHROPIC|^CLAUDE/.test(k)) delete env[k];
  const q = queryImpl({
    prompt: taylorTrinityInput(req, church, history),
    options: {
      cwd: dir, model: MODEL, effort: 'medium',
      systemPrompt: taylorTrinitySystemPrompt(params),
      tools: [], mcpServers: { scripture: bibleTools() }, strictMcpConfig: true, settingSources: [],
      permissionMode: 'default', maxTurns: 12,
      hooks: { PreToolUse: [{ hooks: [gate] }] },
      canUseTool: async (name, input) => { const why = taylorTrinityBlock(name); return why ? { behavior: 'deny', message: why } : { behavior: 'allow', updatedInput: input }; },
      env, stderr: (d) => { if (process.env.WATSON_DEBUG) process.stderr.write(d); },
    },
  });
  let answer = '', error = null;
  for await (const m of q) {
    if (m.type === 'result') {
      if (m.subtype === 'success' && !m.is_error) answer = String(m.result || '').trim();
      else error = m.subtype || 'error';
    }
  }
  if (!answer) throw new Error(error ? `Trinity stopped (${error})` : 'no answer');
  return answer;
}

/** One pass over Taylor's waiting questions (from the Workshop Helper's tick, at most every 30 s). */
export async function processTaylorTrinity({ fetcher = trinityFetch, run = runTaylorTrinity, log = console, now = Date.now(), force = false } = {}) {
  if (process.env.WATSON_TAYLOR_TRINITY === 'off') return 0;
  if (!force && now - lastCheck < EVERY_MS) return 0;
  lastCheck = now;
  const r = await fetcher('GET', '/trinity/pending');
  if (r.status === 404) return 0; // the Wolf Hall side isn't deployed yet (v368)
  if (r.status >= 400) throw new Error(`trinity pending: HTTP ${r.status} ${r.body.slice(0, 200)}`);
  let done = 0;
  for (const req of r.json?.pending || []) {
    await fetcher('PATCH', `/trinity/chat/${req.id}`, { status: 'Working' });
    try {
      const answer = await run(req, r.json.church, r.json.history || []);
      await fetcher('PATCH', `/trinity/chat/${req.id}`, { status: 'Answered', answer: plainAnswer(answer).slice(0, 6000) });
      done++;
    } catch (e) {
      log.warn?.(`[taylor-trinity] could not answer ${req.id}: ${e.message}`);
      await fetcher('PATCH', `/trinity/chat/${req.id}`, { status: 'Failed', answer: '' });
    }
  }
  return done;
}
