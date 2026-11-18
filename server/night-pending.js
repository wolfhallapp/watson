// Night work still waiting on Horace (Night Shift, self-chosen 2026-11-18). Night branches pile up
// unmerged (the 11/01 Wolf Hall fixes sat for weeks unnoticed), and the briefing only ever mentioned the
// last night. This lists every oracle/night-* branch, in both repos, that still has work main doesn't,
// for a "🧩" briefing line and scripts/night-pending.mjs. Read-only: it only runs git log and for-each-ref.
//
// A commit counts as carried (not waiting on its own) when main or a NEWER night branch has a commit with
// the same subject, or one that says "port of <its sha>". That's how night stacks are built: the 11/13
// stack re-commits the 11/11 and 11/12 work under the same subjects, so those branches ride its red pill.
import { execFileSync } from 'node:child_process';
import { config, ROOT } from './config.js';

export const NIGHT_REPOS = [
  { name: 'Wolf Hall', dir: config.projectDir },
  { name: 'Oracle', dir: ROOT },
];

const SEP = '\x1f', END = '\x1e';
function git(dir, args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 << 20 }); }

/** "oracle/night-2026-11-12-retry" -> "2026-11-12" (the morning it was for), or '' if the name has no date. */
export function branchDate(name) { return (name.match(/night-(\d{4}-\d{2}-\d{2})/) || [])[1] || ''; }

function commits(dir, range, run) {
  return run(dir, ['log', `--format=%H${SEP}%s${SEP}%b${END}`, range]).split(END).map((x) => x.trim()).filter(Boolean)
    .map((x) => { const [sha, subject, body = ''] = x.split(SEP); return { sha, subject: subject.trim(), ports: [...`${subject} ${body}`.matchAll(/port of ([0-9a-f]{7,40})/gi)].map((m) => m[1].toLowerCase()) }; });
}

/** Unmerged night branches in one repo: [{ name, date, commits, waiting, newest }], oldest first. */
export function pendingNightBranches(dir, run = git) {
  const refs = run(dir, ['for-each-ref', `--format=%(refname:short)${SEP}%(committerdate:unix)`, 'refs/heads/oracle/night-*'])
    .split('\n').filter(Boolean).map((l) => { const [name, t] = l.split(SEP); return { name, t: Number(t) || 0 }; });
  const branches = refs.map((b) => ({ ...b, list: commits(dir, `main..${b.name}`, run) })).filter((b) => b.list.length);
  const mainSubjects = new Set(run(dir, ['log', '--format=%s', '-n', '500', 'main']).split('\n').map((s) => s.trim()).filter(Boolean));
  const newer = (o, b) => o.t > b.t || (o.t === b.t && o.name > b.name);
  const out = [];
  for (const b of branches) {
    const later = branches.filter((o) => o !== b && newer(o, b));
    const subjects = new Set(later.flatMap((o) => o.list.map((c) => c.subject)));
    const ports = later.flatMap((o) => o.list.flatMap((c) => c.ports));
    const waiting = b.list.filter((c) => !mainSubjects.has(c.subject) && !subjects.has(c.subject) && !ports.some((p) => c.sha.startsWith(p)));
    if (waiting.length) out.push({ name: b.name, date: branchDate(b.name), commits: b.list.length, waiting: waiting.length, newest: b.list[0].subject });
  }
  return out.sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || a.name.localeCompare(b.name));
}

/** Every repo's waiting night branches. A repo that can't be read reports its error instead of failing the rest. */
export function findPendingNightWork(repos = NIGHT_REPOS, run = git) {
  return repos.map((r) => { try { return { ...r, branches: pendingNightBranches(r.dir, run) }; } catch (e) { return { ...r, branches: [], error: e.message.split('\n')[0] }; } });
}

const md = (d) => (d ? `${Number(d.slice(5, 7))}/${d.slice(8, 10)}` : 'an undated night');

/** One plain briefing line, or '' when nothing is waiting. */
export function nightPendingLine(found) {
  const parts = found.filter((r) => r.branches.length).map((r) => {
    const n = r.branches.length, oldest = r.branches[0];
    return `${r.name} ${n} branch${n === 1 ? '' : 'es'} (oldest from ${md(oldest.date)})`;
  });
  if (!parts.length) return '';
  return `🧩 Night work waiting on your red pill: ${parts.join(', ')}. Ask me what's waiting for the list.`;
}

/** The on-screen list for "what night work is waiting?". */
export function formatPending(found) {
  const lines = ['# Night work waiting on Horace', ''];
  for (const r of found) {
    lines.push(`## ${r.name}`);
    if (r.error) lines.push(`(could not read: ${r.error})`);
    else if (!r.branches.length) lines.push('Nothing waiting.');
    for (const b of r.branches) lines.push(`- ${b.name}: ${b.waiting} of ${b.commits} commit${b.commits === 1 ? '' : 's'} not carried by a newer branch; newest "${b.newest}"`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
