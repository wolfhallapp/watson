// Checks that Watson works through a public address (e.g. the phone tunnel):
// the page loads, bad logins are refused with a reason, the real token works,
// and phone pairing works end to end.
// Usage (in WSL):  node scripts/check-remote.mjs https://something.trycloudflare.com
import fs from 'node:fs';
import { WebSocket } from 'ws';

const base = process.argv[2];
if (!base) { console.error('Usage: node scripts/check-remote.mjs <https address>'); process.exit(2); }
const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const token = env.match(/^WATSON_TOKEN=(.+)$/m)[1].trim();
const port = (env.match(/^WATSON_PORT=(\d+)$/m) || [, '8787'])[1];

// Connects, sends a hello, and reports what happened. `then(ws, msg)` can keep the socket going.
function hello(siteBase, fields, then) {
  return new Promise((resolve) => {
    const ws = new WebSocket(siteBase.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws', { headers: { Origin: new URL(siteBase).origin } });
    let reason = '';
    const done = (result) => { clearTimeout(timer); ws.terminate(); resolve(result); };
    const timer = setTimeout(() => done('timeout'), 15000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', clientId: 'remote-check', ...fields })));
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'auth_failed') reason = m.reason;
      else if (then) { const r = then(ws, m); if (r !== undefined) done(r); }
      else if (m.type === 'welcome') done('welcome');
    });
    ws.on('close', (code) => done(`refused (${code}${reason ? `: ${reason}` : ''})`));
    ws.on('error', (e) => done(`error ${e.message}`));
  });
}

const page = await fetch(base);
console.log('Page:', page.status, (await page.text()).includes('<title>Watson</title>') ? '(Watson)' : '(unexpected content)');
console.log('Wrong token:', await hello(base, { token: 'x'.repeat(token.length) }));
console.log('Wrong capitalization:', await hello(base, { token: token.toUpperCase() === token ? token.toLowerCase() : token.toUpperCase() }));
console.log('Real token:', await hello(base, { token }));

// Pairing: the PC asks for a code, then the "phone" uses it through the tunnel.
const pairing = await hello(`http://127.0.0.1:${port}`, { token }, (ws, m) => {
  if (m.type === 'welcome') ws.send(JSON.stringify({ type: 'pair_start' }));
  if (m.type === 'pairing') return m;
});
console.log('Pairing code made on PC:', /^\d{6}$/.test(pairing.code) ? 'yes' : pairing, '| phone address shown:', pairing.phoneUrl);
const wrong = String((Number(pairing.code) + 1) % 1e6).padStart(6, '0');
console.log('Wrong code:', await hello(base, { pairCode: wrong }));
let gotToken = false;
console.log('Right code:', await hello(base, { pairCode: pairing.code }, (ws, m) => {
  if (m.type === 'paired') gotToken = m.token === token;
  if (m.type === 'welcome') return `welcome, phone received the token: ${gotToken}`;
}));
console.log('Same code again:', await hello(base, { pairCode: pairing.code }));
