// The app walk (Night Shift #86, 11/24; Horace 11/23: "take a more hands-on approach in my Chrome to learn more
// about itself and evolve"). Once a week the Oracle opens Wolf Hall in Horace's own Chrome (Claude in Chrome; he
// stays signed in), uses it the way he does, looks at every screen, times the slow ones and writes down what is
// broken, confusing, stale or missing. Code then turns up to MAX_TASKS findings into Night Shift tasks marked
// "self-found"; they are built on branches like any other task and still wait for his red pill.
//
// Guardrails, in code (appWalkBlock, the persona's blockTool, so they hold even if the prompt is ignored):
// - an allowlist of tools: reading files, the Chrome tools that look, scroll and click, writing only its own
//   notes folder, and `now`. Everything else (Bash beyond `date`, Gmail, Notion, Drive, wolf_hall, agents) is refused.
// - Chrome may only go to the Wolf Hall site. No typing, no form filling, no uploads, no drag, no double click.
//   Keys are limited to scrolling and Escape. Page JavaScript only when it reads (timings, text), never writes.
// - What a single click lands on can't be checked in code, so the prompt names the buttons to never tap and has it
//   read the page's network log after each screen: any POST/PATCH/PUT/DELETE is reported first thing.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { SITE_URL } from './uptime.js';

export const APP_WALK_DIR = path.join(DATA_DIR, 'app-walk');
export const MAX_TASKS = 3; // self-found tasks queued per walk, so a walk never floods the queue
const SITE = new URL(SITE_URL).origin;

const CHROME = /^mcp__(claude-in-chrome|Claude_in_Chrome)__(.+)$/;
// Chrome tools that only look (or open a tab, or plan): always fine.
const CHROME_LOOK = new Set(['tabs_context_mcp', 'tabs_context', 'tabs_create_mcp', 'tabs_create', 'read_page', 'find', 'get_page_text',
  'read_console_messages', 'read_network_requests', 'resize_window', 'update_plan', 'gif_creator']);
// computer actions: looking, scrolling, waiting and a single left click (to open a screen or tab).
const COMPUTER_OK = new Set(['screenshot', 'scroll', 'scroll_to', 'wait', 'hover', 'zoom', 'left_click']);
const KEYS_OK = /^(Escape|Esc|PageDown|PageUp|Page_Down|Page_Up|Home|End|ArrowUp|ArrowDown|Up|Down|space)$/i;
const OTHER_OK = new Set(['Read', 'Glob', 'Grep', 'ToolSearch', 'Skill', 'TodoWrite', 'mcp__watson__now']);

/** True when page JavaScript only reads (timings, text, counts). Anything that could write, send or navigate is refused. */
export function readOnlyJs(code) {
  const c = String(code || '');
  if (!c.trim() || c.length > 2000) return false;
  if (/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|caches|serviceWorker|cookie|postMessage|eval|Function|import|location|open|submit|click|dispatchEvent|requestSubmit|setAttribute|removeAttribute|append\w*|prepend|remove|insert\w*|replace\w*|write\w*|execCommand|focus|setTimeout|setInterval)\b/.test(c)) return false;
  // No assignments (=, +=, ++ ...); comparisons and arrows are fine.
  const noCompare = c.replace(/===|!==|==|!=|<=|>=|=>/g, '');
  return !/=|\+\+|--/.test(noCompare);
}

function onSite(url) {
  const u = String(url || '').trim();
  if (/^(back|forward)$/i.test(u)) return true;
  try { return new URL(u).origin === SITE; } catch { return false; }
}

/** Why the app walk may not use this tool this way, or null when it may. */
export function appWalkBlock(toolName, input = {}) {
  const m = CHROME.exec(toolName);
  if (m) {
    const t = m[2];
    if (CHROME_LOOK.has(t)) return null;
    if (t === 'navigate') return onSite(input.url) ? null : `the app walk only opens the Wolf Hall site (${SITE})`;
    if (t === 'computer') {
      const a = String(input.action || '');
      if (a === 'key') return String(input.text || '').split(/\s+/).every((k) => KEYS_OK.test(k)) ? null : 'the app walk only presses scrolling keys and Escape';
      return COMPUTER_OK.has(a) ? null : `the app walk only looks, scrolls and taps (no "${a}")`;
    }
    if (t === 'javascript_tool') return readOnlyJs(input.text ?? input.code) ? null : 'page JavaScript in the app walk may only read (timings, text)';
    return `the app walk may not use Chrome's ${t} (it could change something)`;
  }
  if (toolName === 'Write' || toolName === 'Edit') {
    const f = path.resolve(String(input.file_path || ''));
    return f.startsWith(APP_WALK_DIR + path.sep) ? null : 'the app walk writes only its own notes (data/app-walk)';
  }
  if (toolName === 'Bash') return /^\s*date(\s+[+\w%:.\-"' ]*)?\s*$/.test(String(input.command || '')) ? null : 'the app walk runs no commands except date';
  return OTHER_OK.has(toolName) ? null : `the app walk does not use ${toolName}`;
}

export function walkPrompt(day) {
  const notes = path.join(APP_WALK_DIR, `${day}.md`), json = path.join(APP_WALK_DIR, `${day}.json`);
  return [
    '[Oracle routine: the weekly app walk. Not from Horace; he is asleep. Work quietly: no show_on_screen; final reply one line.]',
    `Walk the Wolf Hall app in Horace's own Chrome (Claude in Chrome) the way he uses it, to learn how it really works and what to improve. Site: ${SITE_URL}`,
    'First load the Chrome tools (ToolSearch "claude-in-chrome"), get the tab context and open a NEW tab; never touch his other tabs.',
    'If the Chrome tools are missing, the extension is not connected, or the app shows its sign-in screen, do not try to sign in: write the notes file saying so and stop.',
    'READ ONLY. Never tap anything that saves, pays, logs, sends, deletes, submits, claims, marks done, collects, approves, orders or signs out',
    '(Pay, Save, Confirm, Log, Add, Delete, Remove, Submit, Send, Collected, Got It, Mark, Done, Approve, Order, Scan, Sign out, Reset, toggles and checkboxes).',
    'Tap only menu items, tabs, screen links, Back and Close. If a tap opens a form, look and close it with Escape or Close. Typing is blocked anyway.',
    'Go through every screen on the home menu (and its tabs). For each: take a screenshot and look at it, note how long it took to show its data',
    '(Bash `date +%s.%N` before and after, or performance timings with read-only page JavaScript), and read the console for errors.',
    'After each screen, read the network requests: any POST, PATCH, PUT or DELETE the walk caused is the first line of the notes, with the screen and the tap.',
    'Note what is broken (errors, blank or stuck sections, wrong totals that contradict each other on screen), slow (over 3 seconds), confusing, stale (old dates, last week\'s data) or missing.',
    'Facts only: describe what you saw; never guess a cause you did not see. Money numbers are just compared on screen, never changed.',
    `Write ${notes}: its FIRST line starts "🚶 App walk:" with the screens walked, the slowest one and its time, and the count of problems, in one plain sentence;`,
    'then a short markdown section per screen (load time, console errors, what you noticed).',
    `Then write ${json} as {"screens": <number walked>, "writesSeen": <number of write requests seen>, "findings": [{"screen", "kind" (broken|slow|confusing|stale|missing), "what" (one sentence of what you saw), "task" (a Night Shift task, written clearly enough to do alone, one or two sentences), "worth" (1-5)}]}.`,
    'Put the most useful findings first. Skip anything that needs a money decision or an answer only Horace has. Code queues the best few as Night Shift tasks; do not edit the queue yourself.',
    `Then reply with one line: screens walked and findings found for ${day}.`,
  ].join(' ');
}

/**
 * After a walk: turn its top findings into "self-found" Night Shift tasks. They go just above the repeating
 * UI-polish task (which stays unchecked forever, so anything below it would never be picked), or at the end.
 * Skips findings already queued (same task text). Returns the lines added.
 */
export function queueWalkFindings(day, { dir = APP_WALK_DIR, queue, max = MAX_TASKS } = {}) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(dir, `${day}.json`), 'utf8')); } catch { return []; }
  const text = (() => { try { return fs.readFileSync(queue, 'utf8'); } catch { return ''; } })();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const found = (Array.isArray(data?.findings) ? data.findings : [])
    .filter((f) => clean(f?.task).length >= 20)
    .map((f, i) => ({ ...f, i, worth: Number(f.worth) || 0 }))
    .sort((a, b) => b.worth - a.worth || a.i - b.i);
  const lines = [];
  for (const f of found) {
    if (lines.length >= max) break;
    const task = clean(f.task).slice(0, 600);
    if (text.includes(task) || lines.some((l) => l.includes(task))) continue;
    const label = [clean(f.screen), clean(f.kind)].filter(Boolean).join(', ');
    lines.push(`- [ ] (self-found ${day}, app walk${label ? `: ${label}` : ''}) ${task} On oracle/next. Tests, agent-smith, report. Deploy waits for red pill.`);
  }
  if (!lines.length) return [];
  const rows = text.split('\n');
  const at = rows.findIndex((l) => /^- \[ \].*Leave this task unchecked: it repeats/.test(l));
  if (at >= 0) rows.splice(at, 0, ...lines);
  else { if (rows.length && rows[rows.length - 1] === '') rows.pop(); rows.push(...lines, ''); }
  fs.writeFileSync(queue, rows.join('\n'));
  return lines;
}
