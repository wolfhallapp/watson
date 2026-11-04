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

test('the night shift waits when the week is 75% used or the 5-hour meter is full', () => {
  const mem = () => { let v = {}; return { get: () => v, set: (x) => { v = { ...v, ...x }; } }; };
  const now = new Date('2026-11-04T04:00:00Z'); // 10 PM Central
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.4 } }, now, mem()), true);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.76 } }, now, mem()), false);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.74 } }, now, mem()), true); // 75% stop since 11/4
  const soon = Date.now() + 3600000;
  assert.equal(usageAllowsNightShift({ five_hour: { utilization: 0.97, resetsAt: soon } }, now, mem()), false);
  assert.equal(usageAllowsNightShift({ five_hour: { utilization: 0.97, resetsAt: Date.now() - 1000 } }, now, mem()), true); // refilled
  assert.equal(usageAllowsNightShift({}, now, mem()), true);
});

test('the night shift uses at most 6% of the week per night', () => {
  let v = {}; const store = { get: () => v, set: (x) => { v = { ...v, ...x }; } };
  const night = new Date('2026-11-05T03:00:00Z'); // 9 PM Wed Central
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.30 } }, night, store), true); // the night starts at 30%
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.35 } }, new Date('2026-11-05T08:00:00Z'), store), true);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.36 } }, new Date('2026-11-05T10:00:00Z'), store), false); // 4 AM: 6% used
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.36 } }, new Date('2026-11-06T03:00:00Z'), store), true); // next night starts over
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.02 } }, new Date('2026-11-06T05:00:00Z'), store), true); // the week reset mid-night
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

test('the Night Shift can be started early with data/night-now (10/31)', () => {
  const night = ROUTINES.find((r) => r.key === 'nightShift');
  const noon = new Date('2026-10-31T17:00:00Z'); // noon CDT, outside the window
  assert.equal(routineDue({ ...night, forceUntil: () => 0 }, noon, null), null);
  assert.equal(routineDue({ ...night, forceUntil: () => noon.getTime() + 3600e3 }, noon, null), noon.toISOString());
});
