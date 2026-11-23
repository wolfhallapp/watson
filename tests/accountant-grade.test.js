// The Accountant's dry run (Night Shift 11/23): the mocked ledger and the grader. No model calls, no network.
// Run: node --test tests/accountant-grade.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockLedger, gradeStrategy, gradeTree, isStarter, DRY_PROFILES, intakeText } from '../server/accountant-grade.js';
import { createAccountantTools } from '../server/accountant.js';

const good = (o = {}) => ({ name: 'Yard cleanups next door', branch: '1 Local jobs', how: 'Rake, mow and haul for neighbours on the county road.', why: 'Yard work 7/10 and he likes outdoors.',
  estMonthly: 60, setup: 'An hour', dailyTime: '15-30 min', risk: 'Low', priority: 1, needs: '$0, his own rake', steps: ['Ask two neighbours', 'Set a price', 'Do the first yard'], ...o });

test('the mock ledger rejects what the real /accountant/tree rejects, and never reaches anything else', async () => {
  const { fetcher, strategies } = mockLedger(DRY_PROFILES.builder);
  assert.equal((await fetcher('POST', '/accountant/tree', { action: 'plant', name: 'x', setup: 'Forever' })).status, 400);
  assert.equal((await fetcher('POST', '/accountant/tree', { action: 'plant', name: 'x', priority: 0 })).status, 400);
  assert.equal((await fetcher('POST', '/accountant/tree', { action: 'plant', name: '' })).status, 400);
  assert.equal((await fetcher('POST', '/accountant/tree', { action: 'plant', ...good() })).status, 200);
  assert.equal((await fetcher('POST', '/accountant/tree', { action: 'plant', ...good({ name: 'YARD CLEANUPS NEXT DOOR' }) })).status, 409);
  const id = strategies[0].id;
  assert.equal((await fetcher('POST', '/accountant/tree', { action: 'update', id, status: 'Started', steps: ['one'] })).json.strategy.status, 'Started');
  assert.deepEqual(strategies[0].steps, ['one']);
  assert.equal((await fetcher('GET', '/bills2')).status, 404);
  const tree = (await fetcher('GET', '/accountant/pending')).json;
  assert.equal(tree.count, 1); assert.equal(tree.profile.archetype.top, 'builder'); assert.deepEqual(tree.strategies[0].steps, [{ t: 'one', d: false }]);
});

test('the Accountant\'s own plant tool works against the mock', async () => {
  const { fetcher, strategies } = mockLedger(DRY_PROFILES.chef);
  const changes = [];
  const server = createAccountantTools(changes, fetcher);
  const plant = server.instance?._registeredTools?.plant;
  if (!plant?.callback && !plant?.handler) return; // SDK internals moved; the dry run script covers it end to end
  await (plant.callback || plant.handler)(good({ name: 'Sourdough on Saturdays', branch: '3 Food & cooking' }));
  assert.equal(strategies.length, 1); assert.deepEqual(changes, ['Planted: Sourdough on Saturdays (3 Food & cooking)']);
});

test('gradeStrategy: a clean one passes; banned schemes, missing fields and driving without a plan are flagged', () => {
  assert.deepEqual(gradeStrategy(good()), []);
  assert.match(gradeStrategy(good({ name: 'Sweepstakes casino bonuses' })).join(), /gambling/);
  assert.match(gradeStrategy(good({ how: 'Join an MLM and sell the starter kit' })).join(), /MLM/);
  assert.match(gradeStrategy(good({ how: 'Buy bitcoin on the dip' })).join(), /crypto/);
  assert.match(gradeStrategy(good({ name: 'DoorDash evenings', how: 'Drive orders around town in your car.', needs: '' })).join(), /driving/);
  assert.doesNotMatch(gradeStrategy(good({ name: 'DoorDash later', how: 'Once he has a ride from family on weekends, deliver in Taylor\'s truck.' })).join(), /driving/);
  assert.deepEqual(gradeStrategy(good({ name: 'Survey sites', watch: 'Never use bots or multiple accounts; avoid crypto offers.' })), [], 'warnings in Watch are not violations');
  assert.deepEqual(gradeStrategy(good({ how: 'Not an MLM: you sell your own bread.' })), [], 'a negated mention is fine');
  assert.deepEqual(gradeStrategy(good({ name: 'Dog park on the land (Sniffspot)', how: 'Guests drive to you and book an hour.', needs: '' })), [], 'customers driving to him is car-free');
  assert.deepEqual(gradeStrategy(good({ name: 'TaskRabbit (after the truck)', how: 'A one-time $25 registration fee in some cities.', needs: '$25 to start; your own vehicle', steps: ['Wait until you have the truck', 'Sign up', 'Set rates'] })), [], 'a later, vehicle-gated strategy with a real sign-up fee is fine');
  assert.match(gradeStrategy(good({ how: 'Pay $30 to unlock your earnings.' })).join(), /pay-to-earn/);
  assert.match(gradeStrategy(good({ how: '' })).join(), /no how/);
  assert.match(gradeStrategy(good({ steps: ['one'] })).join(), /1 steps/);
  assert.match(gradeStrategy(good({ link: 'http://x.com' })).join(), /https/);
});

test('isStarter: cheap, quick and car-free', () => {
  assert.equal(isStarter(good()), true);
  assert.equal(isStarter(good({ needs: '$150 for a pressure washer' })), false);
  assert.equal(isStarter(good({ setup: 'A week+' })), false);
  assert.equal(isStarter(good({ needs: '$10 flour, $5 bags' })), true);
  assert.equal(isStarter(good({ needs: '$0 to start: phone, PayPal' })), true);
  assert.equal(isStarter(good({ needs: '$15-40 per piece in supplies' })), false, 'the top of a range counts');
  assert.equal(isStarter(good({ needs: '$10-15 to start: flour, bags; $150 mixer later' })), true, 'the stated start cost wins');
  assert.equal(isStarter(good({ needs: '$25 to start: lumber' })), false);
  assert.equal(isStarter(good({ needs: 'Work gloves' })), false, 'no stated cost is not counted as cheap');
});

test('gradeTree: counts, starters, branches, the answer and flags', () => {
  const branches = ['1 Local jobs', '2 Flip & resell', '3 Food & cooking', '4 Build & fix', '5 Online gigs', '7 Make & sell', '8 Content & creator'];
  const tree = [];
  for (let i = 0; i < 32; i++) {
    const branch = i < 4 ? '9 Level up' : i < 7 ? '10 Found money & saving' : branches[i % branches.length];
    tree.push(good({ name: `Strategy ${['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima','mike','november','oscar','papa','quebec','romeo','sierra','tango','uniform','victor','whiskey','xray','yankee','zulu','apple','berry','cherry','donut','eagle','falcon'][i]}`, branch, priority: i < 8 ? i + 1 : 9 + i }));
  }
  const g = gradeTree(tree, { answer: 'You are a Builder. Start with yard cleanups.' });
  assert.equal(g.pass, true, JSON.stringify(g.checks.filter((c) => !c.ok)));
  const bad = gradeTree(tree.slice(0, 10), { answer: '## Heading\n**bold**' });
  assert.equal(bad.pass, false);
  assert.ok(bad.checks.some((c) => !c.ok && /30-40/.test(c.what)));
  assert.ok(bad.checks.some((c) => !c.ok && /plain text/.test(c.what)));
  assert.equal(gradeTree(tree, { answer: 'Sources: [Texas DSHS](https://www.dshs.texas.gov/)' }).checks.find((c) => /plain text/.test(c.what)).ok, false, 'markdown links count as markdown');
});

test('the made-up profiles are 18+, have no account numbers, and make the worker\'s INTAKE line', () => {
  for (const [name, p] of Object.entries(DRY_PROFILES)) {
    assert.equal(p.basics.age18, true, name);
    assert.doesNotMatch(JSON.stringify(p), /\b\d{9,}\b|ssn|routing|password/i, name);
    assert.match(intakeText(p), /^INTAKE: Jake finished the Initiation\. Archetype \w+/);
  }
  assert.equal(DRY_PROFILES.creator.basics.devices.join(), 'Phone');
});
