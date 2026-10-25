// Checks which tool calls the approval gate stops. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../server/approvals.js';
import { config } from '../server/config.js';

// The full gate (WATSON_TRUST=off); trust mode is tested at the bottom.
const full = (tool, input) => classify(tool, input, { trust: false });
const bash = (command) => full('Bash', { command });

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
  assert.equal(full('Edit', { file_path: `${config.projectDir}/index.html` }), null);
  assert.ok(full('Write', { file_path: '/home/horacehall/.bashrc' }));
  assert.ok(full('Write', { file_path: `${config.projectDir}/.git/config` }));
  assert.ok(full('Read', { file_path: '/home/horacehall/.wolfhall_deploy_env' }));
  assert.equal(full('Read', { file_path: `${config.projectDir}/CLAUDE.md` }), null);
});

test('connector reads pass, sends and edits ask', () => {
  assert.equal(full('mcp__claude_ai_Notion__notion-fetch', {}), null);
  assert.equal(full('mcp__claude_ai_Gmail__search_threads', {}), null);
  assert.equal(full('mcp__claude_ai_Google_Calendar__list_events', {}), null);
  assert.equal(full('mcp__claude_ai_Gmail__send_message', {}).level, 'high');
  assert.equal(full('mcp__claude_ai_Notion__notion-update-page', {}).level, 'medium');
  assert.ok(full('mcp__claude_ai_Google_Calendar__create_event', {}));
  assert.equal(full('mcp__watson__set_reminder', {}), null);
});

test('Wolf Hall reads that write to Notion need a yes', () => {
  const wh = (path) => full('mcp__watson__wolf_hall', { path });
  for (const p of ['/forecast', '/forecast?x=1', '/week-budget', '/week-budget?offset=0']) assert.ok(wh(p), `should ask: ${p}`);
  for (const p of ['/pool', '/upcoming', '/bills2', '/savings', '/week-budget?offset=-1', '/week-budget?offset=1', '/health']) assert.equal(wh(p), null, `should not ask: ${p}`);
  assert.ok(bash('curl -s -H "X-Worker-Key: k" https://wolf-hall.hall-horace.workers.dev/forecast'));
  assert.ok(bash('curl -s https://wolf-hall.hall-horace.workers.dev/week-budget?offset=0'));
  assert.ok(bash('curl -s https://wolf-hall.hall-horace.workers.dev/week-budget'));
  assert.equal(bash('curl -s https://wolf-hall.hall-horace.workers.dev/week-budget?offset=-1'), null);
  assert.equal(bash('curl -s https://wolf-hall.hall-horace.workers.dev/pool'), null);
});

test("Watson's other own tools run without asking", () => {
  for (const t of ['mcp__watson__search_past_conversations', 'mcp__watson__list_claude_memories', 'mcp__watson__remember']) assert.equal(full(t, {}), null);
});

test('trust mode only asks before sending to other people or deleting', () => {
  const t = (tool, input) => classify(tool, input, { trust: true });
  const tb = (command) => t('Bash', { command });
  for (const cmd of ['rm -rf _deploy_stage', 'git reset --hard HEAD~1', 'git checkout -- .', 'npx wrangler delete --name x', 'curl -X DELETE https://api.example.com/x', 'gh repo delete wolfhallapp/x'])
    assert.ok(tb(cmd), `should still ask: ${cmd}`);
  for (const cmd of ['npx wrangler deploy', 'git push origin main', 'npx netlify deploy --prod', 'curl -X POST https://wolf-hall.hall-horace.workers.dev/expense', 'cat .env'])
    assert.equal(tb(cmd), null, `should not ask: ${cmd}`);
  for (const tool of ['mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward', 'mcp__claude_ai_Gmail__trash_thread',
    'mcp__claude_ai_Notion__notion-delete-pages', 'mcp__claude_ai_Google_Drive__share_file', 'mcp__claude_ai_Google_Calendar__delete_event', 'mcp__claude_ai_Google_Calendar__respond_to_event'])
    assert.ok(t(tool, {}), `should still ask: ${tool}`);
  for (const tool of ['mcp__claude_ai_Notion__notion-update-page', 'mcp__claude_ai_Notion__notion-create-pages', 'mcp__claude_ai_Google_Calendar__create_event', 'mcp__claude_ai_Gmail__create_draft'])
    assert.equal(t(tool, {}), null, `should not ask: ${tool}`);
  assert.equal(t('Write', { file_path: '/home/horacehall/.bashrc' }), null);
  assert.equal(t('mcp__watson__wolf_hall', { path: '/forecast' }), null);
});
