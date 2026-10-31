// Prints Watson's live status: busy or idle, pending approvals, and the last few messages.
// Usage (in WSL):  node scripts/status.mjs [--interrupt]
// --interrupt does what the Stop button does: cancels the job Watson is stuck on.
import fs from 'node:fs';
import { WebSocket } from 'ws';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const token = env.match(/^WATSON_TOKEN=(.+)$/m)[1].trim();
const port = (env.match(/^WATSON_PORT=(\d+)$/m) || [, '8787'])[1];
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: `http://127.0.0.1:${port}` } });
const timer = setTimeout(() => { console.log('No answer from the Oracle within 10 seconds.'); process.exit(1); }, 10000);
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token, clientId: 'status-check' })));
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'auth_failed') { console.log('Refused:', m.reason); process.exit(1); }
  if (m.type !== 'welcome') return;
  clearTimeout(timer);
  console.log('Status:', JSON.stringify(m.status));
  console.log('Pending approvals:', m.approvals?.length ? '' : 'none');
  for (const a of m.approvals || []) console.log(`  - [${a.level}] ${a.title} | ${a.detail} (asked ${a.at})`);
  console.log('Last messages:');
  for (const h of (m.history || []).slice(-4)) console.log(`  ${h.at} ${h.role}: ${String(h.text).slice(0, 160)}`);
  if (process.argv.includes('--reset')) {
    ws.send(JSON.stringify({ type: 'reset' }));
    console.log('Sent New conversation.');
    setTimeout(() => { ws.terminate(); process.exit(0); }, 5000);
    return;
  }
  if (process.argv.includes('--interrupt')) {
    ws.send(JSON.stringify({ type: 'interrupt' }));
    console.log('Sent Stop.');
    setTimeout(() => { ws.terminate(); process.exit(0); }, 3000);
    return;
  }
  ws.terminate();
  process.exit(0);
});
