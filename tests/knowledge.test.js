// Checks memory loading and past-conversation search against a fake ~/.claude/projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeMemories, searchSessions, textOfEntry, workerGetWrites } from '../server/knowledge.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watson-know-'));
const mem = (proj, file, name, modified, body) => {
  fs.mkdirSync(path.join(root, proj, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(root, proj, 'memory', file), `---\nname: ${name}\ndescription: "about ${name}"\nmetadata:\n  type: project\n  modified: ${modified}\n---\n\n${body}\n`);
};
mem('a', 'x.md', 'pool', '2026-10-24T10:00:00Z', 'Pool is $1,144.');
mem('b', 'x.md', 'pool', '2026-10-24T10:00:00Z', 'Pool is $1,144.'); // synced copy
mem('b', 'y.md', 'rollover', '2026-10-25T10:00:00Z', 'Do not load this week.');
fs.writeFileSync(path.join(root, 'a', 'MEMORY.md'), '- index');
const line = (o) => JSON.stringify(o) + '\n';
fs.writeFileSync(path.join(root, 'a', 's1.jsonl'),
  line({ type: 'user', timestamp: '2026-10-23T10:00:00Z', message: { role: 'user', content: 'Where should Horace gas go?' } }) +
  line({ type: 'assistant', timestamp: '2026-10-23T10:01:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'grep gas' } }, { type: 'text', text: 'Gas logged by Horace now goes to Other.' }] } }) +
  line({ type: 'user', timestamp: '2026-10-23T10:02:00Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'gas gas gas' }] } }) +
  'not json\n');

test('memories are deduplicated and newest first', () => {
  const all = claudeMemories([root]);
  assert.deepEqual(all.map((m) => m.name), ['rollover', 'pool']);
  assert.equal(all[1].description, 'about pool');
  assert.equal(all[1].body, 'Pool is $1,144.');
});

test('search finds what was said, not tool output', async () => {
  const hits = await searchSessions('horace GAS', { roots: [root] });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.role).sort(), ['Claude', 'Horace']);
  assert.ok(hits.some((h) => h.snippet.includes('goes to Other')));
  assert.equal((await searchSessions('nothing-like-this', { roots: [root] })).length, 0);
  assert.equal((await searchSessions('gas', { roots: [root], skipSessionId: 's1' })).length, 0);
});

test('tool results and commands are not treated as conversation text', () => {
  assert.equal(textOfEntry({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), null);
  assert.equal(textOfEntry({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }), null);
});

test('only /forecast and this week of /week-budget count as writes', () => {
  assert.ok(workerGetWrites('/forecast'));
  assert.ok(workerGetWrites('/week-budget'));
  assert.ok(workerGetWrites('/week-budget?offset=0'));
  assert.equal(workerGetWrites('/week-budget?offset=-2'), null);
  assert.equal(workerGetWrites('/upcoming'), null);
});

test('when nothing said matches, search falls back to what the tools did', async () => {
  fs.appendFileSync(path.join(root, 'a', 's1.jsonl'),
    line({ type: 'assistant', timestamp: '2026-10-23T11:00:00Z', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/m/x.md', content: 'phantom rollover hazard' } }] } }));
  const hits = await searchSessions('phantom rollover', { roots: [root] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, 'Claude (tool)');
  assert.equal((await searchSessions('phantom rollover', { roots: [root], withTools: false })).length, 0);
});

test('knowledge folder: small text in full, other files by name, README skipped', async () => {
  const { knowledgeForPrompt, knowledgeFiles } = await import('../server/knowledge.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watson-kf-'));
  fs.writeFileSync(path.join(dir, 'README.md'), 'about the folder');
  fs.mkdirSync(path.join(dir, 'family'));
  fs.writeFileSync(path.join(dir, 'family', 'kids.md'), 'Soccer is on Tuesdays.');
  fs.writeFileSync(path.join(dir, 'manual.pdf'), Buffer.alloc(3000));
  assert.deepEqual(knowledgeFiles(dir).map((f) => f.rel), [path.join('family', 'kids.md'), 'manual.pdf']);
  const text = knowledgeForPrompt(15000, dir);
  assert.match(text, /Soccer is on Tuesdays/);
  assert.match(text, /manual\.pdf \(3 KB\)/);
  assert.doesNotMatch(text, /about the folder/);
  assert.equal(knowledgeForPrompt(15000, path.join(dir, 'nope')), '(empty)');
});
