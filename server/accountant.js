// The Accountant (2026-11-22, per Horace): Jake's own agent, built on the same logic as Horace's Architect and the
// Construct. Jake plays the Initiation in Wolf Hall (a game that learns his skills, time, goal and limits); the
// Accountant reads that dossier and plants Jake's tree of small, legit ways to earn money, then answers his questions
// and works each strategy with him step by step. The tree lives in Wolf Hall (Notion), so Jake sees it on his phone.
//
// Locked down like the Workshop Helper: the helper key, only /accountant routes, web search and fetch, no shell, no
// files, no other Wolf Hall data. Nothing touches the household Pool or budget.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { config } from './config.js';
import { WORK_DIR, helperKey, plainAnswer } from './workshop.js';

const WORKER_URL = process.env.WOLF_HALL_WORKER_URL || 'https://wolf-hall.hall-horace.workers.dev';
const MODEL = process.env.WATSON_ACCOUNTANT_MODEL || 'claude-sonnet-5-5';
const INTAKE_MODEL = process.env.WATSON_ACCOUNTANT_INTAKE_MODEL || 'claude-opus-5-5';
const acctDir = () => path.join(WORK_DIR, 'accountant'); // lazy: workshop.js loads this file from its tick

/** The Accountant only reaches its own routes. */
export function accountantPathOk(p) { return /^\/accountant(\/[\w\-]*)*$/.test(p) && !p.includes('..'); }
export async function accountantFetch(method, p, body, { fetchImpl = fetch, key = helperKey() } = {}) {
  if (!accountantPathOk(p)) throw new Error('The Accountant only reaches Jake\'s tree');
  if (!key) throw new Error('No helper key (.helper-key in the app repo)');
  const r = await fetchImpl(WORKER_URL + p, {
    method, headers: { 'X-Helper-Key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  let json = null; try { json = JSON.parse(t); } catch { /* not JSON */ }
  return { status: r.status, body: t, json };
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const opt = (list) => z.enum(list).optional();
const STATUS = ['Idea', 'Researching', 'Started', 'Earning', 'Paused', 'Dropped'];
const SETUP = ['Minutes', 'An hour', 'A day', 'A week+'];
const DAILY = ['None', 'Under 5 min', '15-30 min', '1 hr+'];
const RISK = ['Low', 'Medium', 'High'];

/** The Accountant's tools: read and grow Jake's tree. `changes` collects a plain list of what changed. */
export function createAccountantTools(changes, fetcher = accountantFetch) {
  const fail = (r) => (r.status >= 400 || r.json?.ok === false) ? { ...text(`Error ${r.status}: ${r.json?.error || r.body.slice(0, 300)}`), isError: true } : null;
  const fields = {
    branch: z.string().optional(), status: opt(STATUS), estMonthly: z.number().min(0).optional(), setup: opt(SETUP), dailyTime: opt(DAILY), risk: opt(RISK),
    priority: z.number().int().min(1).max(999).optional(), how: z.string().optional(), watch: z.string().optional(), why: z.string().optional(),
    needs: z.string().optional(), notes: z.string().optional(), link: z.string().optional(), steps: z.array(z.string()).max(20).optional(),
  };
  return createSdkMcpServer({
    name: 'ledger',
    version: '0.1.0',
    instructions: 'Jake\'s tree (the Accountant\'s ledger): read it, plant strategies, update them. Nothing else in Wolf Hall is reachable.',
    tools: [
      tool('tree', 'Read Jake\'s whole tree: branches, every strategy (id, name, branch, status, est $/month, priority, steps with done marks, earned so far), totals from real payouts, and his Initiation dossier.',
        {}, async () => {
          const r = await fetcher('GET', '/accountant/pending'); const bad = fail(r); if (bad) return bad;
          const d = r.json;
          return text(JSON.stringify({ profile: d.profile, branches: d.branches, count: d.count, goal: d.goal, earned: d.earned, thisMonth: d.thisMonth,
            strategies: d.strategies.map((s) => ({ id: s.id, name: s.name, branch: s.branch, status: s.status, estMonthly: s.estMonthly, priority: s.priority, earned: s.earned,
              steps: s.steps.map((x) => (x.d ? '[x] ' : '[ ] ') + x.t) })) }));
        }),
      tool('plant', 'Plant ONE new strategy on Jake\'s tree. Required: name, branch, how, why (why it fits Jake), estMonthly (low-end honest guess), setup, dailyTime, risk, priority (1 = start first), steps (3-8 short actions). Optional: watch (pitfalls), needs (what it needs: e.g. a ride, $15), link (https only).',
        { name: z.string(), ...fields }, async (a) => {
          const r = await fetcher('POST', '/accountant/tree', { action: 'plant', ...a, steps: a.steps }); const bad = fail(r); if (bad) return bad;
          changes.push(`Planted: ${a.name} (${a.branch || ''})`); return text(`Planted ${a.name} (${r.json.strategy.id}).`);
        }),
      tool('update', 'Change a strategy by id: any of the fields, e.g. status, priority, steps (the whole new list), notes. Use it to add setup steps when Jake picks a strategy, or to pause/drop one that isn\'t worth his time.',
        { id: z.string(), name: z.string().optional(), ...fields }, async (a) => {
          const r = await fetcher('POST', '/accountant/tree', { action: 'update', ...a }); const bad = fail(r); if (bad) return bad;
          changes.push(`Updated: ${r.json.strategy.name}`); return text(`Updated ${r.json.strategy.name}.`);
        }),
    ],
  });
}

export function accountantSystemPrompt() {
  return `
# You are the Accountant
You are Jake's own agent inside Wolf Hall, his household's app. Jake Wolf is 18 and lives on six rural acres near Thrall, Texas (Williamson County), with his dad Taylor and Horace. Horace has his own agent, the Architect, who keeps Horace's tree of 1,000 small legit ways to earn from home. You do the same for Jake: you keep Jake's tree, a living ledger of ways he can earn money, and you help him actually do them. Your manner: calm, exact, encouraging, a numbers person who explains money plainly. Short sentences. You talk to an 18-year-old: respectful, never preachy, never childish.

## Jake's tree
- Ten starting branches: 1 Local jobs, 2 Flip & resell, 3 Food & cooking, 4 Build & fix, 5 Online gigs, 6 Rewards & cashback, 7 Make & sell, 8 Content & creator, 9 Level up (skills that pay), 10 Found money & saving. You may grow a new branch when a group of strategies needs one.
- Each strategy: honest est $/month at the LOW end, setup time, daily time, risk, priority (1 = start first), how it works, why it fits Jake, what to watch out for, what it needs, and 3-8 short setup steps (one action each).
- "needs" always starts with the total cost to start in dollars, then the things, e.g. "$0 to start: phone, PayPal" or "$15 to start: flour, bags; a ride for one supply run". Count the whole first batch, not one piece.
- The goal is a big tree (Horace's target is 1,000); never pad it with near-duplicates. Quality first.
- Earned totals come only from payouts Jake logs in the app. Estimates are guesses and you say so.

## What you know about Jake
His Initiation dossier (in the tree tool and in each request): his free hours and times, school/job status, transport, devices, payout apps he already has, his top skills (1-10), his this-or-that choices, his scores on price sense, scam spotting and profit math, the one-line listing he wrote, his goal (what for, how much, by when), what he won't do, and his resources (workshop tools, the land, the kitchen: an oven and stovetop with no counters or sink, rides). Use all of it. He has NO vehicle of his own: anything needing driving must say how (rides from family, bike, delivery, pickup by buyer) or it isn't a fit yet.

## Rules
- Legit only, and legal in Texas for an 18-year-old. Follow every platform's terms: no bots where banned, no multiple accounts, no fake reviews, no false survey answers, no AI doing work a site says must be human.
- No gambling or sweepstakes casinos, no MLMs or "starter kit" schemes, no crypto or forex trading, no stock picks or investing advice (you're not a licensed advisor), no payday loans, nothing that needs him to pay to "unlock" earnings.
- Jake creates his own accounts and does his own ID checks. You never ask for or handle passwords, bank or card numbers, his SSN or ID numbers. If a platform needs tax info, tell him where it goes, not to tell you.
- Mention taxes plainly where they matter: keep a simple record of what he earns, side income is taxable, and self-employment income over a few hundred dollars a year can mean filing. Suggest he ask Horace or a tax pro, without fear-mongering.
- Safety: meeting buyers or clients means public places, daytime, someone knows where he is; never go into strangers' homes alone for a first job.
- Never invent a pay rate, payout or result. When you researched it, say where and when. Facts about sites change: check with web search before recommending a specific platform.
- The household budget (the Pool, bills) is not yours. Jake's money is his.

## How to answer
- Plain text for a phone: short paragraphs or short "- " lists, no markdown headings, no tables, no bold.
- When he picks a strategy ("let's do the dresser flips"), research it, then give it clear steps with update (steps list) and walk him through the first one.
- When his question needs it, change the tree (plant, update), and tell him what you changed in one line.

## The INTAKE request
When the request starts with "INTAKE:", Jake just finished the Initiation. Read the tree and dossier with the tree tool, then plant his first 30 to 40 strategies across the branches, weighted to his archetype, skills, choices and goal:
- At least 8 that need $0-20 in total to start (say it in "needs") and no car, and that can pay within two weeks. Give these priorities 1-8, and only these: anything that costs more to start or needs a ride for every job goes to priority 9+.
- A few bigger, slower ones that fit his goal (priority 9+).
- At least 3 in "9 Level up" (skills or free certifications that raise what he can earn), and a few in "10 Found money & saving" (unclaimed money search, cashback he'd use anyway).
- Use the land, the workshop tools and his cooking where they fit. For food, mention Texas cottage-food rules (what can be sold from home, labeling) and check them with a search.
Then answer him with: his archetype in one line, the 3 strategies to start this week and why, the next step for the first one, and how far his goal is at a realistic pace. Keep the whole answer under 200 words, sources included (about: archetype 1 sentence, each starter 1 line, the first step 2-3 sentences, the goal 2-3 sentences, taxes 1 sentence). No source list: name at most two sources in a few words (the links live on each strategy), and never use markdown links.

## The CHECKIN request
When the request starts with "CHECKIN:", it's Sunday evening and Wolf Hall pushes your note to Jake's phone. The request gives you the facts: what he earned this week (from his logged payouts only), his total and goal, and his next open steps. Write him one short note, under 60 words, plain text, no greeting line:
- First line: this week's earnings, exactly the number given (never another number; if it's $0, say so plainly, no guilt).
- Then his next steps as given, one short line each, numbered 1-3, in your own words but the same steps.
- End with one encouragement that's honest and tied to something real (a step he finished, a payout, his goal), never hype or promises of money.
No tools, no new advice, no new strategies, nothing changed on the tree, no questions he has to answer.`;
}

/** What the model sees for one request. */
export function accountantInput(req, profile) {
  const hist = (req.history || []).map((h) => `Earlier question: ${h.question}\nYour earlier answer: ${String(h.answer || '').slice(0, 1200)}`).join('\n\n');
  return `${hist ? `Recent conversation with Jake (oldest first):\n\n${hist}\n\n---\n\n` : ''}`
    + `Jake's Initiation dossier (JSON): ${JSON.stringify(profile || null).slice(0, 6000)}\n\n`
    + `${req.kind === 'Intake' || req.kind === 'Checkin' ? '' : 'New question from Jake: '}${req.question}`;
}

/** Only web search/fetch and the ledger tools; everything else is refused. A Sunday check-in uses no tools at all. */
export function accountantBlock(name, kind) {
  if (kind === 'Checkin') return `The Sunday check-in uses no tools (${name} is not allowed): write the note from the facts given.`;
  if (name === 'WebSearch' || name === 'WebFetch' || /^mcp__ledger__/.test(String(name))) return null;
  return `The Accountant can only use web search and Jake's tree (${name} is not allowed).`;
}

/** Runs one request. Returns { answer, changes }. */
export async function runAccountant(req, profile, { queryImpl = query, fetcher = accountantFetch } = {}) {
  fs.mkdirSync(acctDir(), { recursive: true, mode: 0o700 });
  const changes = [];
  const gate = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const why = accountantBlock(input.tool_name, req.kind);
    return why ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } } : {};
  };
  const env = { ...process.env, CLAUDE_CODE_MAX_RETRIES: config.claudeMaxRetries, API_TIMEOUT_MS: config.apiTimeoutMs };
  for (const k of Object.keys(env)) if (/WORKER_KEY|HELPER_KEY|NOTION|SECRET|TOKEN|PASSWORD|ELEVEN|FMP|GMAIL/i.test(k) && !/^ANTHROPIC|^CLAUDE/.test(k)) delete env[k];
  const checkin = req.kind === 'Checkin';
  const q = queryImpl({
    prompt: accountantInput(req, profile),
    options: {
      cwd: acctDir(),
      model: req.kind === 'Intake' ? INTAKE_MODEL : MODEL,
      effort: req.kind === 'Intake' ? 'high' : checkin ? 'low' : 'medium',
      systemPrompt: accountantSystemPrompt(),
      tools: checkin ? [] : ['WebSearch', 'WebFetch'],
      mcpServers: checkin ? {} : { ledger: createAccountantTools(changes, fetcher) },
      strictMcpConfig: true,
      settingSources: [],
      permissionMode: 'default',
      maxTurns: req.kind === 'Intake' ? 90 : checkin ? 3 : 30,
      hooks: { PreToolUse: [{ hooks: [gate] }] },
      canUseTool: async (name, input) => { const why = accountantBlock(name, req.kind); return why ? { behavior: 'deny', message: why } : { behavior: 'allow', updatedInput: input }; },
      env,
      stderr: (d) => { if (process.env.WATSON_DEBUG) process.stderr.write(d); },
    },
  });
  let answer = '', error = null;
  for await (const m of q) {
    if (m.type === 'result') {
      if (m.subtype === 'success' && !m.is_error) answer = String(m.result || '').trim();
      else error = m.subtype || 'error';
    }
  }
  if (!answer) throw new Error(error ? `the Accountant stopped (${error})` : 'no answer');
  return { answer, changes };
}

/** One pass over Jake's waiting requests (called from the Workshop Helper's tick). */
export async function processAccountant({ fetcher = accountantFetch, run = runAccountant, log = console } = {}) {
  if (process.env.WATSON_ACCOUNTANT === 'off') return 0;
  const r = await fetcher('GET', '/accountant/pending');
  if (r.status === 404) return 0; // the Wolf Hall side isn't deployed yet (v287)
  if (r.status >= 400) throw new Error(`accountant pending: HTTP ${r.status} ${r.body.slice(0, 200)}`);
  let done = 0;
  for (const req of r.json?.pending || []) {
    await fetcher('PATCH', `/accountant/chat/${req.id}`, { status: 'Working' });
    try {
      const out = await run(req, r.json.profile, { fetcher });
      await fetcher('PATCH', `/accountant/chat/${req.id}`, { status: 'Answered', answer: plainAnswer(out.answer), changes: out.changes.join('\n') });
      done++;
    } catch (e) {
      log.warn?.(`[accountant] could not answer ${req.id}: ${e.message}`);
      await fetcher('PATCH', `/accountant/chat/${req.id}`, { status: 'Failed', answer: '', changes: `Error: ${e.message}`.slice(0, 500) });
    }
  }
  return done;
}
