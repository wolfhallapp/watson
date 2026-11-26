// The evening note (Night Shift #106, 11/23 per Horace 15A, 16, 17; round 20: 8 PM). Every evening at 8 PM Central,
// in code (no AI call), Horace gets one short push: what the Night Shift finished since the last note, what is
// waiting for his "deploy" (oracle/next, the one release branch), and how many Red Pill questions are open.
// The full release summary (what changes for whom, tests, Agent Smith, per branch) is written to
// data/release-summary.md, which the day session reads when he says "deploy". It never merges, deploys or pushes code.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DATA_DIR, config } from './config.js';
import { state } from './store.js';
import { allSections, sectionTitle, buildBoard, waitingBranches as boardBranches, REPOS, PATHS as BOARD } from './nightboard.js';
import { pushHorace } from './signin-watch.js';
import { windowsNotify } from './notify.js';

export const SUMMARY_FILE = path.join(DATA_DIR, 'release-summary.md');
export const PUSH_MAX = 300; // the worker's /push/send limit
const TZ = 'America/Chicago';
export const centralDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ── Pure helpers ──
/** The branch a report section is about: its "task branch oracle/..." when the Branch line starts with oracle/next. */
export function taskBranch(sec) {
  const m = String(sec?.body || '').match(/task branch\s+`?(oracle\/[\w./-]*\w)/i);
  return m ? m[1] : sec?.branch || null;
}

/** Agent Smith's last verdict and the full-suite count a section reports ({ smith: 'PASS'|'FAIL'|null, tests }). */
export function checksOf(body) {
  let smith = null, tests = null;
  for (const l of String(body || '').split('\n')) {
    if (/agent[ -]smith/i.test(l)) {
      const v = [...l.matchAll(/\b(PASS|FAIL)\b/g)].pop();
      if (v) smith = v[1];
    }
    if (/suite|tests?\b|pass/i.test(l)) {
      for (const m of l.matchAll(/\b(\d{2,4})\/(\d{2,4})\b/g)) {
        const a = Number(m[1]), b = Number(m[2]);
        if (b >= 40 && a <= b) tests = `${a}/${b}`; // whole-suite counts only (dates like 11/23 are too small)
      }
    }
  }
  return { smith, tests };
}

/** Who a change is for, from its title and text. */
export function whoFor(text) {
  const t = String(text || '');
  const who = [];
  if (/\b(Taylor|Seraph)\b/i.test(t)) who.push('Taylor');
  if (/\b(Jake|Link)\b/.test(t)) who.push('Jake');
  if (/\b(Tatiyana|Katana|the girls|girls')\b/i.test(t)) who.push('the girls');
  if (/\bOracle\b/.test(t)) who.push('the Oracle');
  if (/\b(NEO|Horace)\b/.test(t) && !who.length) who.push('Horace');
  return who.length ? who : ['everyone'];
}

/** A title short enough for a phone line: no trailing "(Horace 13A)" or "(done ...)", cut at a word. */
export function shortTitle(title, max = 44) {
  let t = sectionTitle(title).replace(/\s*\([^)]*\)\s*$/, '').replace(/[.:;,]\s*$/, '').trim();
  if (t.length <= max) return t;
  t = t.slice(0, max - 1);
  return t.slice(0, Math.max(t.lastIndexOf(' '), 20)).replace(/[,;:\s]+$/, '') + '…';
}

const isBlocked = (s) => /\bblocked\b/i.test(s.heading) || /^\s*(\*\*)?(status:?\s*)?blocked\b/im.test(s.body.slice(0, 600));

/**
 * Pure: the report sections finished since the last note. Sections come from the report for today and for
 * tomorrow (runs after 5 PM already write tomorrow's report); `seen` holds ids already sent.
 */
export function newSections(sections, seen = [], today) {
  const days = new Set([today, addDays(today, 1)]);
  const had = new Set(seen);
  return sections.filter((s) => days.has(s.date)).map((s) => ({ ...s, id: `${s.date}|${s.heading}`.slice(0, 200) }))
    .filter((s) => !had.has(s.id));
}

/** Pure: one entry per branch, with the newest section about it. */
export function describe(branches, sections) {
  return branches.map((b) => {
    const sec = [...sections].reverse().find((s) => taskBranch(s) === b.branch || s.branch === b.branch);
    // Who it's for comes from the title and the opening lines only (the full write-up names everyone in passing).
    const text = sec ? sec.heading + '\n' + sec.body.slice(0, 400) : b.subject || b.branch;
    return { ...b, title: sec ? sectionTitle(sec.heading) : (b.subject || b.branch), ...checksOf(sec?.body), who: whoFor(text) };
  });
}

/** Pure: the push (≤ 300 characters) and the full markdown summary. */
export function composeNote({ day, finished = [], release = {}, oracle = [], questions = 0 }) {
  const done = finished.filter((s) => !isBlocked(s)), blocked = finished.filter(isBlocked);
  const on = release.on || [], off = release.off || [];
  const tail = [];
  if (on.length) tail.push(`Ready: Wolf Hall ${release.nextVersion || 'release'} (${on.length} change${on.length === 1 ? '' : 's'}${smithAll(on)}). Say "deploy" to ship it.`);
  else if (off.length || oracle.length) tail.push('Nothing on the release yet.');
  const waitBits = [off.length && `${off.length} Wolf Hall`, oracle.length && `${oracle.length} Oracle`].filter(Boolean);
  if (waitBits.length) tail.push(`${waitBits.join(' + ')} branch${off.length + oracle.length === 1 ? '' : 'es'} not on it.`);
  if (questions) tail.push(`${questions} question${questions === 1 ? '' : 's'} on the Red Pill board.`);
  if (!finished.length && !tail.length) return null; // nothing to say tonight
  const end = tail.join(' ');
  let head = '';
  if (done.length) {
    const room = PUSH_MAX - end.length - 45; // "Finished N: ", "; +N more." and " N blocked." always fit
    const names = []; let used = 0;
    for (const s of done) {
      const n = shortTitle(s.heading, 38);
      if (used + n.length + 2 > room && names.length) break;
      names.push(n); used += n.length + 2;
    }
    const more = done.length - names.length;
    head = `Finished ${done.length}: ${names.join('; ')}${more ? `; +${more} more` : ''}`;
    if (!head.endsWith('…')) head += '.';
  } else head = 'Night Shift: nothing new finished today.';
  if (blocked.length) head += ` ${blocked.length} blocked.`;
  let body = `${head} ${end}`.trim();
  if (body.length > PUSH_MAX) body = body.slice(0, PUSH_MAX - 1).replace(/\s+\S*$/, '') + '…';

  const md = [`# Release summary, ${day}`, '', `Written by the Oracle's evening note at 8 PM. Live (main) is ${release.mainVersion || '?'}; oracle/next is ${release.nextVersion || '?'}, ${release.ahead || 0} commit(s) ahead.`, ''];
  md.push('## On the release (ships when Horace says "deploy")', '');
  if (!on.length) md.push('- Nothing yet: oracle/next is the same as main.');
  for (const b of on) md.push(line(b));
  md.push('', '## Finished but not on oracle/next yet (the day session adds them before shipping)', '');
  if (!off.length) md.push('- None.');
  for (const b of off) md.push(line(b));
  md.push('', '## Oracle branches waiting (red pill + restart)', '');
  if (!oracle.length) md.push('- None.');
  for (const b of oracle) md.push(line(b));
  md.push('', '## Finished since the last note', '');
  if (!finished.length) md.push('- Nothing new.');
  for (const s of finished) md.push(`- ${isBlocked(s) ? '(blocked) ' : ''}${sectionTitle(s.heading)} [${s.date}]`);
  md.push('', `Open Red Pill questions: ${questions}.`, '', `Push sent: "${body}"`, '');
  return { title: 'Tonight from the Night Shift', body, md: md.join('\n') };
}
function smithAll(list) {
  const known = list.filter((b) => b.smith);
  if (!known.length) return '';
  const pass = known.filter((b) => b.smith === 'PASS').length;
  return pass === known.length ? ', Agent Smith passed all' : `, Agent Smith passed ${pass} of ${known.length}`;
}
function line(b) {
  const bits = [b.version, `for ${b.who.join(', ')}`, b.tests && `tests ${b.tests}`, b.smith && `Agent Smith ${b.smith}`].filter(Boolean).join(' · ');
  return `- **${b.title}** (${b.branch}) ${bits}`;
}

// ── Gather (git reads only) ──
function git(dir, args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 30000 }).trim(); }
function swVersion(dir, ref) { try { return (git(dir, ['show', `${ref}:sw.js`]).match(/CACHE = 'wolfhall-(v[\w]+)'/) || [])[1] || ''; } catch { return ''; } }
export const verNum = (v) => Number((String(v || '').match(/^v(\d+)/) || [])[1]) || 0;
function refs(dir, filters, since) {
  let txt = '';
  try { txt = git(dir, ['for-each-ref', ...filters, '--format=%(refname:short)%09%(committerdate:short)%09%(subject)', 'refs/heads/oracle/']); } catch { return []; }
  return txt.split('\n').filter(Boolean).map((l) => { const [branch, date, subject] = l.split('\t'); return { branch, date, subject }; })
    .filter((b) => b.branch !== 'oracle/next' && (!since || b.date >= since));
}

export function gatherRelease({ dir = config.projectDir, oracleDir = ROOT, today = centralDay(), sections = allSections() } = {}) {
  const since = addDays(today, -1); // finished today or yesterday; older stale branches are the cleanup report's job
  const hasNext = (() => { try { git(dir, ['rev-parse', '--verify', '-q', 'oracle/next']); return true; } catch { return false; } })();
  let ahead = 0; if (hasNext) { try { ahead = Number(git(dir, ['rev-list', '--count', 'main..oracle/next'])) || 0; } catch { /* ignore */ } }
  const withVer = (bs) => bs.map((b) => ({ ...b, version: swVersion(dir, b.branch) }));
  const mainVersion = swVersion(dir, 'main');
  const on = hasNext ? withVer(refs(dir, ['--merged', 'oracle/next', '--no-merged', 'main'])) : [];
  // A branch whose version is at or below live was shipped another way (a combined release) or replaced: not waiting.
  const off = withVer(refs(dir, hasNext ? ['--no-merged', 'main', '--no-merged', 'oracle/next'] : ['--no-merged', 'main'], since))
    .filter((b) => !(verNum(b.version) && verNum(b.version) <= verNum(mainVersion)));
  const oracle = refs(oracleDir, ['--no-merged', 'main'], since);
  return {
    release: { mainVersion, nextVersion: hasNext ? swVersion(dir, 'oracle/next') : '', ahead, on: describe(on, sections), off: describe(off, sections) },
    oracle: describe(oracle, sections),
  };
}

/** Open questions on the Red Pill board: asked there and not yet answered (the board state's "synced" ids). */
export function openQuestions({ sections = allSections() } = {}) {
  const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
  const st = read(BOARD.state, { versions: {}, synced: {} });
  const board = buildBoard(REPOS().flatMap((r) => boardBranches(r.repo, r.dir, st.versions || {})), sections, read(BOARD.extra, []));
  const answered = st.synced || {};
  return board.branches.reduce((n, b) => n + (b.questions || []).filter((q) => !(q.id in answered)).length, 0);
}

/**
 * The 8 PM run. `io` swaps the outside world in tests. Sends at most one push a day (the routine runs once a day);
 * a failed push falls back to a Windows notification. Returns what it did.
 */
export async function eveningNote(io = {}) {
  const now = io.now || new Date(), today = centralDay(now), store = io.store || state, log = io.log || console;
  const sections = io.sections || allSections();
  const prev = store.get().eveningNote || {};
  const finished = newSections(sections, prev.seen, today);
  const { release, oracle } = (io.gather || gatherRelease)({ today, sections });
  let questions = 0; try { questions = (io.questions || openQuestions)({ sections }); } catch (e) { log.log(`  Evening note: questions skipped (${e.message})`); }
  const note = composeNote({ day: today, finished, release, oracle, questions });
  const seen = [...(prev.seen || []), ...finished.map((s) => s.id)].slice(-400);
  if (!note) { store.set({ eveningNote: { ...prev, seen, checkedAt: now.toISOString() } }); log.log('  Evening note: nothing to say'); return { sent: false }; }
  try { (io.writeFile || fs.writeFileSync)(io.summaryFile || SUMMARY_FILE, note.md); } catch (e) { log.log(`  Evening note: summary not saved (${e.message})`); }
  let how = 'push';
  try {
    const r = await (io.push || pushHorace)(note.body, { title: note.title });
    if (!r.ok || !r.sent) throw new Error(r.error || 'no phones took it');
  } catch (e) {
    log.log(`  Evening note: push failed (${e.message}); Windows notification instead`);
    how = (await (io.toast || windowsNotify)(note.body)) ? 'windows' : 'none';
  }
  store.set({ eveningNote: { seen, sentAt: now.toISOString(), how, body: note.body } });
  log.log(`  Evening note sent (${how}): ${note.body}`);
  return { sent: how !== 'none', how, note };
}
