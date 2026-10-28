// The Night Shift (2026-10-28): unattended routines can't deploy, push or write live, and it skips when usage is high.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unattendedBlock } from '../server/agent.js';
import { usageAllowsNightShift, ROUTINES, routineDue } from '../server/routines.js';

test('unattended runs cannot deploy, push or write live', () => {
  for (const c of ['npx wrangler deploy', 'npx netlify deploy --prod', 'git push origin main', 'git -C x push', 'curl -X POST https://w/pool -d {}', 'rm -rf ~/night', 'printf x | npx wrangler secret put K'])
    assert.ok(unattendedBlock('Bash', { command: c }), c);
  for (const c of ['node tests/v203-morning.mjs', 'git -C ~/projects/wolf-hall-app worktree add -B oracle/night-2026-10-29 ~/night/wolf-hall-app main', 'git commit -m x', 'curl -s -H "X-Worker-Key: k" https://w/upcoming'])
    assert.equal(unattendedBlock('Bash', { command: c }), null, c);
  assert.ok(unattendedBlock('mcp__claude_ai_Notion__notion-update-page', {}));
  assert.ok(unattendedBlock('mcp__claude_ai_Gmail__send_message', {}));
  assert.equal(unattendedBlock('mcp__claude_ai_Gmail__search_threads', {}), null);
  assert.ok(unattendedBlock('mcp__watson__morning', { action: 'save' }));
  assert.equal(unattendedBlock('mcp__watson__morning', { action: 'briefing' }), null);
  assert.ok(unattendedBlock('mcp__watson__casino', { action: 'claim' }));
  assert.equal(unattendedBlock('mcp__watson__casino', { action: 'add_offers' }), null);
});

test('the night shift skips when the weekly allowance is mostly used', () => {
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.4 } }), true);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.75 } }), false);
  assert.equal(usageAllowsNightShift({}), true);
});

test('the night shift runs 1-4 AM Central in its own session', () => {
  const r = ROUTINES.find((x) => x.key === 'nightShift');
  assert.equal(r.agent, 'night');
  assert.equal(routineDue(r, new Date('2026-10-29T06:30:00Z'), null), '2026-10-29'); // 1:30 AM CDT
  assert.equal(routineDue(r, new Date('2026-10-29T10:30:00Z'), null), null); // 5:30 AM
});
