// The 6 PM sign-in watch for deploys (night shift 11/23). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signinState, signinMessage, checkSignins, pushHorace } from '../server/signin-watch.js';
import { ROUTINES, routineDue } from '../server/routines.js';

// Real outputs (11/23, signed in), with ids replaced, and the known signed-out wordings.
const WRANGLER_IN = '⛅️ wrangler 4.120.0\nGetting User settings...\n👋 You are logged in with an User API Token, associated with the email someone@example.com.\n│ Account │ 0123456789abcdef0123456789abcdef │';
const NETLIFY_IN = ' Current Netlify User │\n\x1b[32mName: \x1b[39m Someone\n\x1b[32mEmail: \x1b[39msomeone@example.com\nProject Id:      0fad959a-6c2f-4e2b-8d29-401b64730919';
const WRANGLER_OUT = 'Getting User settings...\nYou are not authenticated. Please run `wrangler login`.';
const WRANGLER_BADTOKEN = '✘ [ERROR] A request to the Cloudflare API (/memberships) failed.\n  Invalid access token [code: 9109]';
const NETLIFY_OUT = 'Not logged in. Please log in to see project status.\nLogin with netlify login command';
const NETLIFY_BADTOKEN = 'JSONHTTPError: Unauthorized';
const NETWORK = 'npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed\n(timed out)';

function fakeStore(init = {}) { let s = { ...init }; return { get: () => s, set: (p) => { s = { ...s, ...p }; } }; }
const quiet = { log() {} };
const runner = (w, n) => async (cmd) => (cmd.includes('wrangler') ? w : n);

test('reads signed in, signed out and unknown from the real wordings', () => {
  assert.equal(signinState('Cloudflare', WRANGLER_IN), 'in');
  assert.equal(signinState('Netlify', NETLIFY_IN), 'in'); // colour codes stripped; a "401" inside an id is not an error
  assert.equal(signinState('Cloudflare', WRANGLER_OUT), 'out');
  assert.equal(signinState('Cloudflare', WRANGLER_BADTOKEN), 'out');
  assert.equal(signinState('Netlify', NETLIFY_OUT), 'out');
  assert.equal(signinState('Netlify', NETLIFY_BADTOKEN), 'out');
  assert.equal(signinState('Cloudflare', NETWORK), 'unknown'); // never alarm on a network or npx failure
  assert.equal(signinState('Netlify', ''), 'unknown');
});

test('both signed in: no push', async () => {
  const sent = [];
  const r = await checkSignins({ run: runner(WRANGLER_IN, NETLIFY_IN), push: async (m) => { sent.push(m); return { ok: true, sent: 1 }; }, store: fakeStore(), log: quiet });
  assert.deepEqual(r.out, []);
  assert.equal(sent.length, 0);
});

test('one signed out: one push with the exact wording, then not again while it stays out', async () => {
  const store = fakeStore(), sent = [];
  const push = async (m) => { sent.push(m); return { ok: true, sent: 1 }; };
  const r = await checkSignins({ run: runner(WRANGLER_OUT, NETLIFY_IN), push, store, log: quiet });
  assert.equal(r.pushed, true);
  assert.deepEqual(sent, ['Cloudflare sign-in expired on the PC; run the login in a terminal before the next deploy.']);
  await checkSignins({ run: runner(WRANGLER_OUT, NETLIFY_IN), push, store, log: quiet }); // next day, still out
  assert.equal(sent.length, 1);
  await checkSignins({ run: runner(WRANGLER_OUT, NETWORK), push, store, log: quiet }); // Netlify unknown: still the same sign-out
  assert.equal(sent.length, 1);
  await checkSignins({ run: runner(WRANGLER_IN, NETWORK), push, store, log: quiet }); // not a full all-clear: remembered
  await checkSignins({ run: runner(WRANGLER_OUT, NETLIFY_IN), push, store, log: quiet });
  assert.equal(sent.length, 1);
  await checkSignins({ run: runner(WRANGLER_IN, NETLIFY_IN), push, store, log: quiet }); // signed in again
  await checkSignins({ run: runner(WRANGLER_OUT, NETLIFY_IN), push, store, log: quiet }); // a new sign-out pushes afresh
  assert.equal(sent.length, 2);
});

test('both signed out: one combined push; a newly added sign-out pushes again', async () => {
  const store = fakeStore(), sent = [];
  const push = async (m) => { sent.push(m); return { ok: true, sent: 2 }; };
  await checkSignins({ run: runner(WRANGLER_IN, NETLIFY_OUT), push, store, log: quiet });
  await checkSignins({ run: runner(WRANGLER_BADTOKEN, NETLIFY_OUT), push, store, log: quiet });
  assert.deepEqual(sent, [signinMessage(['Netlify']), 'Cloudflare/Netlify sign-in expired on the PC; run the login in a terminal before the next deploy.']);
});

test('a failed push falls back to a Windows notification; if both fail it tries again next time', async () => {
  const store = fakeStore(), toasts = [];
  const r = await checkSignins({ run: runner(WRANGLER_OUT, NETLIFY_IN), push: async () => ({ ok: true, sent: 0 }), toast: async (m) => { toasts.push(m); return true; }, store, log: quiet });
  assert.equal(r.via, 'windows');
  assert.equal(toasts.length, 1);
  const s2 = fakeStore();
  const r2 = await checkSignins({ run: runner(WRANGLER_OUT, NETLIFY_IN), push: async () => { throw new Error('offline'); }, toast: async () => false, store: s2, log: quiet });
  assert.equal(r2.pushed, false);
  assert.deepEqual(s2.get().signinWatch, undefined); // nothing remembered, so tomorrow it tries again
});

test('pushHorace sends only Horace one notice on /push/send with the master key', async () => {
  let call;
  const fetchImpl = async (url, opt) => { call = { url, opt }; return { ok: true, status: 200, json: async () => ({ ok: true, person: 'Horace', sent: 1 }) }; };
  const r = await pushHorace('hello', { fetchImpl, key: () => 'k' });
  assert.equal(r.ok, true);
  assert.match(call.url, /\/push\/send$/);
  assert.equal(call.opt.method, 'POST');
  assert.equal(call.opt.headers['X-Worker-Key'], 'k');
  assert.deepEqual(JSON.parse(call.opt.body), { person: 'Horace', title: 'Deploy sign-in', body: 'hello' });
});

test('the watch is a code-only routine at 6 PM Central, once a day', () => {
  const r = ROUTINES.find((x) => x.key === 'signinWatch');
  assert.ok(r && typeof r.run === 'function' && !r.agent && !r.prompt);
  assert.equal(routineDue(r, new Date('2026-11-23T23:59:00Z'), null), null);              // 5:59 PM CST
  assert.equal(routineDue(r, new Date('2026-11-24T00:00:00Z'), null), '2026-11-23');      // 6 PM CST
  assert.equal(routineDue(r, new Date('2026-11-24T02:00:00Z'), '2026-11-23'), null);      // already ran today
  assert.equal(routineDue(r, new Date('2026-11-24T05:30:00Z'), null), null);              // 11:30 PM: too late
});
