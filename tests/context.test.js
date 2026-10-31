// The guard against conversations growing too big (2026-10-30), and routines kept out of the Oracle's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WatsonAgent, ORACLE } from '../server/agent.js';
import { ROUTINES } from '../server/routines.js';
import { config } from '../server/config.js';
import { state } from '../server/store.js';

// A throwaway persona so the test never touches the real Oracle's saved session.
const TEST = { ...ORACLE, key: 'test', sessionKey: 'testGuardSessionId', tools: () => ({}) };
const reset = () => state.set({ testGuardSessionId: null, testGuardSessionIdTokens: null });

test('an oversized saved conversation is not resumed after a restart', () => {
  try {
    state.set({ testGuardSessionId: 'abc', testGuardSessionIdTokens: config.contextLimit + 1 });
    assert.equal(new WatsonAgent(() => {}, TEST).needsFresh, true);
    state.set({ testGuardSessionIdTokens: config.contextLimit - 1 });
    assert.equal(new WatsonAgent(() => {}, TEST).needsFresh, false);
  } finally { reset(); }
});

test('the limit is well below the 1M window', () => {
  assert.ok(config.contextLimit > 50000 && config.contextLimit <= 400000);
});

test('email-reading routines run in their own fresh conversation, not the Oracle\'s', () => {
  for (const key of ['morningBriefing', 'casinoOfferScan']) {
    const r = ROUTINES.find((x) => x.key === key);
    assert.equal(r.agent, 'routine', key);
    assert.equal(r.fresh, true, key);
  }
});
