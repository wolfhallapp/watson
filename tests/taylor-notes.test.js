import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// v222 "Note to Neo": the morning briefing brings up Taylor's new notes, read-only.
const src = (f) => fs.readFileSync(new URL(`../server/${f}`, import.meta.url), 'utf8');

test('the 6:40 briefing routine reads new Taylor notes and labels them', () => {
  const r = src('routines.js');
  assert.match(r, /\/taylor\/notes\?status=Sent/);
  assert.match(r, /Taylor asked:/);
});

test('the Oracle knows the notes path and that it is read-only', () => {
  assert.match(src('agent.js'), /Notes from Taylor \(\/taylor\/notes\?status=Sent, read-only/);
  assert.match(src('tools.js'), /\/taylor\/notes\?status=Sent/);
});
