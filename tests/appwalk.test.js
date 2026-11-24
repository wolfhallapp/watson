// The weekly app walk (Night Shift #86, 11/24): its read-only guard, schedule and self-found task queueing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appWalkBlock, readOnlyJs, queueWalkFindings, walkPrompt, APP_WALK_DIR, MAX_TASKS } from '../server/appwalk.js';
import { ROUTINES, routineDue } from '../server/routines.js';
import { APP_WALK } from '../server/agent.js';

const C = (t) => `mcp__claude-in-chrome__${t}`;

test('Chrome may only open the Wolf Hall site', () => {
  assert.equal(appWalkBlock(C('navigate'), { url: 'https://thriving-brigadeiros-fe0954.netlify.app/' }), null);
  assert.equal(appWalkBlock(C('navigate'), { url: 'https://thriving-brigadeiros-fe0954.netlify.app/#bills' }), null);
  assert.equal(appWalkBlock(C('navigate'), { url: 'back' }), null);
  for (const url of ['https://wolf-hall.hall-horace.workers.dev/pool', 'https://mail.google.com/', 'https://thriving-brigadeiros-fe0954.netlify.app.evil.com/', 'javascript:alert(1)', '']) {
    assert.match(appWalkBlock(C('navigate'), { url }), /only opens the Wolf Hall site/, url);
  }
});

test('Chrome: look, scroll and tap only; no typing, forms, uploads or drags', () => {
  for (const t of ['tabs_context_mcp', 'tabs_create_mcp', 'read_page', 'find', 'get_page_text', 'read_console_messages', 'read_network_requests']) assert.equal(appWalkBlock(C(t), {}), null, t);
  for (const action of ['screenshot', 'scroll', 'wait', 'left_click', 'hover']) assert.equal(appWalkBlock(C('computer'), { action }), null, action);
  for (const action of ['type', 'double_click', 'triple_click', 'right_click', 'left_click_drag']) assert.ok(appWalkBlock(C('computer'), { action }), action);
  assert.equal(appWalkBlock(C('computer'), { action: 'key', text: 'Escape' }), null);
  assert.equal(appWalkBlock(C('computer'), { action: 'key', text: 'PageDown PageDown' }), null);
  for (const text of ['Return', 'Enter', 'ctrl+a', 'Delete', 'Tab']) assert.ok(appWalkBlock(C('computer'), { action: 'key', text }), text);
  for (const t of ['form_input', 'upload_image', 'file_upload', 'shortcuts_execute', 'switch_browser', 'tabs_close_mcp']) assert.ok(appWalkBlock(C(t), {}), t);
});

test('page JavaScript only when it reads', () => {
  assert.equal(readOnlyJs("JSON.stringify(performance.getEntriesByType('navigation').map((e) => e.duration))"), true);
  assert.equal(readOnlyJs("document.querySelectorAll('.error').length === 0"), true);
  for (const bad of ["fetch('/pay', {method:'POST'})", "document.querySelector('#pay').click()", "localStorage.getItem('t')", 'x = 1', 'i++',
    "document.body.innerHTML = ''", "location.href = 'x'", "document.forms[0].submit()", "el.dispatchEvent(new Event('click'))", '']) {
    assert.equal(readOnlyJs(bad), false, bad);
  }
  assert.equal(appWalkBlock(C('javascript_tool'), { action: 'javascript_exec', text: 'performance.now()' }), null);
  assert.ok(appWalkBlock(C('javascript_tool'), { action: 'javascript_exec', text: "fetch('/x')" }));
});

test('everything else is refused: commands, email, Notion, money, the queue', () => {
  assert.equal(appWalkBlock('Bash', { command: 'date +%s.%N' }), null);
  for (const command of ['date; curl -X POST x', 'curl https://x', 'git status', 'date && rm x']) assert.ok(appWalkBlock('Bash', { command }), command);
  assert.equal(appWalkBlock('Write', { file_path: path.join(APP_WALK_DIR, '2026-11-29.md') }), null);
  assert.ok(appWalkBlock('Write', { file_path: path.join(APP_WALK_DIR, '..', 'night-queue.md') }));
  assert.ok(appWalkBlock('Edit', { file_path: '/home/horacehall/projects/wolf-hall-app/index.html' }));
  for (const t of ['mcp__watson__wolf_hall', 'mcp__watson__morning', 'mcp__watson__show_on_screen', 'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Notion__notion-update-page', 'Agent', 'WebFetch', 'NotebookEdit']) assert.ok(appWalkBlock(t, {}), t);
  for (const t of ['Read', 'Grep', 'ToolSearch', 'mcp__watson__now']) assert.equal(appWalkBlock(t, {}), null, t);
});

test('the app-walk persona has Chrome and the guard; other routines do not', () => {
  assert.equal(APP_WALK.chrome, true);
  assert.equal(APP_WALK.blockTool, appWalkBlock);
  assert.notEqual(APP_WALK.sessionKey, 'routineSessionId');
});

test('runs once on Sunday between 1 and 5 AM Central, before the Night Shift', () => {
  const r = ROUTINES.find((x) => x.key === 'appWalk');
  assert.equal(r.agent, 'appWalk');
  assert.ok(ROUTINES.indexOf(r) < ROUTINES.findIndex((x) => x.key === 'nightShift'));
  assert.equal(routineDue(r, new Date('2026-11-29T06:59:00Z'), null), null);           // Sun 12:59 AM CST
  assert.equal(routineDue(r, new Date('2026-11-29T07:05:00Z'), null), '2026-11-29');   // Sun 1:05 AM
  assert.equal(routineDue(r, new Date('2026-11-29T09:00:00Z'), '2026-11-29'), null);   // already walked
  assert.equal(routineDue(r, new Date('2026-11-29T11:00:00Z'), null), null);           // 5 AM: too late
  assert.equal(routineDue(r, new Date('2026-11-28T07:05:00Z'), null), null);           // Saturday
  assert.match(r.prompt(r.prepare('2026-11-29')), /2026-11-29\.json/);
});

test('the prompt is read-only and the briefing reads the walk line', () => {
  const p = walkPrompt('2026-11-29');
  assert.match(p, /READ ONLY/);
  assert.match(p, /do not try to sign in/);
  assert.match(p, /POST, PATCH, PUT or DELETE/);
  assert.match(ROUTINES.find((x) => x.key === 'morningBriefing').prompt, /🚶 App walk:/);
});

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'appwalk-')); }

test('top findings are queued as self-found tasks above the repeating task, no repeats', () => {
  const dir = tmp(), queue = path.join(dir, 'q.md');
  fs.writeFileSync(queue, '# Queue\n- [x] done thing\n- [ ] (only on or after 2026-12-15) later\n- [ ] (resumed) UI polish, one screen per night. Leave this task unchecked: it repeats. Note it.\n- [ ] after the repeating one\n');
  const findings = [
    { screen: 'Bills', kind: 'slow', what: 'took 6 s', task: 'Make the Bills screen load faster: it took 6 seconds to show data on 11/29.', worth: 3 },
    { screen: 'Home', kind: 'broken', what: 'blank card', task: 'Fix the blank Weather card on Home: it stays empty after load.', worth: 5 },
    { screen: 'Pets', kind: 'stale', what: 'old', task: 'too short', worth: 5 },
    { screen: 'Kids', kind: 'confusing', what: 'x', task: 'Explain the Kids spend line: it shows two different totals for the same month.', worth: 2 },
    { screen: 'Vault', kind: 'missing', what: 'y', task: 'Show the return-by date on each Vault item so Horace knows when a return window closes.', worth: 1 },
  ];
  fs.writeFileSync(path.join(dir, '2026-11-29.json'), JSON.stringify({ screens: 20, writesSeen: 0, findings }));
  const added = queueWalkFindings('2026-11-29', { dir, queue });
  assert.equal(added.length, MAX_TASKS);
  assert.match(added[0], /^- \[ \] \(self-found 2026-11-29, app walk: Home, broken\) Fix the blank Weather card/);
  assert.match(added[1], /Bills, slow/);
  assert.match(added[2], /Kids, confusing/);
  const rows = fs.readFileSync(queue, 'utf8').split('\n');
  const rep = rows.findIndex((l) => l.includes('it repeats'));
  assert.ok(rows.slice(0, rep).some((l) => l.includes('Weather card')), 'queued above the repeating task');
  assert.equal(rows[rows.length - 2], '- [ ] after the repeating one');
  assert.deepEqual(queueWalkFindings('2026-11-29', { dir, queue }).map((l) => /Vault/.test(l)), [true], 'a second pass only adds what is new');
  assert.equal(fs.readFileSync(queue, 'utf8').split('Weather card').length, 2);
});

test('no walk file, bad JSON or no queue line: nothing changes', () => {
  const dir = tmp(), queue = path.join(dir, 'q.md');
  fs.writeFileSync(queue, '- [ ] a\n');
  assert.deepEqual(queueWalkFindings('2026-11-29', { dir, queue }), []);
  fs.writeFileSync(path.join(dir, '2026-11-29.json'), '{not json');
  assert.deepEqual(queueWalkFindings('2026-11-29', { dir, queue }), []);
  fs.writeFileSync(path.join(dir, '2026-11-29.json'), JSON.stringify({ findings: [] }));
  assert.deepEqual(queueWalkFindings('2026-11-29', { dir, queue }), []);
  assert.equal(fs.readFileSync(queue, 'utf8'), '- [ ] a\n');
  fs.writeFileSync(path.join(dir, '2026-11-29.json'), JSON.stringify({ findings: [{ screen: 'Home', task: 'Fix the blank Weather card on Home: it stays empty.' }] }));
  queueWalkFindings('2026-11-29', { dir, queue });
  assert.match(fs.readFileSync(queue, 'utf8'), /^- \[ \] a\n- \[ \] \(self-found 2026-11-29, app walk: Home\) Fix the blank Weather card.*\n$/);
});
