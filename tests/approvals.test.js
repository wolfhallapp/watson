// Checks which tool calls the approval gate stops. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../server/approvals.js';
import { config } from '../server/config.js';

const bash = (command) => classify('Bash', { command });

test('risky shell commands need a yes', () => {
  for (const cmd of [
    'npx wrangler deploy',
    'npx wrangler rollback',
    'echo -n "x" | npx wrangler secret put CLAUDE_KEY',
    'npx netlify deploy --prod',
    'git push origin main',
    'git reset --hard HEAD~1',
    'rm -rf _deploy_stage',
    'curl -X POST https://wolf-hall.hall-horace.workers.dev/pay',
    'curl -s -H "X-Worker-Key: k" -d \'{"a":1}\' https://wolf-hall.hall-horace.workers.dev/expense',
    'sudo apt install cloudflared',
    'cat .env',
  ]) assert.ok(bash(cmd), `should ask: ${cmd}`);
});

test('everyday commands run without asking', () => {
  for (const cmd of [
    'git status',
    'git diff --stat',
    'node --check cloudflare-worker.js',
    'npx wrangler deploy --dry-run',
    'npx wrangler versions list --name wolf-hall',
    'curl -s https://wolf-hall.hall-horace.workers.dev/health',
    'grep -n "WORKER_VERSION" cloudflare-worker.js',
    'git commit -m "v198: fix"',
    'ls -la',
  ]) assert.equal(bash(cmd), null, `should not ask: ${cmd}`);
});

test('file writes inside the project are fine, outside are not', () => {
  assert.equal(classify('Edit', { file_path: `${config.projectDir}/index.html` }), null);
  assert.ok(classify('Write', { file_path: '/home/horacehall/.bashrc' }));
  assert.ok(classify('Write', { file_path: `${config.projectDir}/.git/config` }));
  assert.ok(classify('Read', { file_path: '/home/horacehall/.wolfhall_deploy_env' }));
  assert.equal(classify('Read', { file_path: `${config.projectDir}/CLAUDE.md` }), null);
});

test('connector reads pass, sends and edits ask', () => {
  assert.equal(classify('mcp__claude_ai_Notion__notion-fetch', {}), null);
  assert.equal(classify('mcp__claude_ai_Gmail__search_threads', {}), null);
  assert.equal(classify('mcp__claude_ai_Google_Calendar__list_events', {}), null);
  assert.equal(classify('mcp__claude_ai_Gmail__send_message', {}).level, 'high');
  assert.equal(classify('mcp__claude_ai_Notion__notion-update-page', {}).level, 'medium');
  assert.ok(classify('mcp__claude_ai_Google_Calendar__create_event', {}));
  assert.equal(classify('mcp__watson__set_reminder', {}), null);
});

test('Wolf Hall reads that write to Notion need a yes', () => {
  const wh = (path) => classify('mcp__watson__wolf_hall', { path });
  for (const p of ['/forecast', '/forecast?x=1', '/week-budget', '/week-budget?offset=0']) assert.ok(wh(p), `should ask: ${p}`);
  for (const p of ['/pool', '/upcoming', '/bills2', '/savings', '/week-budget?offset=-1', '/week-budget?offset=1', '/health']) assert.equal(wh(p), null, `should not ask: ${p}`);
  assert.ok(bash('curl -s -H "X-Worker-Key: k" https://wolf-hall.hall-horace.workers.dev/forecast'));
  assert.ok(bash('curl -s https://wolf-hall.hall-horace.workers.dev/week-budget?offset=0'));
  assert.ok(bash('curl -s https://wolf-hall.hall-horace.workers.dev/week-budget'));
  assert.equal(bash('curl -s https://wolf-hall.hall-horace.workers.dev/week-budget?offset=-1'), null);
  assert.equal(bash('curl -s https://wolf-hall.hall-horace.workers.dev/pool'), null);
});

test("Watson's other own tools run without asking", () => {
  for (const t of ['mcp__watson__search_past_conversations', 'mcp__watson__list_claude_memories', 'mcp__watson__remember']) assert.equal(classify(t, {}), null);
});
