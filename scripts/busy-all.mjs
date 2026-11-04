// Prints whether each agent is busy right now (used before a restart).
// Usage (in WSL): node scripts/busy-all.mjs
import fs from 'node:fs';
import { WebSocket } from 'ws';
const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const token = env.match(/^WATSON_TOKEN=(.+)$/m)[1].trim();
const port = (env.match(/^WATSON_PORT=(\d+)$/m) || [, '8787'])[1];
const one = (agent) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?agent=${agent}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
  const t = setTimeout(() => { ws.terminate(); resolve(`${agent}: no answer`); }, 8000);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token, clientId: 'busy-check' })));
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'welcome') { clearTimeout(t); ws.close(); resolve(`${m.agent}: ${m.status?.busy ? 'BUSY' : 'idle'}`); } });
  ws.on('error', () => { clearTimeout(t); resolve(`${agent}: error`); });
});
for (const a of process.argv.slice(2).length ? process.argv.slice(2) : ['oracle', 'architect', 'trinity', 'morpheus']) console.log(await one(a));
process.exit(0);
