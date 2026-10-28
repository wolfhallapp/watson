// Watson server: serves the voice web app and relays it to the agent over a
// token-protected WebSocket. Listens on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { DATA_DIR, ROOT, config } from './config.js';
import { WatsonAgent, NIGHT } from './agent.js';
import { answerApproval, onApprovalEvent, pendingApprovals } from './approvals.js';
import { startReminderLoop } from './tools.js';
import { history, reminders, state } from './store.js';
import { listVoices, synthesize, ttsEnabled } from './tts.js';
import { windowsNotify } from './notify.js';
import { startRoutines } from './routines.js';
import { ARCHITECT, construct, noteScreenEdit } from './architect.js';
import { workerGet, workerPostMorning } from './knowledge.js';
import { TRINITY } from './trinity.js';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self)',
};

const json = (res, status, body) => res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));

// ElevenLabs speech: GET /tts/voices and POST /tts { text, voice, speed } -> audio/mpeg.
async function handleTts(req, res, url) {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ip = clientIp(req);
  if (lockedOut(ip) || !tokenOk(auth)) { noteFailure(ip, 'speech request with a bad token'); json(res, 401, { error: 'bad token' }); return; }
  if (req.method === 'GET' && url.pathname === '/tts/voices') {
    if (!ttsEnabled()) { json(res, 200, { enabled: false, voices: [] }); return; }
    try { json(res, 200, { enabled: true, defaultVoice: config.tts.voiceId, voices: await listVoices() }); }
    catch (e) { json(res, 200, { enabled: true, defaultVoice: config.tts.voiceId, voices: [], error: e.message }); }
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/tts') { json(res, 404, { error: 'not found' }); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 8192) { json(res, 413, { error: 'too long' }); return; } }
  let msg;
  try { msg = JSON.parse(body); } catch { json(res, 400, { error: 'bad json' }); return; }
  const text = String(msg.text || '').trim().slice(0, 1000);
  if (!text) { json(res, 400, { error: 'no text' }); return; }
  try {
    const r = await synthesize(text, msg.voice, msg.speed);
    if (!r.ok) { console.warn('  TTS:', r.error); json(res, r.status, { error: r.error }); return; }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }).end(r.audio);
  } catch (e) {
    console.warn('  TTS:', e.message);
    json(res, 502, { error: e.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/tts' || url.pathname.startsWith('/tts/')) { handleTts(req, res, url).catch(() => res.destroy()); return; }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, SECURITY_HEADERS).end('Not found');
    return;
  }
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

// ── Clients: one channel per agent (the Oracle at /ws, the Architect at /ws?agent=architect) ──
const channels = {
  oracle: { key: 'oracle', clients: new Set(), screens: [] }, // screens: last few show_on_screen items, replayed to new screens
  architect: { key: 'architect', clients: new Set(), screens: [] },
  trinity: { key: 'trinity', clients: new Set(), screens: [] },
};
function broadcastTo(ch, event) {
  if (event.type === 'screen') { ch.screens.push(event); if (ch.screens.length > 8) ch.screens.shift(); }
  const data = JSON.stringify(event);
  for (const ws of ch.clients) if (ws.readyState === ws.OPEN) ws.send(data);
}
const allClients = () => channels.oracle.clients.size + channels.architect.clients.size + channels.trinity.clients.size;
const otherOf = (key) => (key === 'oracle' ? 'architect' : 'oracle');

// Each agent's page also hears, in short, what the other is doing: "working" and "has a reply", so
// Horace knows to switch back when he's on the other page. Quiet routines don't ring.
const lastSay = {}; // agent -> { at, text } of its newest reply (seeded from its history after a restart)
function lastSayOf(key) {
  if (!(key in lastSay)) {
    const h = channels[key].agent.history.recent(40).filter((m) => m.role === 'watson').pop();
    lastSay[key] = h ? { at: h.at, text: String(h.text).slice(0, 280) } : null;
  }
  return lastSay[key];
}
// The account's usage windows (five_hour, seven_day) as Claude last reported them to either agent.
// They're shared by the whole account, so both agents feed them; only the Oracle's page shows the hourglass.
let usage = state.get().usage || {};
function noteUsage(info) {
  const windows = info?.unifiedWindows
    || (info?.rateLimitType ? { [info.rateLimitType]: { utilization: info.utilization, resetsAt: info.resetsAt, status: info.status } } : {});
  const fresh = {};
  for (const [kind, w] of Object.entries(windows)) {
    if (typeof w?.utilization === 'number') fresh[kind] = { utilization: w.utilization, resetsAt: w.resetsAt ?? w.resets_at, status: w.status };
  }
  if (!Object.keys(fresh).length) return;
  usage = { ...usage, ...fresh, at: new Date().toISOString() };
  state.set({ usage });
  // Per Horace (2026-10-26): once a window is 80% used, a reminder says when it refills.
  for (const [kind, w] of Object.entries(fresh)) {
    if (!(w.utilization >= 0.8) || !w.resetsAt) continue;
    const due = new Date(w.resetsAt > 1e12 ? w.resetsAt : w.resetsAt * 1000);
    if (!(due > new Date())) continue;
    const tag = `usage:${kind}:${due.toISOString()}`;
    if (reminders.all().some((r) => r.tag === tag)) continue;
    const label = kind === 'five_hour' ? 'Your 5-hour Claude session' : kind === 'seven_day' ? 'Your weekly Claude allowance' : `Claude usage (${kind})`;
    reminders.add({ id: crypto.randomUUID().slice(0, 8), tag, text: `${label} has refilled. The Oracle and the Architect are back at full strength.`, due: due.toISOString(), created: new Date().toISOString() });
    broadcastTo(channels.oracle, { type: 'reminders_changed' });
  }
  broadcastTo(channels.oracle, { type: 'usage', usage });
}
function agentSend(key) {
  return (event) => {
    if (event.type === 'usage') return noteUsage(event.info);
    broadcastTo(channels[key], event);
    const other = channels[otherOf(key)];
    if (event.type === 'say' && event.origin !== 'routine') {
      lastSay[key] = { at: event.at || new Date().toISOString(), text: String(event.text).slice(0, 280) };
      broadcastTo(other, { type: 'peer', from: key, kind: 'say', ...lastSay[key] });
    } else if (event.type === 'busy') {
      broadcastTo(other, { type: 'peer', from: key, kind: 'busy', busy: event.busy });
    }
  };
}
const broadcast = agentSend('oracle');

const agent = new WatsonAgent(broadcast);
const architect = new WatsonAgent(agentSend('architect'), ARCHITECT);
// Trinity (2026-10-28): her own page; she doesn't trade busy/reply banners with the other two.
const trinity = new WatsonAgent((event) => broadcastTo(channels.trinity, event), TRINITY);
channels.trinity.agent = trinity;
channels.oracle.agent = agent;
channels.architect.agent = architect;
// Approvals are shared: whichever screen is open can answer them.
onApprovalEvent((event) => { broadcastTo(channels.oracle, event); broadcastTo(channels.architect, event); broadcastTo(channels.trinity, event); });
construct.onChange((summary) => broadcastTo(channels.architect, { type: 'construct', construct: summary }));
// What Horace may change on the tree from the Architect's screen (the Architect is told on his next turn).
const SCREEN_ACTIONS = new Set(['update', 'step', 'note', 'payout', 'undo_payout', 'add']);
// What the Oracle's Morning tab may send to the app's Morning Log (the worker checks every value).
const MORNING_FIELDS = new Set(['bedtime', 'wake', 'sleepQuality', 'energy', 'mood', 'weight', 'meds', 'medsNote', 'water', 'caffeine',
  'waterAdd', 'caffeineAdd', 'keto', 'gratitude', 'note', 'top1', 'top2', 'top3', 'top1Done', 'top2Done', 'top3Done', 'checkIn']);
async function morningGet(ws) {
  try {
    const r = await workerGet('/morning?person=Horace');
    ws.send(JSON.stringify({ type: 'morning', data: JSON.parse(r.body) }));
  } catch (e) { ws.send(JSON.stringify({ type: 'morning_result', ok: false, message: `Couldn't load the morning: ${e.message}` })); }
}
async function morningDo(ws, body) {
  const clean = Object.fromEntries(Object.entries(body || {}).filter(([k]) => MORNING_FIELDS.has(k)));
  try {
    const r = await workerPostMorning(clean);
    if (!r.json?.ok) throw new Error(r.json?.error || `HTTP ${r.status}`);
    broadcastTo(channels.oracle, { type: 'morning', data: r.json });
    ws.send(JSON.stringify({ type: 'morning_result', ok: true, message: r.json.warning || (clean.checkIn ? 'Checked in.' : 'Saved') }));
  } catch (e) { ws.send(JSON.stringify({ type: 'morning_result', ok: false, message: `Not saved: ${e.message}` })); }
}

function tokenOk(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(config.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  // Only accept sockets from pages served by Watson itself (blocks other websites).
  const origin = req.headers.origin;
  let sameOrigin = false;
  try {
    const host = new URL(origin).host;
    sameOrigin = host === req.headers.host || host === req.headers['x-forwarded-host']; // the latter behind a tunnel
  } catch {}
  if (url.pathname !== '/ws' || !sameOrigin) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// ── Failed logins, counted per device so a stranger can't lock you out ──
const failures = new Map(); // ip -> count
setInterval(() => failures.clear(), 10 * 60 * 1000);
// Behind the tunnel every request comes from 127.0.0.1; Cloudflare puts the real address here.
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?');
const lockedOut = (ip) => (failures.get(ip) || 0) >= 20;
function noteFailure(ip, reason) {
  failures.set(ip, (failures.get(ip) || 0) + 1);
  console.warn(`  Login refused from ${ip}: ${reason} (${failures.get(ip)} in the last 10 min)`);
}
// Why a token didn't match, without ever printing the token.
function tokenProblem(given) {
  const g = String(given || '');
  if (!g) return 'no token';
  if (g.length !== config.token.length) return `wrong length (${g.length} characters, expected ${config.token.length})`;
  if (g.toLowerCase() === config.token.toLowerCase()) return 'right characters but wrong capitalization';
  return 'wrong token';
}

// ── Phone pairing: a 6-digit, single-use, 5-minute code that stands in for the token ──
let pairing = null; // { code, expires, tries }
function startPairing() {
  pairing = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), expires: Date.now() + 5 * 60 * 1000, tries: 0 };
  return pairing;
}
function usePairCode(given) {
  if (!pairing || Date.now() > pairing.expires) { pairing = null; return 'no pairing code is active (make a new one on the PC)'; }
  if (String(given).trim() === pairing.code) { pairing = null; return null; }
  if (++pairing.tries >= 5) pairing = null; // too many guesses: the code is burned
  return 'wrong pairing code';
}
// The phone address printed by scripts/phone.sh, if a tunnel is running.
function phoneUrl() {
  try {
    const m = fs.readFileSync(path.join(DATA_DIR, 'tunnel.log'), 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    return m ? m[m.length - 1] : null;
  } catch { return null; }
}

// Listening log: what the browser's speech recognition did (starts, stops, gaps, errors,
// what it heard), so a cut-off sentence can be explained afterwards. data/ is never pushed.
const VOICE_LOG = path.join(DATA_DIR, 'voice-log.jsonl');
function saveVoiceLog(clientId, userAgent, events) {
  if (!Array.isArray(events) || !events.length) return;
  const device = /Android/i.test(userAgent || '') ? 'android' : /iPhone|iPad/i.test(userAgent || '') ? 'ios' : 'pc';
  const lines = events.slice(0, 200).map((e) => JSON.stringify({ client: clientId, device, ...e }).slice(0, 2000)).join('\n') + '\n';
  try {
    if (fs.existsSync(VOICE_LOG) && fs.statSync(VOICE_LOG).size > 2_000_000) fs.renameSync(VOICE_LOG, VOICE_LOG + '.1');
    fs.appendFileSync(VOICE_LOG, lines);
  } catch (e) { console.warn('  Voice log:', e.message); }
}

wss.on('connection', (ws, req) => {
  const ch = channels[new URL(req.url, 'http://x').searchParams.get('agent')] || channels.oracle;
  let authed = false;
  ws.clientId = null;
  const ip = clientIp(req);
  const authTimer = setTimeout(() => { if (!authed) ws.close(4001, 'auth timeout'); }, 5000);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!authed) {
      let problem = msg.type !== 'hello' ? 'no hello' : lockedOut(ip) ? 'too many failed attempts; wait 10 minutes' : null;
      let paired = false;
      if (!problem && msg.pairCode) { problem = usePairCode(msg.pairCode); paired = !problem; }
      else if (!problem && !tokenOk(String(msg.token || '').replace(/\s+/g, ''))) problem = tokenProblem(msg.token);
      if (problem) {
        noteFailure(ip, problem);
        ws.send(JSON.stringify({ type: 'auth_failed', reason: problem }));
        setTimeout(() => ws.close(4003, 'bad token'), 1000);
        return;
      }
      if (paired) { ws.send(JSON.stringify({ type: 'paired', token: config.token })); console.log(`  Paired a new device from ${ip}.`); }
      authed = true;
      clearTimeout(authTimer);
      ws.clientId = String(msg.clientId || crypto.randomUUID()).slice(0, 64);
      if (msg.timeZone && typeof msg.timeZone === 'string') state.set({ timeZone: msg.timeZone.slice(0, 64) });
      ch.clients.add(ws);
      ws.send(JSON.stringify({
        type: 'welcome',
        agent: ch.key,
        status: ch.agent.status(),
        history: ch.agent.history.recent(),
        approvals: pendingApprovals(),
        screens: ch.screens,
        reminders: reminders.all().filter((r) => !r.fired),
        ...(ch.key === 'architect' ? { construct: construct.summary() } : { usage }),
        lastSay: lastSayOf(ch.key),
        ...(ch.key === 'trinity' ? {} : { peer: { from: otherOf(ch.key), busy: channels[otherOf(ch.key)].agent.busy, last: lastSayOf(otherOf(ch.key)) } }),
      }));
      return;
    }

    switch (msg.type) {
      case 'ask': ch.agent.ask(String(msg.text || '').slice(0, 20000), ws.clientId); break;
      case 'interrupt': await ch.agent.interrupt(); break;
      case 'reset': await ch.agent.reset(); break;
      case 'morning_get': if (ch.key === 'oracle') morningGet(ws); break;
      case 'morning_do': if (ch.key === 'oracle') morningDo(ws, msg.body); break;
      case 'construct_get': if (ch.key === 'architect') ws.send(JSON.stringify({ type: 'construct', construct: construct.summary() })); break;
      case 'construct_do': {
        if (ch.key !== 'architect' || !SCREEN_ACTIONS.has(msg.action)) break;
        let reply;
        try {
          const r = construct.apply(msg.action, msg.args || {});
          noteScreenEdit(r.message);
          reply = { type: 'construct_result', ok: true, message: r.message, ref: msg.ref };
        } catch (e) { reply = { type: 'construct_result', ok: false, message: e.message, ref: msg.ref }; }
        ws.send(JSON.stringify(reply));
        break;
      }
      case 'approve': answerApproval(msg.id, msg.approved, msg.always); break;
      case 'reminders': ws.send(JSON.stringify({ type: 'reminders', reminders: reminders.all().filter((r) => !r.fired) })); break;
      case 'ping': ws.send('{"type":"pong"}'); break;
      case 'voicelog': saveVoiceLog(ws.clientId, req.headers['user-agent'], msg.events); break;
      case 'pair_start': {
        const p = startPairing();
        ws.send(JSON.stringify({ type: 'pairing', code: p.code, expires: new Date(p.expires).toISOString(), phoneUrl: phoneUrl() }));
        break;
      }
    }
  });
  ws.on('close', () => { ch.clients.delete(ws); clearTimeout(authTimer); });
});

startReminderLoop((r) => {
  if (!allClients()) {
    // Nobody has Watson open: pop up a Windows notification once, and still speak it when a screen connects.
    if (r.toasted) return false;
    windowsNotify(`Reminder: ${r.text}`);
    return 'toasted';
  }
  history.append({ role: 'system', text: `⏰ Reminder: ${r.text}` });
  broadcast({ type: 'reminder', id: r.id, text: r.text });
  return true;
});

// The Night Shift's own session (fresh each night); its activity is kept in data/night-history.jsonl.
const nightAgent = new WatsonAgent((event) => { if (event.type === 'error') console.warn('  Night shift:', event.message); }, NIGHT);
startRoutines({ main: agent, night: nightAgent, trinity });

server.listen(config.port, config.host, () => {
  console.log(`\n  Watson is listening on http://localhost:${config.port}`);
  console.log(`  Project: ${config.projectDir}`);
  console.log(`  Model:   ${config.model} (effort ${config.effort}, permissions ${config.permissionMode})`);
  console.log('  Open the address above in Chrome or Edge. The access token is in .env (WATSON_TOKEN).\n');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n  Watson is shutting down.');
    agent.shutdown();
    architect.shutdown();
    trinity.shutdown();
    nightAgent.shutdown();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
}
