// The Construct Hub (2026-10-29): plain-words logging, XP that never goes down, ranks, streaks, déjà vu, achievements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.MORPHEUS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
const H = await import('../server/hub.js');
const file = path.join(process.env.MORPHEUS_DIR, 'log.json');
const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00-05:00`); // CDT

test('parses dictation into quests', () => {
  const k = (t, h = '08:00') => H.parse(t, at('2026-11-02', h)).map((x) => `${x.kind}:${x.status}${x.count > 1 ? 'x' + x.count : ''}`);
  assert.deepEqual(k('showered and brushed, took my meds'), ['shower:done', 'brush:done', 'meds:done']);
  assert.deepEqual(k('moved 5'), ['move:done']);
  assert.deepEqual(k('moved five twice'), ['move:donex2']);
  assert.deepEqual(k('showered but missed the night check'), ['shower:done', 'nightcheck:missed']);
  assert.deepEqual(k('dodged buying a pack'), ['dodge:done']);
  assert.deepEqual(k('had eggs and bacon', '12:30').map((x) => x.split(':')[0]), ['lunch']);
  assert.deepEqual(k('clocked out'), ['clockout:done']);
  assert.deepEqual(k('kind of brushed'), ['brush:partly']);
  assert.deepEqual(k('hello there'), []);
});

test('XP, slots and no double counting', () => {
  const d = '2026-11-02'; // a Monday
  let r = H.logMessage('showered and brushed', { now: at(d, '07:50'), file });
  assert.equal(r.state.xp, 40);
  assert.match(r.reply, /^\+40 XP\./);
  assert.ok(r.achievements.includes('Wake up, Neo'));
  r = H.logMessage('showered', { now: at(d, '21:50'), file });
  assert.ok(r.added.some((e) => e.habit === 'shower2'));
  r = H.logMessage('moved 5', { now: at(d, '09:35'), file });
  r = H.logMessage('moved 5', { now: at(d, '11:05'), file });
  assert.deepEqual(r.state.quests.filter((q) => q.id.startsWith('move') && q.status === 'done').map((q) => q.id), ['move1', 'move2']);
  r = H.logMessage('brushed', { now: at(d, '08:00'), file });
  assert.equal(r.added.length, 0);
  assert.match(r.reply, /already logged/);
  r = H.logMessage('missed the night check', { now: at(d, '20:30'), file });
  assert.equal(r.added[0].xp, 0);
  assert.match(r.reply, /data, not a loss/);
  const before = r.state.xp;
  r = H.logMessage('night check done', { now: at(d, '20:45'), file });
  assert.equal(r.state.xp, before + 30, 'a later "done" still earns full XP plus the night-check bonus');
});

test('perfect day, streak combo, rank and achievements; XP never drops', () => {
  const f2 = path.join(process.env.MORPHEUS_DIR, 'log2.json');
  const all = 'water, brushed, meds, showered, moved 5 four times, lunch, clocked out, dinner, night check, showered, wind down, lights out';
  let r = H.logMessage(all, { now: at('2026-11-04', '23:00'), file: f2 }); // Wed
  const day1 = r.state.xp;
  assert.ok(r.state.quests.every((q) => q.status === 'done'), JSON.stringify(r.state.quests.filter((q) => q.status !== 'done')));
  assert.match(r.reply, /Perfect day! Streak 1/);
  assert.ok(r.achievements.includes('There is no spoon'));
  assert.equal(day1, 15 * 20 + 10 + 60);
  r = H.logMessage(all, { now: at('2026-11-05', '23:00'), file: f2 }); // Thu
  assert.equal(r.state.xp, day1 * 2 + 10, 'day 2 of a streak earns +10 combo');
  r = H.logMessage('brushed', { now: at('2026-11-06', '08:00'), file: f2 });
  assert.ok(r.state.xp >= day1 * 2 + 10);
  assert.equal(r.state.rank, 'Redpill'); // 370 + 380 + 20 = 770 >= 750
  assert.equal(r.state.streak, 2);
});

test('déjà vu: a quest missed two days running comes back with a bonus', () => {
  const f3 = path.join(process.env.MORPHEUS_DIR, 'log3.json');
  H.logMessage('brushed', { now: at('2026-11-02', '08:00'), file: f3 });
  H.logMessage('brushed', { now: at('2026-11-04', '08:00'), file: f3 });
  const s = H.hubState({ now: at('2026-11-04', '09:00'), file: f3 });
  assert.ok(s.quests.find((q) => q.id === 'shower1').dejaVu);
  const r = H.logMessage('showered', { now: at('2026-11-04', '09:10'), file: f3 });
  assert.equal(r.added[0].xp, 30);
  assert.match(r.added[0].note, /Déjà vu/);
});

test('no randomness anywhere in the game code (Morpheus guardrail)', () => {
  const src = fs.readFileSync(new URL('../server/hub.js', import.meta.url), 'utf8');
  assert.equal(/Math\.random/.test(src), false);
});

test('tapping a quest logs exactly that quest', () => {
  const f4 = path.join(process.env.MORPHEUS_DIR, 'log4.json');
  const r = H.logMessage('tap', { now: at('2026-11-02', '22:00'), file: f4, quest: 'shower1' });
  assert.equal(r.added[0].habit, 'shower1');
  assert.equal(H.logMessage('tap', { now: at('2026-11-02', '22:01'), file: f4, quest: 'nope' }).added.length, 0);
});

// ── Phase 3: weekly boss fights (2026-10-30) ──
const atc = (iso, hhmm) => new Date(`${iso}T${hhmm}:00-06:00`); // CST, after Nov 1
const wk = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']; // Mon..Sun
const boss = (r, id) => r.state.bosses.find((b) => b.id === id);

test('impulse buys are noted gently; "no impulse buys" is a dodge', () => {
  const k = (t) => H.parse(t, atc('2026-11-02', '12:00')).map((x) => `${x.kind}:${x.status}`);
  assert.deepEqual(k('bought a pack'), ['impulse:missed']);
  assert.deepEqual(k('I caved'), ['impulse:missed']);
  assert.deepEqual(k('no impulse buys today'), ['dodge:done']);
  const f = path.join(process.env.MORPHEUS_DIR, 'imp.json');
  const r = H.logMessage('bought a pack', { now: atc('2026-11-02', '12:00'), file: f });
  assert.equal(r.added[0].habit, 'impulse');
  assert.equal(r.state.xp, 0);
  assert.match(r.reply, /data, not a loss/);
});

test('Agent Smith week: 7 clean days wins +150 XP and The Keymaker, kept forever', () => {
  const f = path.join(process.env.MORPHEUS_DIR, 'smith.json');
  let r;
  for (const d of wk.slice(0, 6)) r = H.logMessage('brushed', { now: atc(d, '09:00'), file: f, funMoneyOver: false });
  assert.equal(boss(r, 'smith').done, 6);
  assert.equal(boss(r, 'smith').target, 7);
  assert.equal(boss(r, 'smith').state, 'fighting');
  const xpBefore = r.state.xp;
  r = H.logMessage('dodged buying a pack', { now: atc(wk[6], '09:00'), file: f, funMoneyOver: false });
  assert.deepEqual(r.bosses, ['Agent Smith week']);
  assert.match(r.reply, /Boss down: Agent Smith week\. \+150 XP/);
  assert.ok(r.achievements.includes('The Keymaker'));
  assert.equal(r.state.xp, xpBefore + 20 + 150);
  assert.equal(boss(r, 'smith').state, 'won');
  const won = r.state.xp;
  r = H.logMessage('bought a pack', { now: atc(wk[6], '20:00'), file: f, funMoneyOver: true });
  assert.equal(r.state.xp, won, 'a later slip never takes the boss XP back');
  assert.equal(boss(r, 'smith').state, 'won');
  r = H.logMessage('brushed', { now: atc(wk[6], '21:00'), file: f });
  assert.equal(r.bosses.length, 0, 'paid once per week');
});

test('Agent Smith: Fun Money overspent holds the last blow; a slip means next week', () => {
  const f = path.join(process.env.MORPHEUS_DIR, 'smith2.json');
  let r;
  for (const d of wk) r = H.logMessage('brushed', { now: atc(d, '09:00'), file: f, funMoneyOver: true });
  assert.equal(r.bosses.length, 0);
  assert.match(boss(r, 'smith').note, /Fun Money/);
  r = H.logMessage('meds', { now: atc(wk[6], '10:00'), file: f, funMoneyOver: false });
  assert.deepEqual(r.bosses, ['Agent Smith week']);
  const f2 = path.join(process.env.MORPHEUS_DIR, 'smith3.json');
  H.logMessage('brushed', { now: atc(wk[0], '09:00'), file: f2 });
  H.logMessage('bought a pack', { now: atc(wk[1], '09:00'), file: f2 });
  r = H.logMessage('brushed', { now: atc(wk[2], '09:00'), file: f2 });
  assert.equal(boss(r, 'smith').state, 'slipped');
  assert.match(boss(r, 'smith').note, /data/);
  assert.doesNotMatch(JSON.stringify(r.state.bosses), /fail|lost|lose/i, 'gentle copy');
});

test('Sentinel swarm: all four moves on each workday (Tuesday is off)', () => {
  const f = path.join(process.env.MORPHEUS_DIR, 'sent.json');
  let r;
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-05']) r = H.logMessage('moved 5 four times', { now: atc(d, '15:00'), file: f });
  const b = boss(r, 'sentinels');
  assert.equal(b.target, 4);
  assert.equal(b.done, 3);
  assert.equal(b.days.find((x) => x.dow === 'Tue').status, 'off');
  r = H.logMessage('moved 5 twice', { now: atc('2026-11-06', '11:00'), file: f });
  assert.equal(r.bosses.length, 0);
  r = H.logMessage('moved 5 twice', { now: atc('2026-11-06', '15:00'), file: f });
  assert.ok(r.bosses.includes('Sentinel swarm'));
});

test('The Merovingian: lights out on time every night; late is data and waits for Monday', () => {
  const f = path.join(process.env.MORPHEUS_DIR, 'mero.json');
  let r;
  for (const d of wk) r = H.logMessage('lights out', { now: atc(d, d === wk[0] ? '21:10' : '22:40'), file: f });
  assert.ok(r.bosses.includes('The Merovingian'));
  const f2 = path.join(process.env.MORPHEUS_DIR, 'mero2.json');
  H.logMessage('lights out', { now: atc(wk[0], '21:00'), file: f2 });
  r = H.logMessage('lights out', { now: atc(wk[1], '23:30'), file: f2 });
  assert.equal(boss(r, 'merovingian').state, 'slipped');
});

test('difficulty scales with rank: at Neo a perfect day needs an extra move', () => {
  assert.ok(!H.questsFor('2026-11-04').some((q) => q.id === 'move5'));
  assert.ok(H.questsFor('2026-11-04', 'Neo').some((q) => q.id === 'move5'));
  assert.ok(H.questsFor('2026-11-07', 'The One').some((q) => q.id === 'move3'));
  assert.ok(H.questsFor('2026-11-03', 'Neo').some((q) => q.id === 'move1'));
  const f = path.join(process.env.MORPHEUS_DIR, 'neo.json');
  fs.writeFileSync(f, JSON.stringify({ entries: [{ date: '2026-11-03', time: '12:00', habit: 'seed', status: 'done', xp: 8000 }], achievements: {} }));
  const all = 'water, brushed, meds, showered, moved 5 four times, lunch, clocked out, dinner, night check, showered, wind down, lights out';
  let r = H.logMessage(all, { now: atc('2026-11-04', '23:00'), file: f });
  assert.ok(r.state.hard);
  assert.equal(r.state.quests.find((q) => q.id === 'move5').status === 'done', false);
  assert.doesNotMatch(r.reply, /Perfect day/);
  r = H.logMessage('moved 5', { now: atc('2026-11-04', '23:05'), file: f });
  assert.match(r.reply, /Perfect day/);
  assert.equal(H.hubState({ now: atc('2026-11-04', '23:10'), file: f }).quests.length, 16);
});
