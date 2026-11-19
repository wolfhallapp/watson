// Wolf Hall v246 (2026-11-18): the Oracle passes Jake's messages to Horace. Reading and marking
// seen run freely; a reply to Jake and adding to a House Project wait for Horace's yes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../server/approvals.js';
import { workerInboxWrite } from '../server/knowledge.js';

test('jake_inbox: list and seen run, reply and add_to_project need a yes, even in trust mode', () => {
  for (const trust of [false, true]) {
    assert.equal(classify('mcp__watson__jake_inbox', { action: 'list' }, { trust }), null);
    assert.equal(classify('mcp__watson__jake_inbox', { action: 'seen', id: 'x' }, { trust }), null);
    assert.equal(classify('mcp__watson__jake_inbox', { action: 'reply', id: 'x', text: 'ok' }, { trust })?.level, 'high');
    assert.equal(classify('mcp__watson__jake_inbox', { action: 'add_to_project' }, { trust })?.level, 'medium');
  }
});

test('the inbox write helper refuses every other path', async () => {
  await assert.rejects(workerInboxWrite('/pool', 'PATCH', {}), /Only/);
  await assert.rejects(workerInboxWrite('/inbox/11111111-1111-4111-8111-111111111111', 'POST', {}), /Only/);
  await assert.rejects(workerInboxWrite('/homestead/11111111-1111-4111-8111-111111111111', 'PATCH', {}), /Only/);
  await assert.rejects(workerInboxWrite('/bills/11111111-1111-4111-8111-111111111111/pay', 'POST', {}), /Only/);
});
