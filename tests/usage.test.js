import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageLine } from '../server/agent.js';

test('usage line shows what a job used and where it leaves the session and week', () => {
  assert.equal(usageLine({ session: 18, week: 4 }, { session: 21, week: 5 }), 'Usage: session +3% (now 21%) · week +1% (now 5%)');
  assert.equal(usageLine({ session: 18, week: 4 }, { session: 18, week: 4 }), 'Usage: session +0% (now 18%) · week +0% (now 4%)');
});

test('a session that reset mid-job, or no starting reading, shows the level only', () => {
  assert.equal(usageLine({ session: 90, week: 40 }, { session: 2, week: 41 }), 'Usage: session now 2% · week +1% (now 41%)');
  assert.equal(usageLine(null, { session: 7, week: 3 }), 'Usage: session now 7% · week now 3%');
  assert.equal(usageLine(null, null), null);
});

test('the dollar estimate shows the size of a job too small to move the percent', () => {
  assert.equal(usageLine({ session: 18, week: 4 }, { session: 18, week: 4 }, 0.4213), 'Usage: session +0% (now 18%) · week +0% (now 4%) · $0.42 of work');
});
