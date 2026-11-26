// The ticker's budget read is unattended (every 30 minutes), so it must use Wolf Hall's read-only peek
// (v436) and never the plain current-week /week-budget, which closes finished weeks into Leftover in Notion.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the ticker reads this week with peek=1', async () => {
  const { TICKER_BUDGET_PATH } = await import('../server/hub.js');
  const u = new URL('https://x' + TICKER_BUDGET_PATH);
  assert.equal(u.pathname, '/week-budget');
  assert.equal(u.searchParams.get('offset'), '0');
  assert.equal(u.searchParams.get('peek'), '1');
});

test('no server code reads the current week of /week-budget without peek=1', () => {
  const dir = path.join(root, 'server');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/['"`](\/week-budget\?[^'"`]*)['"`]/g)) {
      const q = new URL('https://x' + m[1]).searchParams;
      if ((q.get('offset') || '0') === '0' && q.get('peek') !== '1') bad.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});
