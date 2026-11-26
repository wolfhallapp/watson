// Sign-in watch for deploys (night shift 11/23, task #40). On 11/22 both Cloudflare (wrangler) and Netlify
// were signed out on the PC, which blocked a deploy until Horace signed in again. Once a day at 6 PM the
// Oracle runs `npx wrangler whoami` and `npx netlify status` in the app repo (through `bash -ic`, so the nvm
// PATH and the tokens in ~/.bashrc load exactly as they do for a deploy) and pushes Horace once if either
// says it is signed out. Code only: no AI call. It never logs in and never reads, prints or stores a token.
import { execFile } from 'node:child_process';
import { state } from './store.js';
import { config } from './config.js';
import { WORKER_URL, workerKey } from './knowledge.js';
import { windowsNotify } from './notify.js';

export const SIGNIN_CHECKS = [
  { name: 'Cloudflare', cmd: 'npx wrangler whoami' },
  { name: 'Netlify', cmd: 'npx netlify status' },
];

const OUT = /not (authenticated|logged in|signed in)|please (run )?`?(wrangler|netlify) login|unauthori[sz]ed|invalid (access |api )?token|authentication error|access token (is |may be )?(invalid|expired)|(session|token) (has )?expired|failed to refresh/i;
const IN = { Cloudflare: /you are logged in/i, Netlify: /current netlify user|^\s*email:/im };

/** 'in', 'out', or 'unknown' (a network or npx failure: never alarm on those). Colours are stripped first. */
export function signinState(name, output) {
  const t = String(output || '').replace(/\x1b\[[0-9;]*m/g, '');
  if (OUT.test(t)) return 'out';
  if (IN[name] && IN[name].test(t)) return 'in';
  return 'unknown';
}

/** Runs one check command in the app repo; resolves its combined output (never rejects). */
export function runCheck(cmd, { cwd = config.projectDir, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile('bash', ['-ic', cmd], { cwd, timeout, windowsHide: true, maxBuffer: 1 << 20, env: { ...process.env, NO_COLOR: '1', CI: '1' } },
      (err, stdout, stderr) => resolve(`${stdout || ''}\n${stderr || ''}${err && err.killed ? '\n(timed out)' : ''}`));
  });
}

export function signinMessage(out) {
  return `${out.join('/')} sign-in expired on the PC; run the login in a terminal before the next deploy.`;
}

/** POST /push/send to Horace's phones (the master key, the same route as scripts/notify-update.sh). */
export async function pushHorace(body, { fetchImpl = fetch, key = workerKey, title = 'Deploy sign-in' } = {}) {
  const r = await fetchImpl(WORKER_URL + '/push/send', {
    method: 'POST', headers: { 'X-Worker-Key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ person: 'Horace', title, body }), signal: AbortSignal.timeout(30000),
  });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok && !!j?.ok, sent: j?.sent || 0, error: j?.error || (r.ok ? null : `HTTP ${r.status}`) };
}

/**
 * The 6 PM check. Pushes once per sign-out: while the same services stay signed out it doesn't push again,
 * and once they are all signed in the next sign-out pushes afresh. If the push fails, a Windows notification.
 */
export async function checkSignins({ run = runCheck, push = pushHorace, toast = windowsNotify, store = state, now = new Date(), log = console } = {}) {
  const results = [];
  for (const c of SIGNIN_CHECKS) results.push({ name: c.name, state: signinState(c.name, await run(c.cmd)) });
  const out = results.filter((r) => r.state === 'out').map((r) => r.name);
  const prev = store.get().signinWatch || {};
  const summary = results.map((r) => `${r.name} ${r.state}`).join(', ');
  if (!out.length) {
    // Only an all-clear (no 'unknown') forgets the last alert, so a network blip never re-sends it.
    const clear = results.every((r) => r.state === 'in');
    store.set({ signinWatch: { checkedAt: now.toISOString(), alerted: clear ? [] : (prev.alerted || []), alertedAt: clear ? null : (prev.alertedAt || null) } });
    log.log(`  Sign-in watch: ${summary}`);
    return { results, out, pushed: false };
  }
  const already = (prev.alerted || []).slice().sort().join('/') === out.slice().sort().join('/');
  if (already) {
    store.set({ signinWatch: { ...prev, checkedAt: now.toISOString() } });
    log.log(`  Sign-in watch: ${summary} (already told Horace ${prev.alertedAt?.slice(0, 10) || ''})`);
    return { results, out, pushed: false, already: true };
  }
  const msg = signinMessage(out);
  let how = 'push';
  try {
    const r = await push(msg);
    if (!r.ok || !r.sent) throw new Error(r.error || 'no phones took it');
  } catch (e) {
    log.log(`  Sign-in watch: push failed (${e.message}); Windows notification instead`);
    how = (await toast(msg)) ? 'windows' : 'none';
  }
  if (how !== 'none') store.set({ signinWatch: { checkedAt: now.toISOString(), alerted: out, alertedAt: now.toISOString(), via: how } });
  log.log(`  Sign-in watch: ${summary}; told Horace by ${how}`);
  return { results, out, pushed: how !== 'none', via: how };
}
