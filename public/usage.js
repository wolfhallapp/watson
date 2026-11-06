// The Usage page (Night Shift 2026-11-06): draws GET /usage/report, the usage log summed by day and by job,
// so Horace can see what eats his Claude allowance. Read-only.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#00ff41', '#8cffaa', '#1f9c4a', '#ffb020', '#5fd3ff', '#c792ff', '#ff7aa8', '#e8f06b', '#9fb8a8', '#4d8f63'];
const money = (n) => '$' + (+n || 0).toFixed(2);
const pct = (n) => (n == null ? '–' : `${Math.round(n * 10) / 10}%`);
const fmt = (m, v) => (m === 'usd' ? money(v) : pct(v));
const dayLabel = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const when = (sec) => (sec ? new Date(sec * 1000).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '–');

let token = ''; try { token = JSON.parse(localStorage.getItem('watson.token') || '""'); } catch {}
const hash = new URLSearchParams(location.hash.slice(1)).get('token'); if (hash) { token = hash; localStorage.setItem('watson.token', JSON.stringify(token)); history.replaceState(null, '', location.pathname); }
async function api(p) {
  const r = await fetch(p, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) { $('login').hidden = false; throw new Error('auth'); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
}
$('lf').onsubmit = (e) => { e.preventDefault(); token = $('tok').value.trim(); localStorage.setItem('watson.token', JSON.stringify(token)); $('login').hidden = true; load(); };

let rep = null, metric = 'usd';
const sync = (text, err) => { $('sync').textContent = text; $('sync').classList.toggle('err', !!err); };
const colorOf = (kind) => COLORS[Math.max(0, rep.kinds.indexOf(kind)) % COLORS.length];
const classOf = (kind) => 'c' + (Math.max(0, rep.kinds.indexOf(kind)) % COLORS.length);

async function load() {
  sync('reading the log…');
  try {
    rep = await api('/usage/report?days=' + $('days').value);
    sync(rep.now ? `last job ${new Date(rep.now.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'no jobs logged yet');
    draw();
  } catch (e) { if (e.message !== 'auth') sync('could not read: ' + e.message, true); }
}

function draw() { kpis(); chart(); kinds(); biggest(); }

function kpis() {
  const n = rep.now || {};
  const lvl = (v) => (v == null ? '' : v >= 90 ? 'bad' : v >= 75 ? 'warn' : '');
  const tile = (k, v, d, cls = '') => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${esc(d)}</div></div>`;
  const today = rep.days[rep.days.length - 1] || { usd: 0, jobs: 0 };
  $('kpis').innerHTML = [
    tile('WEEK USED', pct(n.week), `resets ${when(n.weekResets)}`, lvl(n.week)),
    tile('5-HOUR SESSION', pct(n.session), `resets ${when(n.sessionResets)}`, lvl(n.session)),
    tile('THIS WEEK', money(rep.thisWeek.usd), `${rep.thisWeek.jobs} jobs`),
    tile('TODAY', money(today.usd), `${today.jobs} jobs`),
  ].join('');
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function chart() {
  const box = $('dchart'), tip = $('dtip');
  box.querySelector('svg')?.remove();
  const W = box.clientWidth || 600, H = box.clientHeight || 300, m = { l: 44, r: 8, t: 10, b: 26 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Usage by day' });
  box.insertBefore(svg, tip);
  const days = rep.days, n = days.length;
  const max = Math.max(...days.map((d) => d[metric]), metric === 'usd' ? 1 : 2);
  const Y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  const slot = (W - m.l - m.r) / n, bw = Math.max(4, Math.min(34, slot * 0.7));
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, y = Y(v);
    el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: 'rgba(0,255,65,.1)' }, svg);
    el('text', { x: m.l - 6, y: y + 3, 'text-anchor': 'end' }, svg).textContent = metric === 'usd' ? '$' + Math.round(v) : Math.round(v) + '%';
  }
  days.forEach((d, i) => {
    const x = m.l + slot * i + (slot - bw) / 2;
    let base = 0;
    for (const kind of rep.kinds) {
      const v = d.kinds[kind]?.[metric] || 0;
      if (!v) continue;
      const r = el('rect', { class: 'bar', x, y: Y(base + v), width: bw, height: Math.max(0.5, Y(base) - Y(base + v)), fill: colorOf(kind), rx: 1 }, svg);
      r.addEventListener('mousemove', (e) => showTip(e, d));
      r.addEventListener('click', (e) => showTip(e, d));
      r.addEventListener('mouseleave', () => { tip.hidden = true; });
      base += v;
    }
    if (n <= 14 || i % 2 === 0) el('text', { x: x + bw / 2, y: H - m.b + 14, 'text-anchor': 'middle' }, svg).textContent = dayLabel(d.date).replace(/^\w+ /, '');
  });
  $('legend').innerHTML = rep.kinds.map((k) => `<span><i class="${classOf(k)}"></i>${esc(k)}</span>`).join('');
}

function showTip(e, d) {
  const tip = $('dtip'), box = $('dchart').getBoundingClientRect();
  const rows = Object.values(d.kinds).sort((a, b) => b[metric] - a[metric])
    .map((k) => `<div class="row"><span>${esc(k.kind)} <span class="t">×${k.jobs}</span></span><span>${fmt(metric, k[metric])}</span></div>`).join('');
  tip.innerHTML = `<b>${esc(dayLabel(d.date))}</b> · ${fmt(metric, d[metric])}<div class="t">${d.jobs} jobs</div>${rows}`;
  tip.hidden = false;
  const x = e.clientX - box.left, y = e.clientY - box.top;
  tip.style.left = Math.min(x + 12, box.width - 200) + 'px';
  tip.style.top = Math.max(0, y - 20) + 'px';
}

function kinds() {
  const w = rep.thisWeek, top = Math.max(...w.byKind.map((k) => k.usd), 0.01);
  $('wkdim').textContent = `${w.jobs} jobs · ${money(w.usd)}`;
  $('kinds').innerHTML = w.byKind.length ? w.byKind.map((k) =>
    `<div class="b"><span class="n" title="${esc(k.kind)}">${esc(k.kind)}<small>×${k.jobs}</small></span><span class="track"><span class="fill" data-w="${(k.usd / top) * 100}" data-c="${colorOf(k.kind)}"></span></span><span class="val">${money(k.usd)} · ${pct(k.week)}</span></div>`).join('')
    : '<p class="mini">No jobs logged this week yet.</p>';
  $('kinds').querySelectorAll('.fill').forEach((f) => { f.style.width = f.dataset.w + '%'; f.style.background = f.dataset.c; });
  const q = w.nightQuick;
  $('quick').textContent = q.jobs ? `${q.jobs} of the Night Shift runs were quick checks under $1 (${money(q.usd)} together).` : '';
}

function biggest() {
  const rows = rep.biggest.map((j) => `<tr><td>${esc(new Date(j.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</td><td>${esc(j.kind)}</td><td class="ask" title="${esc(j.ask)}">${esc(j.ask)}</td><td class="r">${money(j.usd)}</td><td class="r">${pct(j.week)}</td></tr>`).join('');
  $('biggest').innerHTML = `<tr><th>When</th><th>Job</th><th class="ask">What</th><th class="r">$</th><th class="r">Week</th></tr>${rows || '<tr><td colspan="5" class="mini">Nothing yet.</td></tr>'}`;
}

document.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
  metric = b.dataset.m;
  document.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
  if (rep) chart();
}));
$('days').addEventListener('change', load);
$('refresh').addEventListener('click', load);
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => rep && chart(), 150); });
load();
