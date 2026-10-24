// What Watson knows beyond its own notes: the Claude Code memory folders, a
// snapshot of the project repo, past Claude Code conversations (searchable),
// and read-only access to the live Wolf Hall worker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { ROOT, config } from './config.js';

// Claude Code keeps memory and transcripts per working folder, in WSL and on
// the Windows side (sessions started from the desktop app or PowerShell).
export const CLAUDE_PROJECT_ROOTS = [
  path.join(os.homedir(), '.claude', 'projects'),
  '/mnt/c/Users/Owner/.claude/projects',
];

function listDirs(root) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name)); } catch { return []; }
}

/** Every Claude Code memory file, deduplicated by content (the WSL folders are kept in sync, so most repeat). */
export function claudeMemories(roots = CLAUDE_PROJECT_ROOTS) {
  const seen = new Map(); // body -> entry
  for (const root of roots) {
    for (const dir of listDirs(root)) {
      const memDir = path.join(dir, 'memory');
      let files;
      try { files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md'); } catch { continue; }
      for (const f of files) {
        let raw;
        try { raw = fs.readFileSync(path.join(memDir, f), 'utf8'); } catch { continue; }
        const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
        const meta = fm ? fm[1] : '';
        const body = (fm ? raw.slice(fm[0].length) : raw).trim();
        const field = (k) => (meta.match(new RegExp(`^\\s*${k}:\\s*"?(.*?)"?\\s*$`, 'm')) || [])[1] || '';
        const modified = field('modified');
        const prev = seen.get(body);
        if (prev && prev.modified >= modified) continue;
        seen.set(body, { name: field('name') || f.replace(/\.md$/, ''), description: field('description'), type: field('type'), modified, body, file: path.join(memDir, f) });
      }
    }
  }
  return [...seen.values()].sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
}

/** Memories as prompt text, newest first, capped so the prompt stays small. */
export function memoriesForPrompt(maxChars = 20000) {
  let out = '';
  for (const m of claudeMemories()) {
    const block = `### ${m.name}${m.modified ? ` (saved ${m.modified.slice(0, 10)})` : ''}\n${m.description ? `${m.description}\n` : ''}${m.body}\n\n`;
    if (out.length + block.length > maxChars) { out += `(More memory files exist; read them under ${CLAUDE_PROJECT_ROOTS[0]}/*/memory.)\n`; break; }
    out += block;
  }
  return out.trim() || '(none)';
}

const git = (...args) => {
  try { return execFileSync('git', args, { cwd: config.projectDir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};

/** Branch, recent commits, uncommitted files and the newest PROGRESS.md entry. */
export function projectSnapshot() {
  const parts = [];
  const branch = git('status', '-sb').split('\n')[0];
  if (branch) parts.push(`Git: ${branch.replace(/^## /, '')}`);
  const log = git('log', '--oneline', '-5');
  if (log) parts.push(`Recent commits:\n${log}`);
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean);
  if (dirty.length) parts.push(`Uncommitted: ${dirty.length} file(s) (${dirty.slice(0, 6).map((l) => l.slice(3)).join(', ')}${dirty.length > 6 ? ', …' : ''})`);
  try {
    const progress = fs.readFileSync(path.join(config.projectDir, 'PROGRESS.md'), 'utf8');
    const first = progress.split(/\n(?=## )/).find((s) => s.startsWith('## '));
    if (first) parts.push(`Newest PROGRESS.md entry:\n${first.trim().slice(0, 3000)}`);
  } catch {}
  return parts.join('\n\n') || '(the project folder could not be read)';
}

// ── Past conversations ──

function transcriptFiles(roots) {
  const files = [];
  for (const root of roots) {
    for (const dir of listDirs(root)) {
      let names;
      try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const n of names) {
        const file = path.join(dir, n);
        try { files.push({ file, project: path.basename(dir), mtime: fs.statSync(file).mtimeMs }); } catch {}
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

const blockText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : '')).join('\n') : '');

/**
 * The readable text of one transcript line: what the person said, what Claude
 * said, and summaries. With `withTools`, also what Claude's tools did (commands,
 * file writes, results), which is where many details live.
 */
export function textOfEntry(e, withTools = false) {
  if (e.type === 'summary' && e.summary) return { role: 'summary', text: e.summary };
  const msg = e.message;
  if (!msg || (e.type !== 'user' && e.type !== 'assistant')) return null;
  let text = '';
  if (typeof msg.content === 'string') text = msg.content;
  else if (Array.isArray(msg.content)) text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  text = text.trim();
  if (text.startsWith('<command-') || text.startsWith('<local-command') || text.startsWith('<system-reminder>')) text = '';
  if (text) return { role: e.type === 'user' ? 'Horace' : 'Claude', text };
  if (!withTools || !Array.isArray(msg.content)) return null;
  const tools = msg.content.map((b) => {
    if (b.type === 'tool_use') return `${b.name}: ${typeof b.input === 'object' ? Object.values(b.input || {}).filter((v) => typeof v === 'string').join('\n') : ''}`;
    if (b.type === 'tool_result') return blockText(b.content);
    return '';
  }).join('\n').trim();
  return tools ? { role: e.type === 'user' ? 'tool result' : 'Claude (tool)', text: tools } : null;
}

/**
 * Search past Claude Code conversations. Every word in `query` must appear
 * (case-insensitive). Newest conversations first.
 */
export async function searchSessions(query, { limit = 12, roots = CLAUDE_PROJECT_ROOTS, skipSessionId = null, withTools = 'fallback' } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  if (withTools === 'fallback') {
    const said = await searchSessions(query, { limit, roots, skipSessionId, withTools: false });
    return said.length ? said : searchSessions(query, { limit, roots, skipSessionId, withTools: true });
  }
  const hits = [];
  for (const { file, project } of transcriptFiles(roots)) {
    if (skipSessionId && path.basename(file, '.jsonl') === skipSessionId) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line || line.length > 2_000_000) continue;
      if (line.startsWith('{"type":"api-request-blob"') || line.includes('"type":"attachment"') && !line.includes('"message"')) continue; // copies of prompts, not conversation
      const lower = line.toLowerCase();
      if (!words.every((w) => lower.includes(w))) continue; // cheap prefilter before parsing
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const t = textOfEntry(e, withTools);
      if (!t) continue;
      const tl = t.text.toLowerCase();
      if (!words.every((w) => tl.includes(w))) continue;
      const at = tl.indexOf(words[0]);
      const start = Math.max(0, at - 250);
      const snippet = (start ? '…' : '') + t.text.slice(start, start + 700).replace(/\s+/g, ' ') + (start + 700 < t.text.length ? '…' : '');
      hits.push({ when: e.timestamp || '', project, role: t.role, snippet });
      if (hits.length >= limit) { rl.close(); break; }
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

// ── Live Wolf Hall worker, read-only ──

export const WORKER_URL = 'https://wolf-hall.hall-horace.workers.dev';

/**
 * Which GET paths change data on the server. These still work but need
 * Horace's yes (see approvals.js). Every other worker GET only reads.
 */
export function workerGetWrites(p) {
  const u = new URL(p, WORKER_URL);
  if (u.pathname === '/forecast') return 'refresh the Forecast Snapshot page in Notion (GET /forecast writes it)';
  if (u.pathname === '/week-budget' && parseInt(u.searchParams.get('offset') || '0', 10) === 0) {
    return "load this week's budget, which writes rollover balances to Notion (GET /week-budget with offset 0)";
  }
  return null;
}

/** The app's own key, read from the repo each call so it never goes stale. */
export function workerKey() {
  const html = fs.readFileSync(path.join(config.projectDir, 'index.html'), 'utf8');
  const m = html.match(/const WORKER_KEY = '([^']+)'/);
  if (!m) throw new Error('Could not find WORKER_KEY in the repo index.html');
  return m[1];
}

export async function workerGet(p) {
  if (!/^\/[\w\-/.]*(\?[\w\-=&%.]*)?$/.test(p)) throw new Error('Give a path like /pool or /upcoming?days=14');
  const r = await fetch(WORKER_URL + p, { method: 'GET', headers: { 'X-Worker-Key': workerKey() }, signal: AbortSignal.timeout(30000) });
  const body = await r.text();
  return { status: r.status, body };
}

// ── The knowledge folder: files Horace adds (here or on GitHub) that Watson should know ──

export const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');
const TEXT_EXT = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);

/** Every file under knowledge/ except its README. Text files include their contents. */
export function knowledgeFiles(dir = KNOWLEDGE_DIR) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const rel = path.relative(dir, full);
      if (rel === 'README.md') continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      const isText = TEXT_EXT.has(path.extname(e.name).toLowerCase()) && st.size <= 200_000;
      out.push({ rel, file: full, mtime: st.mtimeMs, size: st.size, text: isText ? fs.readFileSync(full, 'utf8') : null });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

/** Knowledge files as prompt text: small text files in full, the rest by name (read them when needed). */
export function knowledgeForPrompt(maxChars = 15000, dir = KNOWLEDGE_DIR) {
  const files = knowledgeFiles(dir);
  if (!files.length) return '(empty)';
  let out = '';
  const later = [];
  for (const f of files) {
    const block = f.text != null ? `### ${f.rel}\n${f.text.trim()}\n\n` : null;
    if (block && out.length + block.length <= maxChars) out += block;
    else later.push(`- ${f.rel} (${kb(f.size)}): read it with the Read tool when it's relevant`);
  }
  return (out + (later.length ? `Other files in ${dir}:\n${later.join('\n')}` : '')).trim();
}

/** Fingerprint of the memory files and the knowledge folder, to notice changes mid-conversation. */
export function knowledgeSignature() {
  const sig = new Map();
  for (const m of claudeMemories()) sig.set(`memory:${m.name}`, m.modified + '|' + m.body.length);
  for (const f of knowledgeFiles()) sig.set(`knowledge:${f.rel}`, String(f.mtime));
  return sig;
}

/** What was added or changed since `seen` (a signature), as text to hand the agent, or ''. */
export function changesSince(seen) {
  const now = knowledgeSignature();
  const changed = [...now.keys()].filter((k) => seen.get(k) !== now.get(k));
  if (!changed.length) return { text: '', now };
  const mems = new Map(claudeMemories().map((m) => [`memory:${m.name}`, m]));
  const files = new Map(knowledgeFiles().map((f) => [`knowledge:${f.rel}`, f]));
  const parts = changed.map((k) => {
    if (mems.has(k)) { const m = mems.get(k); return `Claude Code memory "${m.name}": ${m.description}\n${m.body}`; }
    const f = files.get(k);
    return f.text != null && f.text.length <= 8000 ? `Knowledge file ${f.rel}:\n${f.text.trim()}` : `Knowledge file ${f.rel} (${kb(f.size)}) was added or changed; read ${f.file} if it's relevant.`;
  });
  return { text: parts.join('\n\n'), now };
}
