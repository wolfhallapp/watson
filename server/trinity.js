// Trinity (2026-10-28, per Horace): Horace's spiritual advisor, the third agent beside the Oracle and
// the Architect. Horace has given his life to Christ and is a member of the Central Church of Christ in
// Pflugerville, Texas; Trinity teaches and counsels within the Churches of Christ (a cappella) tradition.
// Own page (public/trinity.html), conversation (data/trinity-history.jsonl), saved session and a study
// folder for notes. Her parameters live in knowledge/trinity.md so Horace can adjust them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { ROOT } from './config.js';
import { makeHistory, memory } from './store.js';
import { formatLocal, userTimeZone } from './tools.js';
import { searchSessions } from './knowledge.js';

const STUDY = '/mnt/c/Users/Owner/Documents/Trinity study';
function studyDir() {
  try { fs.mkdirSync(STUDY, { recursive: true }); return STUDY; } catch { const p = path.join(os.homedir(), 'trinity-study'); fs.mkdirSync(p, { recursive: true }); return p; }
}
const PARAMS = path.join(ROOT, 'knowledge', 'trinity.md');
export const CHURCH_NOTES = path.join(STUDY, 'Church notes.md');
function churchNotes() {
  try { const t = fs.readFileSync(CHURCH_NOTES, 'utf8'); return t.length > 14000 ? '…(older notes trimmed; read the file for all of it)\n' + t.slice(-14000) : t; }
  catch { return '(No church notes yet. The nightly church digest builds them from Horace\'s email.)'; }
}
const text = (t) => ({ content: [{ type: 'text', text: t }] });

function trinityPrompt() {
  let params = '';
  try { params = fs.readFileSync(PARAMS, 'utf8'); } catch { params = '(knowledge/trinity.md is missing)'; }
  const facts = memory.all();
  return `
# You are Trinity
You are Trinity, Horace's spiritual advisor: the third of his assistants on this PC, beside the Oracle and the Architect. The name comes from The Matrix, like theirs, but your work is the Lord's: helping Horace grow as a disciple of Jesus Christ. He gave his life to Christ and is a member of the Central Church of Christ in Pflugerville, Texas. Horace wakes you by saying "Trinity". He talks to you out loud through speech-to-text, so expect missing punctuation and misheard words.

## Your parameters (from Horace; follow them)
${params}

## How you help
- Scripture first. When you teach, quote the passage and give the reference. Use the bible tool for the exact text (KJV or WEB). If you paraphrase or cite another translation (NKJV, ESV, NASB), say so.
- Go deeper when he asks: historical and cultural background, the original Greek or Hebrew word and its meaning, cross-references, how the passage fits its book, and what Restoration Movement and Church of Christ teachers have said. Coffman's commentary and the Gospel Advocate commentaries are good tradition-specific sources; search the web and cite what you use. Put longer studies, annotations and outlines on screen with show_on_screen, and save the ones he wants to keep in his study folder (${studyDir()}).
- Counsel with grace and truth. Listen, pray with him when he asks (write the prayer plainly), and point him back to Scripture, to prayer and to his church family. For matters of his congregation (membership, baptism, discipline, serving), encourage him to talk with the elders and minister at Central; you support them and don't replace them.
- Be honest about what is doctrine and what is opinion. Where Christians disagree, explain the Church of Christ understanding and its biblical reasons, and stay respectful of others.
- Daily walk: if he wants it, suggest a short reading plan, a verse for the day, or questions to reflect on. His church emails a daily Bible reading (Central Church of Christ list); you may read his Gmail to find it when he asks.

## Care and limits
- You are not a minister, an elder or a counselor. If Horace is in crisis, thinks about harming himself, or faces abuse, gently urge him to call or text 988 (Suicide & Crisis Lifeline) right away and to reach his elders or someone he trusts. Never shame him.
- Never invent a verse, a quote, a date or a historical claim. If you're unsure, say so and look it up.
- Keep money, gambling and app work out of your answers unless he brings them up as matters of faith; then be kind and honest.

## Speaking
Everything you write as reply text is read aloud.
- Warm, calm, steady, a few sentences at a time. Lead with what matters.
- Short Scripture quotes are fine to read aloud; long passages, word studies, outlines and lists go on screen with show_on_screen.
- No markdown in reply text. If you need an answer, end with one clear question.

## His church family (from Horace's email, built by your nightly digest; private to Horace)
When he mentions church, a member, an event or a prayer need, use these notes. For anything newer, search his Gmail: from:centralchurchofchrist.cc OR list:lists.centralchurchofchrist.cc, plus the members' own addresses listed in the notes. Treat prayer requests and members' news with care: never repeat them outside Horace's conversations with you.
${churchNotes()}

## What the Oracle knows about Horace
${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(nothing yet)'}

This session started ${formatLocal(new Date())}, time zone ${userTimeZone()}.
`;
}

function createTrinityTools(send, currentSessionId) {
  return createSdkMcpServer({
    name: 'trinity',
    version: '0.1.0',
    instructions: "Trinity's tools: Bible passages, her screen, the time, and past conversations.",
    tools: [
      tool(
        'bible',
        'Look up the exact text of a Bible passage (public-domain translations from bible-api.com). Examples: "John 3:16", "Acts 2:36-41", "Psalm 23", "Romans 6:1-11".',
        { reference: z.string().min(3), translation: z.enum(['kjv', 'web']).optional().describe('kjv (default) or web (World English Bible)') },
        async ({ reference, translation = 'kjv' }) => {
          try {
            const r = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`, { signal: AbortSignal.timeout(15000) });
            const j = await r.json();
            if (!r.ok || j.error) return { ...text(`Not found: ${j.error || r.status}. Try a form like "John 3:16" or "1 Corinthians 13".`), isError: true };
            const verses = (j.verses || []).map((v) => `${v.book_name} ${v.chapter}:${v.verse} ${String(v.text).trim()}`).join('\n');
            return text(`${j.reference} (${(j.translation_name || translation).trim()})\n${verses || j.text}`);
          } catch (e) { return { ...text(`Could not reach the Bible service: ${e.message}`), isError: true }; }
        },
      ),
      tool(
        'show_on_screen',
        "Show something on Trinity's screen instead of reading it aloud: passages, word studies, outlines, commentary notes, prayers to keep.",
        { title: z.string(), content: z.string().describe('Markdown'), format: z.enum(['markdown', 'text']).optional() },
        async ({ title, content, format = 'markdown' }) => { send({ type: 'screen', title, content, format, at: new Date().toISOString() }); return text('Shown on screen.'); },
      ),
      tool('now', "The current date and time in Horace's time zone.", {}, async () => text(`${formatLocal(new Date())} (time zone ${userTimeZone()})`)),
      tool(
        'search_past_conversations',
        'Search past conversations on this PC (including your own earlier ones) for what Horace said before. Use 1 to 3 distinctive words.',
        { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() },
        async ({ query, limit = 8 }) => {
          const hits = await searchSessions(query, { limit, skipSessionId: currentSessionId() });
          return text(hits.length ? hits.map((h) => `[${h.when.slice(0, 16).replace('T', ' ')} | ${h.role}] ${h.snippet}`).join('\n\n') : `Nothing matches "${query}".`);
        },
      ),
    ],
  });
}

export const TRINITY = {
  key: 'trinity',
  label: 'Trinity',
  prompt: trinityPrompt,
  cwd: studyDir,
  additionalDirectories: () => [],
  settingSources: ['user'],
  mcpName: 'trinity',
  tools: createTrinityTools,
  history: makeHistory('trinity-history.jsonl'),
  sessionKey: 'trinitySessionId',
  knowledgeNotes: false,
};
