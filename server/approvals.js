// The approval gate. Every tool call the Oracle makes is checked here; anything that
// deploys, pushes, sends, deletes or writes outside the project needs a spoken
// (or tapped) yes first, even if Claude Code's own settings would allow it.
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config } from './config.js';
import { workerGetWrites } from './knowledge.js';

// [pattern, level, plain-English reason, keep]. Checked against Bash commands.
// keep = still asks in trust mode (it deletes or discards something).
const BASH_RULES = [
  [/\bwrangler\b[^|;&]*\bdelete\b/, 'high', 'delete something on Cloudflare', true],
  [/\bwrangler\b(?![^|;&]*--dry-run)[^|;&]*\b(deploy|rollback|publish)\b/, 'high', 'deploy or change the live Cloudflare worker'],
  [/\bwrangler\b[^|;&]*\bsecret\b/, 'high', 'change a Cloudflare worker secret'],
  [/\bwrangler\b[^|;&]*\b(kv|r2|d1)\b[^|;&]*\b(put|delete|execute|create)\b/, 'high', 'change Cloudflare storage'],
  [/\bnetlify\b[^|;&]*\bdeploy\b/, 'high', 'deploy the site to Netlify'],
  [/\bgit\s+push\b/, 'high', 'push code to GitHub'],
  [/\bgit\s+(reset\s+--hard|clean\s+-\w*f|branch\s+-D|rebase|filter-branch|stash\s+(drop|clear))\b/, 'medium', 'discard or rewrite git history or changes', true],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'medium', 'discard uncommitted changes', true],
  [/\brm\s+-\w*[rR]/, 'high', 'delete files or folders', true],
  [/\bcurl\b[^|;&]*(-X\s*['"]?DELETE|--request\s+['"]?DELETE)/i, 'high', 'send a delete request', true],
  [/\bcurl\b[^|;&]*(-X\s*['"]?(POST|PUT|PATCH|DELETE)|--request\s+['"]?(POST|PUT|PATCH|DELETE)|\s(-d|--data[\w-]*|-F|--form|-T|--upload-file)(\s|=))/i, 'high', 'send data that can change something (a write request)'],
  [/\b(wget|http)\b[^|;&]*\b(--post|POST|PUT|PATCH|DELETE)\b/, 'high', 'send a write request'],
  // Two Wolf Hall GETs write to Notion: /forecast (Forecast Snapshot) and this week's /week-budget (rollover balances).
  [/\b(curl|wget|http|fetch)\b[^|;&]*workers\.dev\/(forecast|week-budget(?![^\s'"]*offset=(-\d|[1-9])))/, 'medium', 'load a Wolf Hall screen that writes to Notion (forecast snapshot or this week\'s rollover)'],
  [/\bsudo\b/, 'high', 'run a command as administrator'],
  [/\b(shutdown|reboot|mkfs|dd\s+if=)\b/, 'high', 'run a system-level command', true],
  [/\bgh\s+repo\s+delete\b/, 'high', 'delete a GitHub repo', true],
  [/\bnpm\s+publish\b/, 'high', 'publish a package'],
  [/\bgh\s+(pr\s+(create|merge|close)|release|repo\s+(create|delete|edit)|issue\s+(create|close|comment)|api\s+-X)/, 'medium', 'change something on GitHub'],
  [/\bclaude\s+mcp\s+(add|remove)\b/, 'medium', 'change Claude Code connectors'],
  [/(^|[\s>])[^\s]*\.env\b/, 'medium', 'touch a secrets (.env) file'],
];

// MCP tools (Notion, Gmail, Calendar, Drive...). Read-only verbs pass; the rest ask.
const MCP_HIGH = /(send|reply|forward|delete|trash|share|cancel|publish|spam|remove|stop)/i;
// In trust mode these still ask: anything that messages other people or deletes.
const MCP_KEEP = /(send|reply|forward|share|respond|delete|trash|remove|cancel)/i;
const MCP_WRITE = /(create|update|move|duplicate|upload|label|archive|restore|set|copy|apply|post|respond|edit|write|convert|spawn)/i;

const SCHEDULING_TOOLS = new Set(['CronCreate', 'CronDelete', 'RemoteTrigger', 'ScheduleWakeup']);
const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

function insideDir(file, dir) {
  const rel = path.relative(dir, path.resolve(dir, file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Returns null when the call is fine to run, or { level, reason } when it needs a yes.
 * Trust mode (WATSON_TRUST=on, Horace's choice 2026-10-25) only stops calls that
 * message other people or delete something; his spoken yes covers the rest.
 */
export function classify(toolName, input = {}, { trust = config.trust } = {}) {
  const risk = classifyAll(toolName, input);
  if (!risk || !trust) return risk;
  return risk.keep ? risk : null;
}

/** For tools Claude Code itself would ask about: null in trust mode unless it sends or deletes. */
export function trustAllows(toolName, input = {}) {
  if (!config.trust) return false;
  return classify(toolName, input) === null;
}

function classifyAll(toolName, input) {
  if (toolName === 'Bash') {
    const cmd = String(input.command || '');
    for (const [re, level, reason, keep] of BASH_RULES) if (re.test(cmd)) return { level, reason, keep: !!keep };
    return null;
  }
  if (FILE_TOOLS.has(toolName)) {
    const file = String(input.file_path || input.notebook_path || '');
    if (/(^|\/)\.git(\/|$)/.test(file) || /(^|\/)\.env$/.test(file)) return { level: 'high', reason: 'edit a git-internal or secrets file' };
    if (!insideDir(file, config.projectDir) && !insideDir(file, ROOT) && !insideDir(file, config.workshopDir)) return { level: 'medium', reason: 'write a file outside the project' };
    return null;
  }
  if (toolName === 'Read' && /(^|\/)(\.env|\.wolfhall_deploy_env|\.git-credentials)$/.test(String(input.file_path || ''))) {
    return { level: 'medium', reason: 'read a file that holds secrets' };
  }
  if (SCHEDULING_TOOLS.has(toolName)) return { level: 'medium', reason: 'schedule something to run later' };
  if (toolName === 'mcp__watson__wolf_hall') {
    const writes = workerGetWrites(String(input.path || '/'));
    return writes ? { level: 'medium', reason: writes } : null;
  }
  if (toolName.startsWith('mcp__') && !toolName.startsWith('mcp__watson__') && !toolName.startsWith('mcp__architect__') && !toolName.startsWith('mcp__trinity__') && !toolName.startsWith('mcp__morpheus__')) {
    const action = toolName.split('__').slice(2).join('__');
    if (MCP_HIGH.test(action)) return { level: 'high', reason: `use ${prettyTool(toolName)}, which sends or deletes something`, keep: MCP_KEEP.test(action) };
    if (MCP_WRITE.test(action)) return { level: 'medium', reason: `use ${prettyTool(toolName)}, which changes your data`, keep: MCP_KEEP.test(action) };
  }
  return null;
}

export function prettyTool(name) {
  if (!name.startsWith('mcp__')) return name;
  const [, server, ...rest] = name.split('__');
  const srv = server.replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return `${srv}: ${rest.join(' ').replace(/[-_]/g, ' ')}`;
}

/** One-line description of a tool call, for the activity feed and approval cards. */
export function describe(toolName, input = {}) {
  switch (toolName) {
    case 'Bash': return `Run: ${input.command}`;
    case 'Read': return `Read ${input.file_path}`;
    case 'Write': return `Write ${input.file_path}`;
    case 'Edit': return `Edit ${input.file_path}`;
    case 'Glob': return `Find files: ${input.pattern}`;
    case 'Grep': return `Search for "${input.pattern}"${input.path ? ` in ${input.path}` : ''}`;
    case 'WebSearch': return `Web search: ${input.query}`;
    case 'WebFetch': return `Open ${input.url}`;
    case 'Agent': case 'Task': return `Ask the ${input.subagent_type || 'helper'} agent: ${input.description || ''}`;
    case 'Skill': return `Use skill ${input.skill || input.command || ''}`;
    case 'TodoWrite': return 'Update the task list';
    default: {
      const args = JSON.stringify(input);
      return `${prettyTool(toolName)} ${args.length > 160 ? args.slice(0, 160) + '…' : args}`;
    }
  }
}

// ── Pending approvals ──
const pending = new Map();
let broadcast = () => {};
export function onApprovalEvent(fn) { broadcast = fn; }

/**
 * Ask the person. Resolves { approved, always } once someone answers from any
 * connected device, or { approved: false } after the timeout / abort.
 */
export function requestApproval({ toolName, input, level, reason, canAlways = false, signal, who = 'The Oracle' }) {
  const id = crypto.randomUUID();
  const info = {
    id, toolName, level, reason, canAlways, who,
    title: `${who} wants to ${reason}`,
    detail: describe(toolName, input),
    at: new Date().toISOString(),
  };
  return new Promise((resolve) => {
    const finish = (decision) => {
      if (!pending.has(id)) return;
      clearTimeout(pending.get(id).timer);
      pending.delete(id);
      broadcast({ type: 'approval_closed', id, approved: decision.approved });
      resolve(decision);
    };
    const timer = setTimeout(() => finish({ approved: false, timedOut: true }), config.approvalTimeoutMs);
    pending.set(id, { info, finish, timer });
    signal?.addEventListener('abort', () => finish({ approved: false }), { once: true });
    broadcast({ type: 'approval', ...info });
  });
}

export function answerApproval(id, approved, always = false) {
  const p = pending.get(id);
  if (!p) return false;
  p.finish({ approved: !!approved, always: !!always && p.info.canAlways });
  return true;
}

export function pendingApprovals() { return [...pending.values()].map((p) => p.info); }
/** Say no to everything still waiting, or only to what one agent asked (`who`, e.g. 'The Architect'). */
export function denyAllPending(who) { for (const p of [...pending.values()]) if (!who || p.info.who === who) p.finish({ approved: false }); }
