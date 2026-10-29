const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = ''; try { token = JSON.parse(localStorage.getItem('watson.token') || '""'); } catch {}
const hash = new URLSearchParams(location.hash.slice(1)).get('token'); if (hash) { token = hash; localStorage.setItem('watson.token', JSON.stringify(token)); history.replaceState(null, '', location.pathname); }
async function api(p, body) {
  const r = await fetch(p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { $('login').hidden = false; throw new Error('auth'); }
  return r.json();
}
$('lf').onsubmit = (e) => { e.preventDefault(); token = $('tok').value.trim(); localStorage.setItem('watson.token', JSON.stringify(token)); $('login').hidden = true; refresh(); };
let S = null, T = {};
function render(s) {
  S = s;
  $('rank').textContent = s.rank.toUpperCase(); $('xp').textContent = s.xp.toLocaleString();
  const cur = s.ranks.find((r) => r[0] === s.rank)[1];
  $('nextr').textContent = s.next ? `${s.next.need.toLocaleString()} XP to ${s.next.name}` : 'You are The One.';
  $('bar').style.width = s.next ? Math.min(100, (s.xp - cur) / (s.next.at - cur) * 100) + '%' : '100%';
  $('streak').textContent = s.streak; $('left').textContent = s.left; $('today').textContent = s.todayXp; $('best').textContent = s.best;
  $('date').textContent = new Date(s.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  $('quests').innerHTML = s.quests.map((q) => `<div class="q ${q.status}${q.dejaVu ? ' deja' : ''}" data-q="${esc(q.id)}" role="button" tabindex="0">${esc(q.label)}<small>${esc(fmt(q.at))}${q.status === 'missed' ? ' · data, not a loss' : ''}</small></div>`).join('');
  $('ach').innerHTML = s.achievements.map((a) => `<span class="a ${a.at ? 'got' : ''}" title="${esc(a.how)}">${esc(a.name)}</span>`).join('');
  $('ranks').innerHTML = s.ranks.map((r) => `<span class="${s.xp >= r[1] ? 'on' : ''}">${esc(r[0])} ${r[1].toLocaleString()}${s.unlocks[r[0]] ? ' (' + esc(s.unlocks[r[0]]) + ')' : ''}</span>`).join(' · ');
  ticker();
}
const fmt = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
function ticker() {
  if (!S) return;
  const got = S.achievements.filter((a) => a.at === S.date).map((a) => '🏆 ' + a.name);
  const items = [`<b>${esc(S.rank.toUpperCase())}</b> ${S.xp.toLocaleString()} XP`, `STREAK ${S.streak}`, S.nextQuest ? `NEXT ${esc(fmt(S.nextQuest.at))} ${esc(S.nextQuest.label)}` : 'ALL QUESTS CLEARED',
    `${S.left} QUESTS LEFT TODAY`, ...got.map(esc), T.budget != null ? `BUDGET LEFT THIS WEEK $${Number(T.budget).toFixed(2)}` : '', T.weather ? `THRALL ${esc(T.weather)}` : '',
    T.reminder ? `REMINDER ${esc(new Date(T.reminder.due).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }))} ${esc(T.reminder.text.slice(0, 60))}` : '', `MORPHEUS: "${esc(S.line)}"`].filter(Boolean);
  $('ticker').innerHTML = items.join('<i>◆</i>');
}
function say(text, me) { const d = document.createElement('div'); d.className = 'm ' + (me ? 'me' : 'sys'); d.textContent = text; $('msgs').append(d); $('msgs').scrollTop = 1e9; }
async function send(text, quest) {
  say(text, true);
  try { const r = await api('/hub/log', { text, quest }); say(r.reply); render(r.state); if (r.added?.length) { $('core').classList.remove('flash'); void $('core').offsetWidth; $('core').classList.add('flash'); } }
  catch (e) { if (e.message !== 'auth') say("Couldn't reach the Construct. Is Watson running?"); }
}
$('form').onsubmit = (e) => { e.preventDefault(); const t = $('text').value.trim(); if (t) { $('text').value = ''; send(t); } };
$('quests').onclick = (e) => { const q = e.target.closest('[data-q]'); if (!q || !S) return; const it = S.quests.find((x) => x.id === q.dataset.q); if (it.status === 'done') return; send(`${it.label} — done`, it.id); };
// Dictation (Chrome, Edge, Android). Fills the box and sends when he stops talking.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('mic').hidden = true; else {
  let rec = null;
  $('mic').onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
    rec.onresult = (ev) => { const t = [...ev.results].map((r) => r[0].transcript).join(' '); $('text').value = t; if (ev.results[ev.results.length - 1].isFinal) { $('text').value = ''; send(t); } };
    rec.onend = () => { rec = null; $('mic').classList.remove('on'); };
    $('mic').classList.add('on'); rec.start();
  };
}
// 3D: the construct follows the mouse or the phone's tilt.
const scene = $('scene');
const tilt = (x, y) => { scene.style.setProperty('--rx', (58 - y * 18) + 'deg'); scene.style.setProperty('--rz', (x * 25) + 'deg'); };
$('core').addEventListener('pointermove', (e) => { const b = $('core').getBoundingClientRect(); tilt((e.clientX - b.left) / b.width * 2 - 1, (e.clientY - b.top) / b.height * 2 - 1); });
window.addEventListener('deviceorientation', (e) => { if (e.gamma != null) tilt(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 30))); });
// Tick marks and glyphs make the rings look intricate (fixed pattern, nothing random).
const G = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ZΞ';
for (let i = 0; i < 24; i++) { const t = document.createElement('i'); t.className = 'tickm'; t.style.transform = `rotate(${i * 15}deg)`; t.style.transformOrigin = '0 154px'; $('r1').append(t); }
for (let i = 0; i < 16; i++) { const g = document.createElement('span'); g.className = 'glyph'; g.textContent = G[i % G.length]; g.style.transform = `rotate(${i * 22.5}deg) translateY(-118px)`; scene.append(g); }
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }, 1000);
async function refresh() { try { render(await api('/hub/state')); } catch {} }
async function refreshTicker() { try { T = await api('/hub/ticker'); ticker(); } catch {} }
if (!token) $('login').hidden = false; else { refresh(); refreshTicker(); }
setInterval(refresh, 60000); setInterval(refreshTicker, 15 * 60000);
