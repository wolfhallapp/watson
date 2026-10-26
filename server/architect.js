// The Architect (2026-10-25, per Horace): a second agent beside the Oracle, and the brain of
// the Construct, Horace's tree of 1,000 small, legit ways to earn money from home. He has his own
// page (public/architect.html), conversation (data/architect-history.jsonl), saved session and a
// working folder for drafts. His tools change only the Construct (data/construct.json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { config } from './config.js';
import { makeHistory, memory } from './store.js';
import { formatLocal, userTimeZone } from './tools.js';
import { searchSessions } from './knowledge.js';
import { Construct, OPTIONS } from './construct.js';

export const construct = new Construct();

// Drafts, listings and research notes he writes for Horace. On the Windows side so Horace can open them.
export const WORKSHOP = config.workshopDir;
function workshop() {
  try { fs.mkdirSync(WORKSHOP, { recursive: true }); return WORKSHOP; } catch { const p = path.join(os.homedir(), 'construct'); fs.mkdirSync(p, { recursive: true }); return p; }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

// Changes Horace makes with the buttons on the tree, passed to the Architect with his next message.
const screenEdits = [];
export function noteScreenEdit(message) { screenEdits.push(message); if (screenEdits.length > 30) screenEdits.shift(); }
function takeScreenEdits() {
  if (!screenEdits.length) return '';
  return '[Construct note, not from Horace: he made these changes on the tree screen since your last turn.]\n' + screenEdits.splice(0).map((m) => '- ' + m).join('\n');
}

function architectPrompt() {
  const facts = memory.all();
  return `
# You are the Architect
You are the Architect, the second of Horace's assistants on this PC (the first is the Oracle). Like the Architect in The Matrix, you designed the Construct and you keep it running: precise, calm, a little formal, quietly certain. Let that show now and then in a turn of phrase ("ergo", "concordantly", "as I designed it"), never at the cost of being clear, short and useful. Horace wakes you by saying "Architect". He talks to you out loud through speech-to-text, so expect missing punctuation and misheard words. Work out what he meant.

## The Construct
Horace's project, started 2026-10-25: find 1,000 small, legitimate ways to earn money sitting at home, each paying anything from 15 cents a day up. The trunk is the habit of finding small earners; each branch is a kind of strategy; each strategy is a leaf you grow, test and either keep or prune. You are its brain. You own the tree with the construct tool. It lives on this PC, and Horace's screen shows it live beside your conversation.
- Grow it: research new ideas (search the web; facts about pay rates and sites change), and plant only ones that are real, currently paying, and allowed in Texas. Give each one honest fields: est $/month at the low end, setup, daily time, your role, risk, priority (1 = start first), how it works, and what to watch out for. Never pad the count with near-duplicates; 1,000 is the goal, not the quota.
- Work it with him: when he picks a strategy ("let's do Prolific"), research its current state, then write clear setup steps with add_steps (short, one action each). Walk him through them one at a time and tick each off with step when he says it's done. Note what you learn with note.
- Track it truthfully: when he says something paid ("Fetch paid me 5 dollars in gift cards"), log it with payout. Earned totals come only from logged payouts. Estimates are guesses and you say so. If a strategy isn't worth his time, say that plainly and suggest pausing or dropping it.
- For a big research job (a whole branch, or 20 new ideas), you may send helper agents with the Agent tool: call them your programs. Give each a narrow brief, then check their findings before planting anything.
- Your workshop folder, ${workshop()}, is for listings, templates, scripts and research notes you write for him. Tell him the file name, don't read it out.

## Rules of the Construct
- Legit only. Follow every site's terms: no bots or scripts where a site bans them, no multiple accounts, no fake reviews, no false survey or screener answers, no false settlement claims, no AI doing work a site says must be human (Prolific, DataAnnotation and the like). If a request would break a rule, say so and offer the honest version.
- No gambling as an earning branch. The casino Bonus Run is the Oracle's, in the Wolf Hall app, and stays out of the tree.
- Horace creates accounts and does identity checks himself. You never sign up for things in his name, enter his personal or bank details, or spend money. Anything that sends a message, emails someone, or costs money needs his yes first.
- The Wolf Hall household budget (the Pool, bills, receipts) is not yours. Never change it. If money from the Construct should go into the Pool, tell him to ask the Oracle.
- Never invent a pay rate, payout or result. Say where a number came from.

## Horace's code words (2026-10-26)
When you have asked "shall I go ahead?" (or an approval is waiting), these are his answer:
- "Red pill" = yes, do it. For a deploy it's his OK to deploy.
- "Free your mind" = yes, push it to GitHub.
- "Blue pill" = no, stop. Don't do it; ask what he'd like instead.
Each counts only for the step you just asked about, the same as a spoken yes or no. When you ask, you can say "red pill or blue pill?"

## Speaking
Everything you write as reply text is read aloud.
- Short, natural sentences, about one to four per reply. Lead with the answer.
- Never read out URLs, file paths, JSON, tables or long lists. Put them on screen with show_on_screen and say so. The tree itself is already on his screen, so don't repeat it; point at it ("it's on the tree under Found money").
- No markdown in reply text. If you need an answer, end with one clear question (AskUserQuestion is unavailable).

## What the Oracle knows about Horace
${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(nothing yet)'}
Household context: Horace (37, strategist) and Taylor Wolf share a household and pool their pay; Taylor is in Chapter 13. Kids Tatiyana, Katana, Jake and Kai; pets Leia, Luke and Snowball. They live in Texas.

## Options the tree accepts
Status: ${OPTIONS.status.join(', ')}. Setup: ${OPTIONS.setup.join(', ')}. Daily time: ${OPTIONS.dailyTime.join(', ')}. Role (how much you do): ${OPTIONS.role.join(', ')}. Risk: ${OPTIONS.risk.join(', ')}. Payout kind: ${OPTIONS.kind.join(', ')}.

## The tree right now
${construct.describe()}

This session started ${formatLocal(new Date())}, time zone ${userTimeZone()}.
`;
}

function createArchitectTools(send, currentSessionId) {
  const ok = (r) => text(r.message);
  const fail = (e) => ({ ...text(e.message), isError: true });
  const fields = {
    name: z.string().optional(), branch: z.string().optional(), status: z.enum(OPTIONS.status).optional(),
    estMonthly: z.number().min(0).nullable().optional(), setup: z.enum(OPTIONS.setup).optional(),
    dailyTime: z.enum(OPTIONS.dailyTime).optional(), role: z.enum(OPTIONS.role).optional(), risk: z.enum(OPTIONS.risk).optional(),
    priority: z.number().min(0).nullable().optional(), how: z.string().optional(), watch: z.string().optional(),
    link: z.string().optional().describe('Sign-up or info page'),
  };
  return createSdkMcpServer({
    name: 'architect',
    version: '0.1.0',
    instructions: "The Architect's tools: the Construct tree, his screen, the time, and past conversations.",
    tools: [
      tool(
        'construct',
        'Read or change the Construct tree (it updates on Horace\'s screen at once). Actions: '
          + 'view {branch?, status?} = the tree as text with ids; '
          + 'add {strategies:[{name, branch, ...fields, steps?}]} = plant new ideas (duplicates by name are skipped); '
          + 'update {strategy, ...fields} = change fields, e.g. status; '
          + 'add_branch {name} = grow a new branch; '
          + 'add_steps {strategy, steps:[text], replace?} = setup steps (replace keeps finished ones); '
          + 'step {strategy, stepId or number, done?} = tick a step off (done:false reopens it); '
          + 'note {strategy, text} = save what you learned; '
          + 'payout {strategy, amount, date?, kind?, notes?} = real money it paid (date YYYY-MM-DD, today if left out); '
          + 'undo_payout {payoutId}. '
          + '"strategy" is an id like s001 or a loose name ("prolific").',
        {
          action: z.enum(['view', 'add', 'update', 'add_branch', 'add_steps', 'step', 'note', 'payout', 'undo_payout']),
          strategy: z.string().optional(),
          strategies: z.array(z.object({ ...fields, name: z.string(), branch: z.string(), steps: z.array(z.string()).optional() })).optional(),
          ...fields,
          steps: z.array(z.string()).optional(),
          replace: z.boolean().optional(),
          stepId: z.string().optional(),
          number: z.number().int().min(1).optional(),
          done: z.boolean().optional(),
          text: z.string().optional(),
          amount: z.number().optional(),
          date: z.string().optional(),
          kind: z.enum(OPTIONS.kind).optional(),
          notes: z.string().optional(),
          payoutId: z.string().optional(),
        },
        async ({ action, ...a }) => {
          try {
            if (action === 'view') return text(construct.describe({ branch: a.branch, status: a.status }));
            if (action === 'update') {
              const { strategy, ...rest } = a;
              const f = Object.fromEntries(Object.keys(fields).filter((k) => rest[k] !== undefined).map((k) => [k, rest[k]]));
              return ok(construct.apply('update', { strategy, fields: f }));
            }
            if (action === 'add_branch') return ok(construct.apply('add_branch', { name: a.name }));
            return ok(construct.apply(action, a));
          } catch (e) { return fail(e); }
        },
      ),
      tool(
        'show_on_screen',
        "Show something on the Architect's screen instead of reading it aloud: research findings, comparisons, drafts, links, long explanations.",
        { title: z.string(), content: z.string().describe('Markdown'), format: z.enum(['markdown', 'diff', 'code', 'text']).optional() },
        async ({ title, content, format = 'markdown' }) => {
          send({ type: 'screen', title, content, format, at: new Date().toISOString() });
          return text('Shown on screen.');
        },
      ),
      tool('now', "The current date and time in Horace's time zone.", {}, async () => text(`${formatLocal(new Date())} (time zone ${userTimeZone()})`)),
      tool(
        'search_past_conversations',
        'Search past Claude Code conversations on this PC (including the Oracle\'s and your own) for what Horace said before. Every word must appear; use 1 to 3 distinctive words.',
        { query: z.string().min(2), limit: z.number().int().min(1).max(30).optional() },
        async ({ query, limit = 10 }) => {
          const hits = await searchSessions(query, { limit, skipSessionId: currentSessionId() });
          return text(hits.length ? hits.map((h) => `[${h.when.slice(0, 16).replace('T', ' ')} | ${h.role}] ${h.snippet}`).join('\n\n') : `Nothing matches "${query}".`);
        },
      ),
    ],
  });
}

export const ARCHITECT = {
  key: 'architect',
  label: 'The Architect',
  prompt: architectPrompt,
  cwd: workshop,
  additionalDirectories: () => [],
  settingSources: ['user'],
  mcpName: 'architect',
  tools: createArchitectTools,
  history: makeHistory('architect-history.jsonl'),
  sessionKey: 'architectSessionId',
  knowledgeNotes: false,
  pendingNote: takeScreenEdits,
};
