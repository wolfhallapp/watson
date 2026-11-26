// The Friday Walmart cart builder checks items against the LIVE weekly buckets (Wolf Hall v376, queue #83):
// /spend-today's categories, which count the Pool check's bank lines, and never this week's /week-budget (it writes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../server/agent.js', import.meta.url), 'utf8');

test('the Walmart order reads the live buckets from /spend-today, not this week of /week-budget', () => {
  const line = src.split('\n').find(l => l.startsWith('- Walmart order'));
  assert.ok(line, 'the Walmart order rule is in the prompt');
  assert.match(line, /LIVE weekly budget buckets \(wolf_hall GET \/spend-today, categories\[\]\.left/);
  assert.match(line, /never the current week of \/week-budget/);
  assert.match(line, /Horace logs in and checks out himself; never place an order\./);
});
