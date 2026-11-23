/**
 * The Red Pill board (Wolf Hall v310). Every 15 minutes, in code (no AI call):
 *  1. List every night branch still waiting (not merged into main) in both repos, with its version, its summary
 *     from the night reports (or its last commit), its screenshots, and the open questions from the report's
 *     "Waiting on you" part plus data/night-board-questions.json (questions written by hand, with the day
 *     session's picks). Upload it to the app (PUT /night-board, master key) only when it changed.
 *  2. Read Horace's taps (GET /night-board) and append any new or changed answer to data/night-answers.md, which
 *     the next Night Shift run reads.
 * It never merges, deploys or pushes anything, and the app keeps the answers as saved-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, config } from './config.js';
import { WORKER_URL, workerKey } from './knowledge.js';

export const BOARD_EVERY = 15 * 60000;
const DATA = path.join(ROOT, 'data');
export const PATHS = {
  reports: path.join(DATA, 'night-reports'),
  extra: path.join(DATA, 'night-board-questions.json'),
  state: path.join(DATA, 'night-board-state.json'),
  answers: path.join(DATA, 'night-answers.md'),
};
export const REPOS = () => [{ repo: 'wolf-hall', dir: config.projectDir }, { repo: 'oracle', dir: ROOT }];

const clean = (s) => String(s || '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

/** Pure: a night report split into its "## " sections, each with the branch it names and its screenshots. */
export function reportSections(md, date) {
  const out = [];
  for (const part of String(md || '').split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n'), heading = clean(nl < 0 ? part : part.slice(0, nl)), body = nl < 0 ? '' : part.slice(nl + 1);
    // Only a section's own "**Branch...**" line (or the few lines under "**Branches:**") names its branch; a
    // report that merely mentions other branches (a cleanup report) is not about any of them.
    const ls = body.split('\n'), bi = ls.findIndex((l) => /^\s*(-\s*)?\*\*Branch/i.test(l));
    const near = bi < 0 ? '' : ls.slice(bi, bi + 4).join('\n');
    const branch = bi < 0 ? null : ((ls[bi].match(/oracle\/[\w./-]*\w/) || near.match(/oracle\/[\w./-]*\w/) || [null])[0]);
    const shots = [...new Set(body.match(/[\w.-]+\.png/g) || [])];
    out.push({ heading, title: sectionTitle(heading), date, branch, shots, body });
  }
  return out;
}
/** "Queue #37 (11/23 add): Away mode for the Thanksgiving trip (done; ...)" -> "Away mode for the Thanksgiving trip" */
export function sectionTitle(h) {
  let t = clean(h).replace(/^(Task|Queue|Push task|11\/\d+ (push|queue|add)|Night-branch)[^:]*:\s*/i, '');
  t = t.replace(/\s*\((done|blocked)[^)]*\)\s*$/i, '').replace(/^\(self-chosen\)\s*/i, '');
  return t.slice(0, 200);
}

/**
 * Pure: the lettered questions in a section's "Waiting on you" part. Two shapes the Night Shift writes:
 *   "1. **Title.** text" followed by indented "- A) option" lines, and
 *   "2. Question? A: option (my guess). B: option. C: Other."
 * "(my guess)" marks the guess; an "Other" option is dropped (the app always offers Other with a text box).
 */
export function parseQuestions(body, prefix) {
  const lines = String(body || '').split('\n');
  const start = lines.findIndex((l) => /Waiting on you/i.test(l));
  if (start < 0) return [];
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\*\*[^*]+\*\*/.test(lines[i]) && !/^\*\*(Questions|Red pill)/i.test(lines[i])) break; // the next labelled part
    block.push(lines[i]);
  }
  const qs = []; let cur = null;
  const finish = () => {
    if (!cur) return;
    let text = cur.text;
    const inl = text.match(/^(.*?[?.:])\s+A[:)]\s+(.*)$/);
    if (!cur.opts.length && inl) {
      text = inl[1];
      const parts = ('A: ' + inl[2]).split(/\s(?=[B-H][:)]\s)/);
      for (const p of parts) { const m = p.match(/^([A-H])[:)]\s+(.*)$/); if (m) cur.opts.push({ k: m[1], t: m[2] }); }
    }
    const options = []; let guess = '';
    for (const o of cur.opts) {
      let t = clean(o.t).replace(/[.;,]\s*$/, '');
      if (/\(my guess\)/i.test(t)) { guess = o.k; t = t.replace(/\s*\(my guess\)/i, '').trim(); }
      if (/^other\b/i.test(t) || !t) continue;
      options.push({ k: o.k, t: t.slice(0, 240) });
    }
    if (options.length >= 2) qs.push({ id: `${prefix}#${cur.n}`, text: clean(text).slice(0, 500), options, guess: options.some((o) => o.k === guess) ? guess : '' });
    cur = null;
  };
  for (const l of block) {
    const q = l.match(/^\s*(?:-\s+)?(\d+)\.\s+(.*)$/);
    const o = l.match(/^\s*-\s+([A-H])\)\s+(.*)$/);
    if (q) { finish(); cur = { n: q[1], text: q[2], opts: [] }; } else if (o && cur) cur.opts.push({ k: o[1], t: o[2] });
  }
  finish();
  return qs;
}

/** Pure: "oracle/night-2026-11-23-away" in the Wolf Hall repo -> "wh:2026-11-23-away". */
export function branchPrefix(repo, branch) {
  return (repo === 'oracle' ? 'or:' : 'wh:') + branch.replace(/^oracle\/(night-)?/, '').replace(/[^\w.\/-]/g, '-').slice(0, 60);
}

/**
 * Pure: the board from the waiting branches, the report sections (oldest report first) and the hand-written
 * questions. The newest section naming a branch gives its summary and its questions.
 */
export function buildBoard(branches, sections, extra = []) {
  const out = [];
  for (const b of branches) {
    const secs = sections.filter((s) => s.branch === b.branch);
    const sec = secs[secs.length - 1];
    const prefix = branchPrefix(b.repo, b.branch);
    // A branch name used in both repos: the report's questions go on the Wolf Hall one only (asked once).
    const twin = b.repo === 'oracle' && branches.some((x) => x.repo === 'wolf-hall' && x.branch === b.branch);
    const questions = sec && !twin ? parseQuestions(sec.body, prefix) : [];
    for (const e of extra.filter((x) => x.branch === b.branch && (!x.repo || x.repo === b.repo))) {
      for (const q of e.questions || []) {
        const i = questions.findIndex((x) => x.id === q.id);
        if (i >= 0) questions[i] = { ...questions[i], ...q }; else questions.push(q);
      }
    }
    out.push({ repo: b.repo, branch: b.branch, version: b.version || '', date: b.date || '', commits: b.commits || 0,
      summary: (sec?.title || b.subject || b.branch).slice(0, 400), shots: (sec?.shots || []).slice(0, 10), link: '', questions: questions.slice(0, 12) });
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.branch.localeCompare(b.branch));
  return { branches: out.slice(0, 80) };
}

/** Pure: new or changed answers as lines for night-answers.md, and the updated "already copied" map. */
export function answerLines(board, answers, synced = {}) {
  const qs = {};
  for (const b of board?.branches || []) for (const q of b.questions || []) qs[q.id] = { q, b };
  const lines = [], next = {};
  for (const [id, a] of Object.entries(answers || {})) {
    next[id] = a.at || '';
    if (synced[id] === next[id]) continue;
    const hit = qs[id], opt = hit?.q.options.find((o) => o.k === a.pick);
    const what = a.pick === 'Other' ? `Other: ${a.other}` : `${a.pick}${opt ? ` (${opt.t})` : ''}${a.other ? `; note: ${a.other}` : ''}`;
    lines.push(`- ${id}${hit ? ` [${hit.b.branch}${hit.b.version ? ' ' + hit.b.version : ''}] "${hit.q.text}"` : ''}: ${what} (tapped ${a.at || '?'})`);
  }
  for (const id of Object.keys(synced)) if (!(id in next)) lines.push(`- ${id}: Horace took back his answer (undo on the board).`);
  return { lines, synced: next };
}

// ── IO ──
function git(dir, args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 30000 }).trim(); }

/** Night branches not merged into main, in one repo. Versions are cached per commit. */
export function waitingBranches(repo, dir, cache = {}) {
  let names;
  try { names = git(dir, ['branch', '--no-merged', 'main', '--format=%(refname:short)', '--list', 'oracle/*']).split('\n').filter(Boolean); } catch { return []; }
  return names.map((branch) => {
    const [sha, date, subject] = git(dir, ['log', '-1', '--format=%H%x09%cs%x09%s', branch]).split('\t');
    let version = cache[sha];
    if (version === undefined) {
      version = '';
      if (repo === 'wolf-hall') {
        try { version = (git(dir, ['show', `${branch}:sw.js`]).match(/CACHE = 'wolfhall-(v[\w]+)'/) || [])[1] || ''; } catch { /* no sw.js */ }
      }
      cache[sha] = version;
    }
    let commits = 0; try { commits = Number(git(dir, ['rev-list', '--count', `main..${branch}`])) || 0; } catch { /* ignore */ }
    return { repo, branch, sha, date, subject, version, commits };
  });
}

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } }

export function allSections(dir = PATHS.reports) {
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort(); } catch { return []; }
  return files.flatMap((f) => reportSections(fs.readFileSync(path.join(dir, f), 'utf8'), f.slice(0, 10)));
}

async function worker(method, p, body) {
  if (!/^\/night-board$/.test(p)) throw new Error('Only /night-board is allowed here');
  const r = await fetch(WORKER_URL + p, { method, headers: { 'X-Worker-Key': workerKey(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error || `HTTP ${r.status}`);
  return json;
}

/** One pass: upload the board if it changed, then copy new answers. `io` swaps the outside world in tests. */
export async function syncOnce(io = {}) {
  const call = io.worker || worker, paths = { ...PATHS, ...(io.paths || {}) };
  const state = readJson(paths.state, { versions: {}, hash: '', synced: {} });
  const branches = (io.branches || (() => REPOS().flatMap((r) => waitingBranches(r.repo, r.dir, state.versions))))();
  const board = buildBoard(branches, io.sections || allSections(paths.reports), readJson(paths.extra, []));
  const hash = crypto.createHash('sha1').update(JSON.stringify(board)).digest('hex');
  let uploaded = false;
  if (hash !== state.hash) { await call('PUT', '/night-board', board); state.hash = hash; uploaded = true; }
  const live = await call('GET', '/night-board');
  const { lines, synced } = answerLines(live.board || board, live.answers, state.synced);
  if (lines.length) {
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    fs.appendFileSync(paths.answers, `\n## From the Red Pill board (copied ${now})\nHorace tapped these himself in the app. They override the day session's picks for the same question.\n${lines.join('\n')}\n`);
  }
  state.synced = synced;
  fs.writeFileSync(paths.state, JSON.stringify(state, null, 1));
  return { branches: board.branches.length, uploaded, copied: lines.length };
}

export function startNightBoard({ every = BOARD_EVERY, firstAfter = 60000 } = {}) {
  let running = false, lastErr = '';
  const tick = async () => {
    if (running) return; running = true;
    try { const r = await syncOnce(); lastErr = ''; if (r.uploaded || r.copied) console.log(`  Red Pill board: ${r.branches} branches${r.uploaded ? ', uploaded' : ''}${r.copied ? `, ${r.copied} answer(s) copied` : ''}`); }
    catch (e) { if (e.message !== lastErr) console.log(`  Red Pill board failed: ${e.message}`); lastErr = e.message; }
    finally { running = false; }
  };
  setTimeout(tick, firstAfter);
  return setInterval(tick, every);
}
