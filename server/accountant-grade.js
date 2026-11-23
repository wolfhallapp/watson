// The Accountant's dry run (Night Shift 11/23, task #23): a mocked ledger that stands in for the Wolf Hall /accountant
// routes (no Notion, never Jake's real tree), three made-up Initiation profiles, and a grader that checks every planted
// strategy against the intake rules. Used by scripts/accountant-dryrun.js and tests/accountant-grade.test.js.

// Mirrors the worker's ACCT_BRANCHES / ACCT_OPTIONS (v287) so the mock rejects what the real routes reject.
export const BRANCHES = ['1 Local jobs', '2 Flip & resell', '3 Food & cooking', '4 Build & fix', '5 Online gigs',
  '6 Rewards & cashback', '7 Make & sell', '8 Content & creator', '9 Level up', '10 Found money & saving'];
const OPTIONS = { status: ['Idea', 'Researching', 'Started', 'Earning', 'Paused', 'Dropped'], setup: ['Minutes', 'An hour', 'A day', 'A week+'],
  dailyTime: ['None', 'Under 5 min', '15-30 min', '1 hr+'], risk: ['Low', 'Medium', 'High'] };

/** An in-memory stand-in for GET /accountant/pending and POST /accountant/tree. Same validation as acctProps. */
export function mockLedger(profile) {
  const strategies = [];
  let n = 0;
  const reply = (status, json) => ({ status, json, body: JSON.stringify(json) });
  const check = (b, isNew) => {
    if (isNew && !String(b.name || '').trim()) return 'name is required';
    for (const k of ['status', 'setup', 'dailyTime', 'risk']) if (b[k] !== undefined && !OPTIONS[k].includes(b[k])) return `${k} must be one of ${OPTIONS[k].join(', ')}`;
    if (b.estMonthly !== undefined && !(Number(b.estMonthly) >= 0 && Number(b.estMonthly) < 100000)) return 'estMonthly looks wrong';
    if (b.priority !== undefined && !(Number.isInteger(Number(b.priority)) && b.priority >= 1 && b.priority <= 999)) return 'priority is a whole number, 1 = start first';
    if (b.steps !== undefined && (!Array.isArray(b.steps) || b.steps.length > 20)) return 'steps: a list of up to 20';
    return null;
  };
  const fetcher = async (method, p, body) => {
    if (method === 'GET' && p === '/accountant/pending') {
      return reply(200, { ok: true, pending: [], profile, goal: 1000, branches: [...BRANCHES, ...new Set(strategies.map((s) => s.branch).filter((b) => !BRANCHES.includes(b)))],
        count: strategies.length, earned: 0, thisMonth: 0, strategies: strategies.map((s) => ({ ...s, earned: 0, steps: s.steps.map((t) => ({ t, d: false })) })) });
    }
    if (method === 'POST' && p === '/accountant/tree') {
      const isNew = body?.action === 'plant';
      if (!isNew && body?.action !== 'update') return reply(400, { ok: false, error: 'action must be plant or update' });
      const bad = check(body, isNew); if (bad) return reply(400, { ok: false, error: bad });
      const fields = ['name', 'branch', 'status', 'estMonthly', 'setup', 'dailyTime', 'risk', 'priority', 'how', 'watch', 'why', 'needs', 'notes', 'link', 'steps'];
      const pick = (o) => Object.fromEntries(fields.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
      if (isNew) {
        if (strategies.some((s) => s.name.toLowerCase() === String(body.name).trim().toLowerCase())) return reply(409, { ok: false, error: 'already on the tree' });
        const s = { id: `mock${String(++n).padStart(28, '0')}`, status: 'Idea', branch: BRANCHES[0], steps: [], ...pick(body) };
        s.steps = (s.steps || []).map((x) => (typeof x === 'string' ? x : x?.t)).filter(Boolean);
        strategies.push(s);
        return reply(200, { ok: true, strategy: s });
      }
      const s = strategies.find((x) => x.id === body.id);
      if (!s) return reply(404, { ok: false, error: 'not found' });
      Object.assign(s, pick(body));
      if (body.steps) s.steps = body.steps.map((x) => (typeof x === 'string' ? x : x?.t)).filter(Boolean);
      return reply(200, { ok: true, strategy: s });
    }
    return reply(404, { ok: false, error: 'not found' });
  };
  return { fetcher, strategies };
}

// Words that mean a strategy breaks the rules outright.
const BANNED = [
  [/\b(sweepstakes|casino|gambl\w*|sports ?bet\w*|poker)\b/i, 'gambling'],
  [/\b(mlm|multi-level|network marketing|starter kit|downline)\b/i, 'MLM'],
  [/\b(crypto\w*|bitcoin|forex|day ?trad\w*|nft)\b/i, 'crypto/trading'],
  [/\b(stock picks?|options trading)\b/i, 'investing advice'],
  [/\b(payday loan|cash advance app)\b/i, 'payday loans'],
  [/\b(fake reviews?|multiple accounts|bot(s|ting)?)\b/i, 'platform-rule breaking'],
  // A platform's one-time sign-up fee (TaskRabbit's $25) is legit; paying to see or withdraw earnings is not.
  [/\b(pay to unlock|upgrade fee to withdraw|pay to withdraw|unlock (your )?earnings)\b/i, 'pay-to-earn'],
];
// Words that mean the strategy needs driving. Fine only if it also says how he gets there without his own car.
const DRIVING = /\b(doordash|uber ?eats|instacart|lyft|uber driver|spark driver|amazon flex|shipt|roadie|grubhub|deliver(y|ies) driver|drive to|driving to|your car|your truck|own car|own vehicle)\b/i;
const NO_CAR_PLAN = /\b((guests?|customers?|buyers?|clients?|people) (drive|drives|come|comes) to (you|him|the land|the house)|no driving|(wait|once|after|until|when)\b.{0,25}\b(the|a|his|your) (truck|car)|rides?|bike|bicycle|walk(ing)? distance|walks? to|pick ?up by (the )?buyer|buyers? (come|pick)|local pickup|ships?|shipping|mail(s|ed)?)\b/i;
// Phrases that mean a step is cheap or free to start.
const CHEAP = /(\$0|free|no cost|nothing|\$5|\$10|\$15|\$20|under \$20|none)/i;

/** Grade one planted strategy. Returns a list of problems (empty = clean). */
export function gradeStrategy(s) {
  const problems = [];
  const all = [s.name, s.how, s.why, s.watch, s.needs, s.notes, ...(s.steps || [])].filter(Boolean).join(' \n ');
  // "no MLM", "avoid crypto" are good warnings, not violations: only count a banned word outside a warning.
  const body = [s.name, s.how, s.why, s.needs, ...(s.steps || [])].filter(Boolean).join(' \n ');
  for (const [re, label] of BANNED) {
    const m = body.match(re);
    if (m && !new RegExp(`(no|not|never|avoid|skip|isn.t|aren.t|don.t|won.t|stay away from|without|instead of|not an?)\\W+(\\w+\\W+){0,4}${m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(body)) problems.push(`mentions ${label} (${m[0]})`);
  }
  if (DRIVING.test(all) && !NO_CAR_PLAN.test(all)) problems.push('needs driving with no plan for a ride, pickup or shipping');
  for (const k of ['how', 'why']) if (!String(s[k] || '').trim()) problems.push(`no ${k}`);
  for (const k of ['estMonthly', 'setup', 'dailyTime', 'risk', 'priority']) if (s[k] === undefined || s[k] === null) problems.push(`no ${k}`);
  const steps = s.steps || [];
  if (steps.length < 3 || steps.length > 8) problems.push(`${steps.length} steps (want 3-8)`);
  if (s.link !== undefined && s.link && !/^https:\/\//.test(s.link)) problems.push('link is not https');
  return problems;
}

/** Is it a starter: $0-20 to start, no car, can pay within two weeks? (best effort from the text) */
export function isStarter(s) {
  const txt = [s.needs, s.how, ...(s.steps || [])].filter(Boolean).join(' ');
  // The prompt asks "needs" to lead with "$X to start" (or "$X-Y to start"); count the top of a range. Otherwise be
  // conservative: the largest dollar figure named, or a free/no-cost phrase. Things with no price at all don't count.
  const needs = String(s.needs || '');
  const lead = needs.match(/\$(\d+)(?:\s*(?:-|to)\s*\$?(\d+))?\s+(?:in total\s+)?to start/i);
  const dollars = [...needs.matchAll(/\$(\d+)(?:\s*-\s*\$?(\d+))?/g)].map((m) => Number(m[2] || m[1]));
  const cheap = lead ? Number(lead[2] || lead[1]) <= 20 : dollars.length ? Math.max(...dollars) <= 20 : (CHEAP.test(needs) || !s.needs);
  const quick = s.setup === 'Minutes' || s.setup === 'An hour' || s.setup === 'A day';
  return cheap && quick && !(DRIVING.test(txt) && !NO_CAR_PLAN.test(txt));
}

/** Grade a whole planted tree against the INTAKE rules. */
export function gradeTree(strategies, { answer = '' } = {}) {
  const checks = [];
  const add = (ok, what) => checks.push({ ok: !!ok, what });
  const n = strategies.length;
  add(n >= 30 && n <= 40, `30-40 strategies (${n})`);
  const top8 = strategies.filter((s) => s.priority >= 1 && s.priority <= 8);
  const starters = top8.filter(isStarter);
  add(starters.length >= 8, `8+ starters at priority 1-8 that are cheap, quick and car-free (${starters.length} of ${top8.length})`);
  const inBranch = (b) => strategies.filter((s) => s.branch === b).length;
  add(inBranch('9 Level up') >= 3, `3+ in 9 Level up (${inBranch('9 Level up')})`);
  add(inBranch('10 Found money & saving') >= 2, `a few in 10 Found money & saving (${inBranch('10 Found money & saving')})`);
  add(strategies.some((s) => s.priority >= 9), 'some bigger, slower ones at priority 9+');
  const used = new Set(strategies.map((s) => s.branch)); add(used.size >= 7, `spread across branches (${used.size} used)`);
  const names = strategies.map((s) => s.name.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter((w) => w.length > 3).sort().join(' '));
  const dups = names.filter((x, i) => x && names.indexOf(x) !== i).length; add(dups === 0, `no near-duplicate names (${dups})`);
  const words = String(answer).trim().split(/\s+/).filter(Boolean).length;
  add(words > 0 && words <= 250, `answer under 250 words (${words})`);
  add(!/^#|\*\*|\|---|\[[^\]]+\]\(https?:/m.test(answer), 'answer is plain text (no markdown)');
  const flagged = strategies.map((s) => ({ name: s.name, problems: gradeStrategy(s) })).filter((x) => x.problems.length);
  add(flagged.length === 0, `every strategy clean (${flagged.length} flagged)`);
  return { pass: checks.every((c) => c.ok), checks, flagged };
}

// Three made-up profiles in the shape acctCleanProfile produces. Not Jake; nothing real.
const base = (o) => ({ v: 1, level: 10, xp: 1400, badges: ['Initiated'], price: { score: 5, of: 8, picks: [] }, scam: { score: 7, of: 8, missed: [], picks: [] }, math: { score: 5, of: 6, picks: [] }, ...o });
export const DRY_PROFILES = {
  builder: base({
    basics: { hours: '15-20', times: ['Weekday evenings', 'Weekends'], status: 'Not in school', transport: 'No car; rides from family on weekends', devices: ['Phone', 'PC'], payouts: ['Cash App'], id: 'yes', age18: true },
    skills: { building: 9, fixing: 8, yardwork: 7, fitness: 7, bargains: 5, selling: 4, talking: 4, computers: 5, cooking: 3, video: 2, writing: 2, social: 2 },
    choices: { p1: 'a', p2: 'a', p3: 'a', p4: 'a', p5: 'a', p7: 'b', p8: 'b', p11: 'b', p12: 'a', p15: 'b', p16: 'b' },
    pitch: 'Solid oak dresser, sanded and refinished, new pulls. Sturdy. $180, pickup in Thrall.',
    goal: { for: 'A used truck', amount: 4000, by: '2027-08-01', note: 'So I can get to jobs myself' },
    limits: ['Door-to-door sales', 'Showing my face online'], limitsNote: '',
    resources: { tools: ['Circular saw', 'Drill/driver', 'Orbital sander', 'Oscillating multitool', 'Shop vac', 'Clamps'], land: true, kitchen: true, rides: 'Weekends', sellables: 'An old mini fridge and some games' },
    archetype: { top: 'builder', second: 'hustler', scores: { builder: 34, hustler: 22, flipper: 14, analyst: 8, chef: 6, creator: 4 } },
  }),
  chef: base({
    basics: { hours: '10-15', times: ['Mornings', 'Weekends'], status: 'Part-time job', transport: 'No car; a ride now and then', devices: ['Phone'], payouts: ['PayPal'], id: 'yes', age18: true },
    skills: { cooking: 9, baking: 8, organizing: 7, cleaning: 6, talking: 6, selling: 5, photo: 5, math: 5, building: 3, computers: 3 },
    choices: { p1: 'a', p2: 'b', p3: 'b', p4: 'a', p5: 'a', p7: 'a', p9: 'a', p12: 'a', p13: 'a', p14: 'a', p16: 'b' },
    pitch: 'Fresh sourdough loaves, baked this morning. $8 each or 2 for $15. Order by Thursday.',
    goal: { for: 'A good knife set and a cooking class', amount: 600, by: '2027-03-01', note: '' },
    limits: ['Anything online with strangers'], limitsNote: 'Kitchen has an oven and stovetop, no counters and no sink.',
    resources: { tools: ['Hand tools'], land: true, kitchen: true, rides: 'Sometimes', sellables: '' },
    archetype: { top: 'chef', second: 'hustler', scores: { chef: 30, hustler: 18, flipper: 12, builder: 8, analyst: 6, creator: 6 } },
  }),
  creator: base({
    basics: { hours: '20+', times: ['Late night', 'Afternoons'], status: 'Not in school', transport: 'None', devices: ['Phone'], payouts: ['Cash App', 'PayPal'], id: 'yes', age18: true },
    skills: { video: 8, photo: 8, social: 7, writing: 6, drawing: 6, music: 5, gaming: 6, computers: 4, research: 5, typing: 4 },
    choices: { p2: 'a', p3: 'b', p4: 'b', p5: 'b', p6: 'b', p8: 'a', p9: 'b', p11: 'a', p13: 'b', p15: 'a', p16: 'a' },
    pitch: 'I edit short videos for small businesses: captions, cuts, music. 3 edits for $25.',
    goal: { for: 'A laptop for editing', amount: 900, by: '2027-04-01', note: 'Phone only right now' },
    limits: ['Showing my face', 'Selling to friends'], limitsNote: '',
    resources: { tools: [], land: true, kitchen: false, rides: 'Rarely', sellables: 'Old games' },
    archetype: { top: 'creator', second: 'analyst', scores: { creator: 36, analyst: 20, flipper: 10, hustler: 6, builder: 2, chef: 2 } },
  }),
};

/** The same INTAKE line the worker queues (acctIntakeText, v287). */
export function intakeText(p) {
  const top = Object.entries(p.skills || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}/10`).join(', ');
  return `INTAKE: Jake finished the Initiation. Archetype ${p.archetype?.top || '?'} (then ${p.archetype?.second || '?'}). Goal: ${p.goal?.for || '?'} $${p.goal?.amount || 0}${p.goal?.by ? ' by ' + p.goal.by : ''}. `
    + `Free time ${p.basics?.hours || '?'} a week (${(p.basics?.times || []).join(', ')}). Transport: ${p.basics?.transport || '?'}. Top skills: ${top}. Plant his tree.`;
}
