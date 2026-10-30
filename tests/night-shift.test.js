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

test('the night shift waits when the weekly allowance is mostly used or the 5-hour meter is full', () => {
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.4 } }), true);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.85 } }), false);
  const soon = Date.now() + 3600000;
  assert.equal(usageAllowsNightShift({ five_hour: { utilization: 0.97, resetsAt: soon } }), false);
  assert.equal(usageAllowsNightShift({ five_hour: { utilization: 0.97, resetsAt: Date.now() - 1000 } }), true); // refilled
  assert.equal(usageAllowsNightShift({}), true);
});

test('the night shift repeats all night (9:15 PM to 6:30 AM Central), at least 3 minutes apart', () => {
  const r = ROUTINES.find((x) => x.key === 'nightShift');
  assert.equal(r.agent, 'night');
  assert.ok(routineDue(r, new Date('2026-10-30T02:20:00Z'), null)); // 9:20 PM CDT
  assert.ok(routineDue(r, new Date('2026-10-30T06:30:00Z'), null)); // 1:30 AM
  assert.equal(routineDue(r, new Date('2026-10-30T11:40:00Z'), null), null); // 6:40 AM: done for the night
  assert.equal(routineDue(r, new Date('2026-10-29T20:00:00Z'), null), null); // 3 PM
  assert.equal(routineDue(r, new Date('2026-10-30T06:31:00Z'), '2026-10-30T06:30:00.000Z'), null); // too soon
  assert.ok(routineDue(r, new Date('2026-10-30T06:34:00Z'), '2026-10-30T06:30:00.000Z'));
});
