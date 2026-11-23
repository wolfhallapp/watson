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

test('the night shift waits when the week is 80% used or the 5-hour meter is full', () => {
  const mem = () => { let v = {}; return { get: () => v, set: (x) => { v = { ...v, ...x }; } }; };
  const now = new Date('2026-11-04T04:00:00Z'); // 10 PM Central
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.4 } }, now, mem(), null), true);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.81 } }, now, mem(), null), false);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.79 } }, now, mem(), null), true); // 80% stop since 11/22 (Max)
  const soon = Date.now() + 3600000;
  assert.equal(usageAllowsNightShift({ five_hour: { utilization: 0.97, resetsAt: soon } }, now, mem(), null), false);
  assert.equal(usageAllowsNightShift({ five_hour: { utilization: 0.97, resetsAt: Date.now() - 1000 } }, now, mem(), null), true); // refilled
  assert.equal(usageAllowsNightShift({}, now, mem(), null), true);
});

test('the night shift uses at most 10% of the week per night (Max, 11/22)', () => {
  let v = {}; const store = { get: () => v, set: (x) => { v = { ...v, ...x }; } };
  const night = new Date('2026-11-05T03:00:00Z'); // 9 PM Wed Central
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.30 } }, night, store, null), true); // the night starts at 30%
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.39 } }, new Date('2026-11-05T08:00:00Z'), store, null), true);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.40 } }, new Date('2026-11-05T10:00:00Z'), store, null), false); // 4 AM: 10% used
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.40 } }, new Date('2026-11-06T03:00:00Z'), store, null), true); // next night starts over
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.02 } }, new Date('2026-11-06T05:00:00Z'), store, null), true); // the week reset mid-night
});

test('push window (11/22: "use all my weekly usage by Tues at 4pm"): no per-night cap, stops at 98%, ends on time', async () => {
  const { nightPush } = await import('../server/routines.js');
  let v = {}; const store = { get: () => v, set: (x) => { v = { ...v, ...x }; } };
  const push = { until: '2026-11-24T22:00:00Z', weekStop: 0.98 };
  const t = new Date('2026-11-23T15:00:00Z'); // 9 AM Monday: daytime
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.30 } }, t, store, push), true);
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.90 } }, t, store, push), true, 'far past 10% tonight and past 80%');
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.98 } }, t, store, push), false, 'stops at 98%');
  assert.equal(usageAllowsNightShift({ seven_day: { utilization: 0.5 }, five_hour: { utilization: 0.97, resetsAt: Date.now() + 3600000 } }, t, store, push), false, 'still waits for a full 5-hour window');
  assert.equal(nightPush(new Date('2099-01-01T00:00:00Z')), null, 'a past window is ignored');
});

test('the night shift repeats all night (9:15 PM to 6:30 AM Central), at least 3 minutes apart', () => {
  const r = { ...ROUTINES.find((x) => x.key === 'nightShift'), forceUntil: () => 0 }; // ignore a real data/night-now (11/22 push)
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

test('night shift prompt: helpers run in the foreground or are waited for (11/23, queue #20)', () => {
  const night = ROUTINES.find((r) => r.key === 'nightShift');
  assert.match(night.prompt, /foreground \(run_in_background: false\)/);
  assert.match(night.prompt, /never end with "waiting on" helpers/);
  assert.equal(night.checkHelpers, true);
});

test('a run that ends waiting on helpers is spotted; finished runs are not (11/23)', async () => {
  const { endedWaitingOnHelpers } = await import('../server/routines.js');
  for (const t of [
    // the real 02:57 cut-off, and the other "still waiting" lines from that night
    "Night Shift is on task 10, the security audit; three reviewers are reading the code and I'll check their findings when they report.",
    "Waiting on the three reviewers; I'll verify whatever they find before fixing anything.",
    'Scripts are written; waiting on the sample download to test them end to end.',
    'Agent Smith is still reviewing it.',
    'The build is still running in the background.',
    'Waiting for the subagents to finish.',
  ]) assert.ok(endedWaitingOnHelpers(t), t);
  for (const t of [
    'Night task #9 is done, sugar: Taylor\'s Ram now has its service schedule as v293 on a night branch. It passes its own test and Agent Smith\'s review, and it waits on Horace\'s red pill to deploy.',
    'Task #57 is finished, and it\'s not deployed: v298 is ready on branch oracle/night-2026-11-23-v294fu. Agent Smith\'s one catch is fixed, and deploy and merge wait for your red pill.',
    'Security audit done: fixed 7 holes as v294; Agent Smith passed it, and the deploy waits for your red pill plus 5 questions in the report.',
    'Jake\'s console polish (task #12) is built and committed as v296 on its own night branch, waiting on your red pill.',
    'Done; ask Horace about the culvert when they come back from Oklahoma.',
    '', null,
  ]) assert.equal(endedWaitingOnHelpers(t), false, String(t));
});

test('a cut-off run is logged in the morning report (11/23)', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { noteHelpersCutOff, nightReportDate } = await import('../server/routines.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-'));
  const at = new Date('2026-11-23T02:59:37Z'); // 8:59 PM Sunday Central -> the Monday report
  assert.equal(nightReportDate(at), '2026-11-23');
  assert.equal(nightReportDate(new Date('2026-11-23T04:00:00Z')), '2026-11-23'); // 10 PM: the same morning
  assert.equal(noteHelpersCutOff('Task #9 is done and waits on your red pill.', at, dir), null);
  assert.equal(fs.readdirSync(dir).length, 0, 'nothing written for a finished run');
  const f = noteHelpersCutOff("Three reviewers are reading the code and I'll check their findings when they report.", at, dir);
  const md = fs.readFileSync(f, 'utf8');
  assert.match(md, /^# Night Shift report, 2026-11-23/);
  assert.match(md, /## ⚠️ A run ended with helpers still working \(8:59 PM\)/);
  assert.match(md, /Three reviewers are reading the code/);
  noteHelpersCutOff('Waiting on Agent Smith.', at, dir); // appends, never overwrites
  assert.equal(fs.readFileSync(f, 'utf8').match(/## ⚠️/g).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the night agent passes its last words to the routine (11/23)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server/agent.js', import.meta.url), 'utf8');
  assert.match(src, /after\(ok, [^\n]*typeof m\.result === 'string' \? m\.result : ''\)/);
});
