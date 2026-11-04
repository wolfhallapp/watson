// Sends a message to the Oracle (or another agent) as if typed in the app.
// Usage (in WSL): node scripts/ask.mjs [--agent oracle] "message text"   or   --file path/to/message.md
import fs from 'node:fs';
import { WebSocket } from 'ws';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const agent = opt('--agent') || 'oracle';
const file = opt('--file');
const text = file ? fs.readFileSync(file, 'utf8') : args.join(' ');
if (!text.trim()) { console.log('Nothing to send.'); process.exit(1); }

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const token = env.match(/^WATSON_TOKEN=(.+)$/m)[1].trim();
const port = (env.match(/^WATSON_PORT=(\d+)$/m) || [, '8787'])[1];
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?agent=${agent}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
const timer = setTimeout(() => { console.log('No answer from the Oracle within 10 seconds.'); process.exit(1); }, 10000);
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token, clientId: 'claude-code' })));
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'auth_failed') { console.log('Refused:', m.reason); process.exit(1); }
  if (m.type !== 'welcome') return;
  clearTimeout(timer);
  if (m.status?.busy) console.log('Note: the agent is busy; the message is queued behind the current job.');
  ws.send(JSON.stringify({ type: 'ask', text }));
  console.log(`Sent ${text.length} characters to ${m.agent}.`);
  setTimeout(() => process.exit(0), 500);
});
