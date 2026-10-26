import { Voice, speechSupported, parseYesNo } from './voice.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('watson.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('watson.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('watson.' + k); } catch {} },
};

// ── Identity ──
const clientId = store.get('clientId') || (() => { const id = crypto.randomUUID(); store.set('clientId', id); return id; })();
let token = store.get('token', '');
const hashParams = new URLSearchParams(location.hash.slice(1));
const hashToken = hashParams.get('token');
if (hashToken) { token = hashToken; store.set('token', token); }
if (location.hash) history.replaceState(null, '', location.pathname);

const settings = Object.assign({ mode: 'handsfree', speak: true, barge: false, voice: '', rate: 1.05, follow: 7, settle: 1.5, endPause: 3, headset: true, micOn: false }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
if (settings.endPause === 1.8) { settings.endPause = 3; saveSettings(); }
if (!settings.oracleVoice) { if (settings.voice === 'nPczCjzI2devNBz1zQrb') settings.voice = ''; settings.oracleVoice = true; saveSettings(); } // the Oracle (2026-10-25): Brian -> the server's new default voice // 1.8 s cut Horace off mid-thought; move the old default up
// The PC launcher opens Watson with #listen=1: always listening for "Watson".
if (hashParams.get('listen') === '1') { settings.mode = 'handsfree'; settings.micOn = true; saveSettings(); }

// ── State ──
let ws = null;
let connected = false;
let busy = false;
let voiceState = 'off';
let approvals = []; // pending approval requests, oldest first
let tapToggle = false;
let reconnectDelay = 1000;

// ── Helpers ──
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeStr = (iso) => { const d = iso ? new Date(iso) : new Date(); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

function renderDiff(code) {
  return '<pre class="block">' + code.split('\n').map((l) => {
    const cls = /^(diff --git|\+\+\+ |--- |index )/.test(l) ? 'diff-file' : l.startsWith('@@') ? 'diff-hunk' : l.startsWith('+') ? 'diff-add' : l.startsWith('-') ? 'diff-del' : '';
    return cls ? `<span class="${cls}">${esc(l)}</span>` : esc(l);
  }).join('\n') + '</pre>';
}

function renderText(src) {
  const lines = src.split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => { if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flushPara(); closeList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      html += '<table><thead><tr>' + cells(line).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { html += '<tr>' + cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++; }
      i--; html += '</tbody></table>';
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)/))) { flushPara(); closeList(); html += `<h4>${inline(m[2])}</h4>`; }
    else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { flushPara(); if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) { flushPara(); closeList(); }
    else { closeList(); para.push(line.trim()); }
  }
  flushPara(); closeList();
  return html;
}

function renderMarkdown(src) {
  let html = '';
  let last = 0;
  const re = /```([\w-]*)\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(src))) {
    html += renderText(src.slice(last, m.index));
    html += m[1] === 'diff' ? renderDiff(m[2].replace(/\n$/, '')) : `<pre class="block"><code>${esc(m[2].replace(/\n$/, ''))}</code></pre>`;
    last = re.lastIndex;
  }
  return html + renderText(src.slice(last));
}

// ── Sound cues ──
let audioCtx = null;
function beep(freq = 880, ms = 90, vol = 0.05) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.frequency.value = freq; g.gain.value = vol;
    o.connect(g).connect(audioCtx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000); o.stop(audioCtx.currentTime + ms / 1000 + 0.02);
  } catch {}
}

// ── Conversation UI ──
function addMsg(role, text, at) {
  const li = document.createElement('li');
  li.className = 'msg ' + role;
  li.textContent = text;
  if (role === 'you' || role === 'watson') { const t = document.createElement('time'); t.textContent = timeStr(at); li.append(t); }
  $('convo').append(li);
  const panel = $('tab-convo');
  panel.scrollTop = panel.scrollHeight;
}

function addActivity(text, { sub = false, done = false } = {}) {
  const list = $('activity');
  list.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  if (sub) li.className = 'sub';
  if (done) li.className = 'done';
  const t = document.createElement('time'); t.textContent = timeStr();
  li.append(t, document.createTextNode(text));
  list.prepend(li);
  while (list.children.length > 200) list.lastChild.remove();
}

function addScreen(item, { quiet = false } = {}) {
  const box = $('screen');
  box.querySelector('.empty')?.remove();
  const card = document.createElement('article');
  card.className = 'screen-item';
  const body = item.format === 'diff' ? renderDiff(item.content)
    : item.format === 'code' ? `<pre class="block"><code>${esc(item.content)}</code></pre>`
    : item.format === 'text' ? `<p>${esc(item.content).replace(/\n/g, '<br>')}</p>`
    : renderMarkdown(item.content);
  card.innerHTML = `<h3><span>${esc(item.title)}</span><time>${timeStr(item.at)}</time></h3><div class="md">${body}</div>`;
  box.prepend(card);
  while (box.children.length > 8) box.lastChild.remove();
  if (!quiet) {
    if (!$('tab-screen').classList.contains('active')) $('screen-dot').hidden = false;
    if (window.matchMedia('(min-width: 861px)').matches) showTab('screen');
  }
}

function renderReminders(list) {
  const ul = $('reminders');
  ul.innerHTML = '';
  if (!list.length) { ul.innerHTML = '<li class="empty">No reminders. Try "Oracle, remind me in 20 minutes to check the oven."</li>'; return; }
  for (const r of list.sort((a, b) => a.due.localeCompare(b.due))) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = new Date(r.due).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    li.append(b, document.createTextNode(r.text));
    ul.append(li);
  }
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  // (On desktop the conversation panel stays visible whatever tab is active; see style.css.)
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'screen') $('screen-dot').hidden = true;
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ── Status display ──
const LABELS = {
  off: 'Mic is off', listening: 'Listening for "Oracle"', awake: "I'm listening", capturing: 'Listening…',
  speaking: 'Speaking', 'ptt-idle': 'Hold to talk', thinking: 'Working on it…',
};
function hintFor(state) {
  if (!speechSupported.listen) return 'This browser has no speech recognition. Use Chrome or Edge on a computer, Chrome on Android, or Safari on iPhone. You can still type.';
  switch (state) {
    case 'off': return 'Turn the mic on, then say "Oracle" and your request. Or hold the orb (or Space) to talk.';
    case 'listening': return busy ? 'The Oracle is working. Say "Oracle, cancel" to stop it.' : 'Say "Oracle, …" anytime, or hold the orb.';
    case 'awake': return approvals.length ? 'Say "yes" or "no".' : 'Go ahead.';
    case 'capturing': return tapToggle ? 'Listening… tap the orb again to send.' : 'Listening… let go to send.';
    case 'speaking': return 'Press Stop or Esc to cut me off.';
    case 'ptt-idle': return 'Hold the orb or Space while you talk. Or tap once to start and again to send.';
    default: return '';
  }
}
function renderState() {
  let s = voiceState;
  if (busy && (s === 'listening' || s === 'off' || s === 'ptt-idle')) s = 'thinking';
  $('orb').dataset.state = s;
  $('state-label').textContent = LABELS[s] || '';
  $('hint').textContent = hintFor(voiceState);
  $('btn-stop').disabled = !busy && voiceState !== 'speaking';
  $('btn-mic').hidden = settings.mode !== 'handsfree' || !speechSupported.listen;
  $('btn-mic').textContent = voice.enabled ? 'Turn mic off' : 'Turn mic on';
  $('working').hidden = !busy;
}

// ── Voice ──
const voice = new Voice({
  onCommand: (text) => handleSpoken(text),
  onInterim: (text) => { $('caption').textContent = text; },
  onWake: () => { beep(988, 80); $('caption').textContent = ''; },
  onIgnored: () => { setTimeout(() => { $('caption').textContent = ''; }, 1500); },
  onState: (s) => { voiceState = s; renderState(); },
  onError: (msg) => { addMsg('error', msg); renderState(); },
  onVoices: () => fillVoices(),
  onCloudOff: (msg) => addMsg('system', msg),
  onDiag: (e) => logDiag(e),
});
voice.mode = settings.mode;
voice.speakEnabled = settings.speak;
voice.bargeIn = settings.barge;
voice.voiceName = settings.voice;
voice.rate = settings.rate;
voice.followUpMs = settings.follow * 1000;
voice.settleMs = settings.settle * 1000;
voice.endPauseMs = settings.endPause * 1000;

// ElevenLabs voices, spoken through Watson's server (which holds the API key).
let cloudVoices = [];
async function loadCloudVoices() {
  try {
    const auth = { Authorization: 'Bearer ' + token };
    const res = await fetch('tts/voices', { headers: auth, cache: 'no-store' });
    const info = res.ok ? await res.json() : { enabled: false };
    if (!info.enabled) { voice.cloud = null; cloudVoices = []; return; }
    cloudVoices = info.voices || [];
    voice.cloud = {
      defaultVoice: info.defaultVoice,
      async fetch(text, voiceId, speed) {
        const r = await fetch('tts', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: voiceId, speed }) });
        if (!r.ok) { const e = new Error('Speech failed (' + r.status + ')'); e.status = r.status; throw e; }
        return r.blob();
      },
    };
  } catch { voice.cloud = null; cloudVoices = []; }
  if ($('settings').open) fillVoices();
}

function handleSpoken(text) {
  $('caption').textContent = '“' + text + '”';
  setTimeout(() => { if ($('caption').textContent === '“' + text + '”') $('caption').textContent = ''; }, 4000);
  if (approvals.length) {
    const yn = parseYesNo(text);
    if (yn) { answerApproval(approvals[0].id, yn.answer, yn.always); if (yn.rest) send({ type: 'ask', text: yn.rest }); return; }
    voice.speak('Sorry, I need a yes or a no.', { afterMs: 20000 });
    return;
  }
  if (busy && /^(cancel|stop working|stop that|abort|never ?mind|forget it)\b/i.test(text)) { interrupt(); voice.speak('Okay, stopped.', { wakeAfter: false }); return; }
  if (/^(new conversation|start over|new chat|clear (the )?conversation)\b/i.test(text)) { send({ type: 'reset' }); return; }
  beep(660, 60, 0.03);
  send({ type: 'ask', text });
}

function shouldSpeakFor(origin) {
  return settings.speak && (origin === clientId || (!origin && document.visibilityState === 'visible'));
}

// ── Approvals ──
function showApproval() {
  const a = approvals[0];
  if (!a) { $('approval').hidden = true; renderState(); return; }
  $('approval').hidden = false;
  $('approval').querySelector('.approval').classList.toggle('high', a.level === 'high');
  $('approval-level').textContent = a.level === 'high' ? 'High risk: needs your OK' : 'Needs your OK';
  $('approval-title').textContent = a.title;
  $('approval-detail').textContent = a.detail;
  $('ap-always').hidden = !a.canAlways;
  $('approval-more').textContent = approvals.length > 1 ? `${approvals.length - 1} more waiting after this one.` : '';
  renderState();
}
function answerApproval(id, approved, always = false) {
  send({ type: 'approve', id, approved, always });
  approvals = approvals.filter((a) => a.id !== id);
  voice.speak(approved ? 'Okay.' : 'Okay, I won\'t.', { wakeAfter: false });
  showApproval();
}
$('ap-yes').onclick = () => approvals[0] && answerApproval(approvals[0].id, true);
$('ap-no').onclick = () => approvals[0] && answerApproval(approvals[0].id, false);
$('ap-always').onclick = () => approvals[0] && answerApproval(approvals[0].id, true, true);

// ── Server connection ──
// Listening log: speech-recognition events go to the server in small batches (data/voice-log.jsonl),
// so a cut-off sentence can be explained afterwards.
const diagQueue = [];
function logDiag(e) {
  diagQueue.push(e);
  if (diagQueue.length >= 25) flushDiag();
}
function flushDiag() {
  if (!diagQueue.length || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'voicelog', events: diagQueue.splice(0, 200) }));
}
setInterval(flushDiag, 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDiag(); });

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return true; }
  addMsg('error', 'Not connected to the Oracle. Is it running?');
  return false;
}
function interrupt() { voice.stopSpeaking(); if (busy) send({ type: 'interrupt' }); }

function setConn(on, text) {
  connected = on;
  $('conn').textContent = text;
  $('conn').className = 'pill ' + (on ? 'pill-on' : 'pill-off');
}

let pairCode = ''; // a one-time 6-digit code from "Pair a phone", used instead of the token
let authError = '';
function connect() {
  if (!token && !pairCode) { $('login').hidden = false; setConn(false, 'Signed out'); return; }
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(url);
  authError = '';
  ws.onopen = () => ws.send(JSON.stringify({
    type: 'hello', ...(pairCode ? { pairCode } : { token }), clientId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = (e) => {
    setConn(false, 'Reconnecting…');
    if (e.code === 4003) {
      const usedCode = !!pairCode;
      store.del('token'); token = ''; pairCode = '';
      setConn(false, 'Signed out');
      $('login').hidden = false;
      $('login-error').textContent = (usedCode ? 'That code was not accepted' : 'That token was not accepted') + (authError ? `: ${authError}.` : '.');
      return;
    }
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 15000);
  };
}

function onEvent(ev) {
  switch (ev.type) {
    case 'auth_failed': authError = ev.reason || ''; break;
    case 'paired': token = ev.token; pairCode = ''; store.set('token', token); break;
    case 'pairing': {
      const mins = Math.max(1, Math.round((new Date(ev.expires) - Date.now()) / 60000));
      $('pair-out').hidden = false;
      $('pair-code').textContent = ev.code.replace(/(\d{3})(\d{3})/, '$1 $2');
      $('pair-url').textContent = ev.phoneUrl || 'No phone tunnel is running. Start one with: npm run phone';
      $('pair-note').textContent = `On the phone, open the address above and type this code instead of the token. It works once, for the next ${mins} minutes.`;
      break;
    }
    case 'welcome': {
      reconnectDelay = 1000;
      setConn(true, 'Connected');
      $('login').hidden = true;
      $('convo').innerHTML = '';
      for (const h of ev.history || []) addMsg(h.role, h.text, h.at);
      $('screen').innerHTML = ev.screens?.length ? '' : '<p class="empty">Diffs, code and lists the Oracle shows you will appear here.</p>';
      for (const s of ev.screens || []) addScreen(s, { quiet: true });
      approvals = ev.approvals || [];
      showApproval();
      renderReminders(ev.reminders || []);
      busy = !!ev.status?.busy;
      setStatusLine(ev.status);
      renderState();
      loadCloudVoices();
      break;
    }
    case 'status': setStatusLine(ev); break;
    case 'heard': addMsg('you', ev.text); break;
    case 'say':
      addMsg('watson', ev.text);
      if (shouldSpeakFor(ev.origin)) voice.speak(ev.text);
      break;
    case 'busy': busy = ev.busy; if (!busy) $('working-text').textContent = 'The Oracle is working…'; renderState(); break;
    case 'activity':
      addActivity(ev.text, { sub: ev.sub });
      $('working-text').textContent = ev.text.length > 90 ? ev.text.slice(0, 90) + '…' : ev.text;
      break;
    case 'done': {
      const secs = Math.round((ev.ms || 0) / 1000);
      addActivity(`Done in ${secs}s${ev.costUsd ? ` · $${ev.costUsd.toFixed(3)}` : ''}`, { done: true });
      break;
    }
    case 'error':
      addMsg('error', ev.message);
      if (shouldSpeakFor(ev.origin)) voice.speak(ev.message);
      break;
    case 'screen': addScreen(ev); break;
    case 'approval':
      if (!approvals.some((a) => a.id === ev.id)) approvals.push(ev);
      showApproval();
      beep(523, 120, 0.06); setTimeout(() => beep(784, 160, 0.06), 140);
      if (settings.speak && document.visibilityState === 'visible') voice.speak(`${ev.title}. Should I go ahead?`, { afterMs: 30000 });
      else voice.wake(30000);
      break;
    case 'approval_closed':
      approvals = approvals.filter((a) => a.id !== ev.id);
      showApproval();
      break;
    case 'reminder':
      addMsg('system', '⏰ Reminder: ' + ev.text);
      beep(784, 150, 0.07); setTimeout(() => beep(988, 200, 0.07), 180);
      voice.speak('Reminder. ' + ev.text);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('The Oracle: reminder', { body: ev.text, icon: 'icon.svg' });
      send({ type: 'reminders' });
      break;
    case 'reminders_changed': send({ type: 'reminders' }); break;
    case 'reminders': renderReminders(ev.reminders || []); break;
    case 'reset':
      $('convo').innerHTML = '';
      addMsg('system', 'New conversation started.');
      break;
  }
}

function setStatusLine(s) {
  if (!s) return;
  const parts = [`Model: ${s.model}`];
  if (s.cwd) parts.push(`Project: ${s.cwd}`);
  if (s.servers?.length) parts.push(`Connectors: ${s.servers.join(', ')}`);
  $('status-line').textContent = parts.join(' · ');
}

// ── Controls ──
let speechUnlocked = false;
function unlockAudio() {
  // iOS/Safari only allow speech and sound after a tap; prime both on the first one.
  if (speechUnlocked) return;
  speechUnlocked = true;
  try { if (speechSupported.speak) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {}
  try { audioCtx = audioCtx || new AudioContext(); audioCtx.resume(); } catch {}
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  if (settings.headset) setHeadsetButton(true);
}
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
document.addEventListener('keydown', unlockAudio, { once: true, capture: true });

$('btn-mic').onclick = () => {
  voice.setEnabled(!voice.enabled);
  settings.micOn = voice.enabled; saveSettings();
  renderState();
};
$('btn-stop').onclick = interrupt;
$('btn-new').onclick = () => { if (confirm('Start a new conversation? The Oracle will forget this chat (but keep what she remembered about you).')) send({ type: 'reset' }); };

// Orb: hold to talk, or tap once to start and tap again to send.
let downAt = 0;
let ignoreUp = false;
const orb = $('orb');
orb.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  orb.setPointerCapture?.(e.pointerId);
  if (tapToggle) { tapToggle = false; ignoreUp = true; voice.pttEnd(); return; }
  downAt = Date.now();
  voice.pttStart();
});
orb.addEventListener('pointerup', () => {
  if (ignoreUp) { ignoreUp = false; return; }
  if (Date.now() - downAt < 350) { tapToggle = true; renderState(); } else voice.pttEnd();
});
orb.addEventListener('pointercancel', () => { tapToggle = false; voice.pttEnd(); });
orb.addEventListener('contextmenu', (e) => e.preventDefault());

// Headset button: play/pause on Bluetooth headphones works like tapping the orb (press to
// start talking, press again to send). Browsers only pass media keys to a page that is
// playing audio, so a silent loop keeps Watson's media session alive. If another app (say,
// music) played something more recently, that app gets the button instead.
let keepAlive = null;
function silentWavUrl(seconds = 2, rate = 8000) {
  const n = seconds * rate, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function headsetPress(action) {
  logDiag({ ev: 'headset', action });
  keepAlive?.play().catch(() => {}); // stay the active media session
  if (tapToggle) { tapToggle = false; voice.pttEnd(); beep(523, 90, 0.06); }
  else { voice.pttStart(); tapToggle = voice.ptt; if (tapToggle) beep(988, 90, 0.06); }
  renderState();
}
function setHeadsetButton(on) {
  if (!('mediaSession' in navigator)) return;
  const actions = ['play', 'pause', 'togglemicrophone'];
  if (!on) {
    keepAlive?.pause();
    for (const a of actions) { try { navigator.mediaSession.setActionHandler(a, null); } catch {} }
    return;
  }
  if (!keepAlive) { keepAlive = new Audio(silentWavUrl()); keepAlive.loop = true; }
  keepAlive.play().catch(() => {}); // needs a tap or key press first; unlockAudio retries
  for (const a of actions) { try { navigator.mediaSession.setActionHandler(a, () => headsetPress(a)); } catch {} }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'The Oracle', artist: 'Press play/pause on your headset to talk' });
    navigator.mediaSession.playbackState = 'playing';
  } catch {}
}

// Keyboard: hold Space to talk, Esc to stop.
const typingTarget = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { interrupt(); return; }
  if (e.code === 'Space' && !e.repeat && !typingTarget(document.activeElement) && !$('settings').open) { e.preventDefault(); voice.pttStart(); }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !typingTarget(document.activeElement) && !$('settings').open) { e.preventDefault(); voice.pttEnd(); }
});

$('type-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('type-input').value.trim();
  if (!text) return;
  if (approvals.length) { const yn = parseYesNo(text); if (yn) { answerApproval(approvals[0].id, yn.answer, yn.always); $('type-input').value = ''; return; } }
  if (send({ type: 'ask', text })) $('type-input').value = '';
};

$('login-form').onsubmit = (e) => {
  e.preventDefault();
  const value = $('login-token').value.replace(/\s+/g, '');
  if (/^\d{6}$/.test(value)) { pairCode = value; token = ''; } else { token = value; pairCode = ''; store.set('token', token); }
  $('login-error').textContent = '';
  ws?.close();
  connect();
};

// ── Settings dialog ──
function fillVoices() {
  const sel = $('set-voice');
  const voices = voice.voices();
  const opts = (list) => list.map((v) => `<option value="${esc(v.value)}">${esc(v.label)}</option>`).join('');
  const brian = cloudVoices.find((v) => v.id === voice.cloud?.defaultVoice);
  sel.innerHTML = `<option value="">Automatic${brian ? ` (ElevenLabs ${esc(brian.name.split(' - ')[0])})` : ''}</option>`
    + (cloudVoices.length ? `<optgroup label="ElevenLabs">${opts(cloudVoices.map((v) => ({ value: 'el:' + v.id, label: v.name })))}</optgroup>` : '')
    + (voices.length ? `<optgroup label="Browser">${opts(voices.map((v) => ({ value: v.name, label: v.name })))}</optgroup>` : '');
  sel.value = settings.voice;
}
$('btn-settings').onclick = () => {
  $('set-mode').value = settings.mode;
  $('set-speak').checked = settings.speak;
  $('set-barge').checked = settings.barge;
  $('set-rate').value = settings.rate;
  $('rate-out').textContent = settings.rate.toFixed(2) + '×';
  $('set-follow').value = settings.follow;
  $('set-settle').value = settings.settle;
  $('set-endpause').value = settings.endPause;
  $('set-headset').checked = settings.headset;
  fillVoices();
  $('settings').showModal();
};
$('set-mode').onchange = (e) => { settings.mode = e.target.value; voice.setMode(settings.mode); saveSettings(); renderState(); };
$('set-speak').onchange = (e) => { settings.speak = voice.speakEnabled = e.target.checked; if (!settings.speak) voice.stopSpeaking(); saveSettings(); };
$('set-barge').onchange = (e) => { settings.barge = voice.bargeIn = e.target.checked; saveSettings(); };
$('set-voice').onchange = (e) => { settings.voice = voice.voiceName = e.target.value; saveSettings(); };
$('set-rate').oninput = (e) => { settings.rate = voice.rate = Number(e.target.value); $('rate-out').textContent = settings.rate.toFixed(2) + '×'; saveSettings(); };
$('set-follow').onchange = (e) => { settings.follow = Math.max(0, Math.min(30, Number(e.target.value) || 0)); voice.followUpMs = settings.follow * 1000; saveSettings(); };
$('set-settle').onchange = (e) => { settings.settle = Math.max(0, Math.min(4, Number(e.target.value) || 0)); voice.settleMs = settings.settle * 1000; saveSettings(); };
$('set-endpause').onchange = (e) => { settings.endPause = Math.max(0.5, Math.min(5, Number(e.target.value) || 3)); voice.endPauseMs = settings.endPause * 1000; saveSettings(); };
$('set-headset').onchange = (e) => { settings.headset = e.target.checked; setHeadsetButton(settings.headset); saveSettings(); };
$('test-voice').onclick = () => voice.speak("I've been expecting you. The Oracle is here when you need her.", { wakeAfter: false });
$('btn-pair').onclick = () => send({ type: 'pair_start' });
$('btn-logout').onclick =() => { store.del('token'); token = ''; ws?.close(); location.reload(); };

// ── Start ──
renderState();
connect();
if (settings.micOn && settings.mode === 'handsfree') voice.setEnabled(true);
if (settings.headset) setHeadsetButton(true); // may wait for the first tap if the browser blocks autoplay
