// The Budget Construct page (2026-11-05): live what-if charts over the Wolf Hall plan. All math is in
// budget-engine.js; this file draws it and saves Horace's tweaks so the Oracle can see them.
import { simulate, insights, solve, LOCKED, LABELS, addDays, dataEnd } from './budget-engine.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n, cents = false) => (n < 0 ? '-$' : '$') + Math.abs(+n || 0).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const sgn = (n, cents) => (n > 0 ? '+' : n < 0 ? '−' : '±') + usd(Math.abs(n), cents);
const day = (iso, opt = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { ...opt, timeZone: 'UTC' });
const NS = 'http://www.w3.org/2000/svg';

let token = ''; try { token = JSON.parse(localStorage.getItem('watson.token') || '""'); } catch {}
const hash = new URLSearchParams(location.hash.slice(1)).get('token'); if (hash) { token = hash; localStorage.setItem('watson.token', JSON.stringify(token)); history.replaceState(null, '', location.pathname); }
async function api(p, body) {
  const r = await fetch(p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { $('login').hidden = false; throw new Error('auth'); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
}
$('lf').onsubmit = (e) => { e.preventDefault(); token = $('tok').value.trim(); localStorage.setItem('watson.token', JSON.stringify(token)); $('login').hidden = true; boot(); };

let live = null, tw = {}, sim = null, base = null, snapshots = {}, tab = 'levers';
const sync = (text, err) => { $('sync').textContent = text; $('sync').classList.toggle('err', !!err); };

// ── Saving: debounced, so the Oracle's note always has the latest scenario ──
let saveTimer = null;
function queueSave() { clearTimeout(saveTimer); sync('saving…'); saveTimer = setTimeout(flush, 900); }
async function flush() {
  clearTimeout(saveTimer);
  try { await api('/sandbox/scenario', { tweaks: tw, summary: summary() }); sync(`saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · the Oracle will see it`); }
  catch (e) { if (e.message !== 'auth') sync('not saved: ' + e.message, true); }
}
const summary = () => sim && ({ low: sim.low, baseLow: base.low, safeDaily: sim.safeDaily, weeklyNowTotal: sim.weeklyNowTotal, weeklyLaterTotal: sim.weeklyLaterTotal, under: sim.under, cushion: sim.cushion, endPool: sim.endPool, end: sim.end, pool: sim.pool0 });

// ── Boot ──
async function boot(fresh = false) {
  sync(fresh ? 'pulling live numbers…' : 'connecting…');
  try {
    const [l, s] = await Promise.all([api('/sandbox/live' + (fresh ? '?fresh=1' : '')), live ? null : api('/sandbox/scenario')]);
    live = l;
    if (s) { tw = s.tweaks || {}; snapshots = s.snapshots || {}; }
    sync(`live as of ${new Date(live.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    buildHorizon(); buildTabs(); recompute(false); renderSnaps();
  } catch (e) { if (e.message !== 'auth') sync("couldn't load: " + e.message, true); }
}
$('refresh').onclick = () => boot(true);
$('reset').onclick = () => { if (!confirm('Throw away every tweak and go back to the live plan?')) return; tw = {}; buildHorizon(); buildTabs(); recompute(); };

function recompute(save = true) {
  const prevLow = sim?.low.v;
  sim = simulate(live, tw);
  base = simulate(live, { horizon: tw.horizon });
  renderKpis(prevLow); drawPool(); drawMonths(); renderGroups(); renderWeek(); renderInsights(); renderTicker(); markChanged();
  if (tab === 'timeline') buildTimeline();
  if (save) queueSave();
}
let resizeT; addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => sim && (drawPool(), drawMonths()), 150); });

// ── KPI tiles ──
function renderKpis(prevLow) {
  const tile = (k, v, d, cls = '', dcls = '') => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="d ${dcls}">${d}</div></div>`;
  const delta = (a, b, cents) => { const x = Math.round((a - b) * 100) / 100; return Math.abs(x) < 0.01 ? ['same as live', ''] : [`${sgn(x, cents)} vs live`, x > 0 ? 'up' : 'down']; };
  const [dl, cl] = delta(sim.low.v, base.low.v), [dd, cd] = delta(sim.safeDaily, base.safeDaily, true), [de, ce] = delta(sim.endPool, base.endPool);
  const [dp, cp] = delta(sim.pool0, base.pool0, true), [dw, cw] = delta(base.weeklyNowTotal, sim.weeklyNowTotal);
  $('kpis').innerHTML = [
    tile('POOL NOW', usd(sim.pool0, true), dp, '', cp),
    tile('LOWEST POINT', usd(sim.low.v), `${day(sim.low.date)} · ${dl}`, sim.low.v < sim.cushion ? 'bad' : '', cl),
    tile('SAFE TO SPEND / DAY', usd(sim.safeDaily, true), dd, sim.safeDaily === 0 ? 'bad' : '', cd),
    tile('WEEKLY PLAN', usd(sim.weeklyNowTotal), `from Dec 4: ${usd(sim.weeklyLaterTotal)}${dw === 'same as live' ? '' : ' · ' + dw.replace('vs live', 'room vs live')}`, sim.headroom < 0 ? 'bad' : '', cw),
    tile('DAYS UNDER CUSHION', String(sim.under), sim.under ? `first ${day(sim.firstUnder)} · cushion ${usd(sim.cushion)}` : `cushion ${usd(sim.cushion)}`, sim.under ? 'bad' : ''),
    tile('POOL AT ' + day(sim.end, { month: 'short', day: 'numeric' }).toUpperCase(), usd(sim.endPool), de, sim.endPool < 0 ? 'bad' : '', ce),
  ].join('');
  if (prevLow != null && prevLow !== sim.low.v) $('kpis').querySelectorAll('.kpi').forEach((k) => { k.classList.remove('flash'); void k.offsetWidth; k.classList.add('flash'); });
}

// ── SVG helpers ──
function el(tag, attrs = {}, parent) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (parent) parent.append(n); return n; }
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = []; for (let v = Math.floor(lo / step) * step; out.length < 20; v += step) { out.push(Math.round(v)); if (v >= hi - 1e-9) break; } return out;
}
const kfmt = (v) => (Math.abs(v) >= 1000 ? (v < 0 ? '-' : '') + '$' + (Math.abs(v) / 1000).toFixed(Math.abs(v) % 1000 ? 1 : 0) + 'k' : usd(v));

// ── Pool projection: what-if (solid) vs live plan (dashed), cushion line, paydays, low point, hover ──
function drawPool() {
  const box = $('pchart'); box.querySelector('svg')?.remove();
  const W = box.clientWidth, H = box.clientHeight, m = { l: 48, r: 14, t: 14, b: 26 };
  const S = sim.days, B = base.days, n = S.length;
  const vals = [...S.map((d) => d.pool), ...B.map((d) => d.pool), sim.cushion, 0];
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (i) => m.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r)), Y = (v) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Pool projection to ${day(sim.end)}: lowest ${usd(sim.low.v)} on ${day(sim.low.date)}` });
  const defs = el('defs', {}, svg);
  const gr = el('linearGradient', { id: 'pg', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0', 'stop-color': '#00ff41', 'stop-opacity': '.28' }, gr); el('stop', { offset: '1', 'stop-color': '#00ff41', 'stop-opacity': '0' }, gr);
  for (const t of ticks) { el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'rgba(200,255,218,.35)' : 'rgba(0,255,65,.09)' }, svg); el('text', { x: m.l - 6, y: Y(t) + 3, 'text-anchor': 'end' }, svg).textContent = kfmt(t); }
  // danger band under the cushion
  el('rect', { x: m.l, y: Y(sim.cushion), width: W - m.l - m.r, height: Math.max(0, Y(y0) - Y(sim.cushion)), fill: 'rgba(255,93,93,.06)' }, svg);
  el('line', { x1: m.l, x2: W - m.r, y1: Y(sim.cushion), y2: Y(sim.cushion), stroke: '#ff5d5d', 'stroke-dasharray': '3 4', 'stroke-width': 1 }, svg);
  // x labels: 1st and 15th of each month
  S.forEach((d, i) => { const dd = d.date.slice(8); if (dd === '01' || dd === '15' || i === 0) { el('line', { x1: X(i), x2: X(i), y1: H - m.b, y2: H - m.b + 4, stroke: 'rgba(0,255,65,.3)' }, svg); if (X(i) < W - 30) el('text', { x: X(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : 'middle' }, svg).textContent = day(d.date, { month: 'short', day: 'numeric' }); } });
  const line = (arr) => arr.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.pool).toFixed(1)}`).join('');
  el('path', { d: line(S) + `L${X(n - 1)},${Y(Math.max(y0, 0))}L${X(0)},${Y(Math.max(y0, 0))}Z`, fill: 'url(#pg)' }, svg);
  el('path', { d: line(B), fill: 'none', stroke: '#9fb8a8', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', opacity: '.8' }, svg);
  el('path', { d: line(S), fill: 'none', stroke: '#00ff41', 'stroke-width': 2, 'stroke-linejoin': 'round', style: 'filter:drop-shadow(0 0 4px rgba(0,255,65,.6))' }, svg);
  // paydays (▲ along the bottom) and big bills (▼)
  S.forEach((d, i) => {
    const inc = d.events.filter((e) => e.amount > 0).reduce((t, e) => t + e.amount, 0), out = -d.events.filter((e) => e.amount < 0).reduce((t, e) => t + e.amount, 0);
    if (inc > 0) el('path', { d: `M${X(i) - 4},${H - m.b - 1}l4,-7l4,7Z`, fill: '#8cffaa', opacity: '.8' }, svg);
    if (out >= 300) el('path', { d: `M${X(i) - 4},${m.t - 8}l8,0l-4,7Z`, fill: '#ffb020', opacity: '.85' }, svg);
  });
  // low point
  const li = S.findIndex((d) => d.date === sim.low.date);
  el('circle', { cx: X(li), cy: Y(sim.low.v), r: 5, fill: sim.low.v < sim.cushion ? '#ff5d5d' : '#00ff41', stroke: '#000', 'stroke-width': 2 }, svg);
  const lt = el('text', { x: X(li) + (X(li) > W - 90 ? -10 : 10), y: Y(sim.low.v) - 8, 'text-anchor': X(li) > W - 90 ? 'end' : 'start', style: 'fill:#c8ffda;font-size:11px' }, svg); lt.textContent = `LOW ${usd(sim.low.v)}`;
  // hover layer
  const cross = el('line', { y1: m.t, y2: H - m.b, stroke: 'rgba(200,255,218,.4)', visibility: 'hidden' }, svg);
  const dot = el('circle', { r: 4.5, fill: '#00ff41', stroke: '#000', 'stroke-width': 2, visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent', style: 'cursor:crosshair' }, svg);
  const tip = $('ptip');
  const show = (ev) => {
    const r = svg.getBoundingClientRect(); const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1)))); const d = S[i];
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(d.pool)); dot.setAttribute('visibility', 'visible');
    const evs = d.events.map((e) => `<div class="row"><span>${esc(e.label)}${e.est ? ' <span class="t">est.</span>' : ''}</span><span class="${e.amount > 0 ? 'pos' : 'neg'}">${sgn(e.amount, true)}</span></div>`).join('');
    tip.innerHTML = `<b>${day(d.date)}</b><div class="row"><span>What-if Pool</span><b>${usd(d.pool)}</b></div><div class="row t"><span>Live plan</span><span>${usd(B[i]?.pool)}</span></div>${evs || '<div class="t">No bills or paychecks.</div>'}<div class="row t"><span>Weekly budget spent</span><span>−${usd(d.spend, true)}</span></div>`;
    tip.hidden = false; const tx = X(i) + 14 + 240 > W ? X(i) - 254 : X(i) + 14; tip.style.left = Math.max(0, tx) + 'px'; tip.style.top = '8px';
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  hit.addEventListener('mousemove', show); hit.addEventListener('touchstart', show, { passive: true }); hit.addEventListener('touchmove', show, { passive: true }); hit.addEventListener('mouseleave', hide);
  box.prepend(svg);
}

// ── Month by month: money in (solid) vs money out (hatched), net in the tooltip and table ──
function drawMonths() {
  const box = $('mchart'); box.querySelector('svg')?.remove();
  const W = box.clientWidth, H = box.clientHeight, m = { l: 44, r: 6, t: 10, b: 22 };
  const rows = sim.months, k = rows.length;
  const ticks = niceTicks(0, Math.max(1, ...rows.map((r) => Math.max(r.income, r.bills + r.spend))), 4);
  const top = ticks[ticks.length - 1], Y = (v) => m.t + (1 - v / top) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Money in and out by month' });
  const pat = el('pattern', { id: 'hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('defs', {}, svg));
  el('rect', { width: 4, height: 4, fill: 'rgba(140,255,170,.08)' }, pat); el('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: 'rgba(140,255,170,.55)', 'stroke-width': 1.5 }, pat);
  for (const t of ticks) { el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: 'rgba(0,255,65,.09)' }, svg); el('text', { x: m.l - 5, y: Y(t) + 3, 'text-anchor': 'end' }, svg).textContent = kfmt(t); }
  const slot = (W - m.l - m.r) / Math.max(1, k), bw = Math.min(26, slot * 0.32);
  const tip = $('mtip');
  rows.forEach((r, i) => {
    const cx = m.l + slot * (i + 0.5), out = r.bills + r.spend;
    const bar = (x, v, attrs) => el('path', { d: `M${x},${Y(0)}V${Y(v) + 4}q0,-4 4,-4h${bw - 8}q4,0 4,4V${Y(0)}Z`, ...attrs }, svg);
    if (r.income > 0) bar(cx - bw - 1, r.income, { fill: '#00ff41' });
    if (out > 0) bar(cx + 1, out, { fill: 'url(#hatch)', stroke: '#8cffaa', 'stroke-width': 1.5 });
    el('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = new Date(r.month + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + (i === 0 ? '*' : '');
    const hit = el('rect', { x: cx - slot / 2, y: m.t, width: slot, height: H - m.t - m.b, fill: 'transparent' }, svg);
    const show = () => { tip.innerHTML = `<b>${day(r.month + '-15', { month: 'long', year: 'numeric' })}${i === 0 ? ' (from today)' : ''}</b><div class="row"><span>In</span><span class="pos">${usd(r.income)}</span></div><div class="row"><span>Bills & goals</span><span>${usd(r.bills)}</span></div><div class="row"><span>Weekly budget</span><span>${usd(r.spend)}</span></div><div class="row"><span>Net</span><b>${sgn(r.net)}</b></div>`; tip.hidden = false; tip.style.left = Math.min(W - 200, Math.max(0, cx - 90)) + 'px'; tip.style.top = '0px'; };
    hit.addEventListener('mouseenter', show); hit.addEventListener('touchstart', show, { passive: true }); hit.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
  box.prepend(svg);
  $('mtable').innerHTML = rows.map((r) => `${day(r.month + '-15', { month: 'short' })} net <b style="color:${r.net < 0 ? 'var(--amber)' : 'var(--g2)'}">${sgn(r.net)}</b>`).join(' · ') + ' <span class="dim">(* partial month)</span>';
}

// ── Where it goes (single hue, longest first) and this week's categories ──
function renderGroups() {
  const max = Math.max(1, ...sim.groups.map((g) => g.total));
  const baseOf = Object.fromEntries(base.groups.map((g) => [g.name, g.total]));
  $('gwin').textContent = `to ${day(sim.end, { month: 'short', day: 'numeric' })}`;
  $('groups').innerHTML = sim.groups.map((g) => { const d = g.total - (baseOf[g.name] || 0); return `<div class="b" title="${esc(g.name)}: ${usd(g.total)}${Math.abs(d) >= 1 ? ` (${sgn(d)} vs live)` : ''}"><span class="n">${esc(g.name)}</span><span class="track"><span class="fill" style="width:${(g.total / max * 100).toFixed(1)}%"></span></span><span class="val">${usd(g.total)}${Math.abs(d) >= 1 ? `<br><span class="dim">${sgn(d)}</span>` : ''}</span></div>`; }).join('');
}
const catName = (k) => tw.weekly?.[k]?.label || LABELS[k] || k;
function renderWeek() {
  $('wkend').textContent = `through ${day(sim.weekEnd)}`;
  const rows = Object.entries(sim.weeklyNow).filter(([k]) => k !== '__probe');
  const max = Math.max(1, ...rows.map(([k, v]) => Math.max(v, sim.spentWeek[k] || 0)));
  $('week').innerHTML = rows.map(([k, v]) => { const s = sim.spentWeek[k] || 0, over = s > v + 0.5;
    return `<div class="b" title="${esc(catName(k))}: spent ${usd(s, true)} of ${usd(v)}"><span class="n">${esc(catName(k))}</span><span class="track"><span class="fill" style="width:${(v / max * 100).toFixed(1)}%;opacity:.35"></span><span class="fill ${over ? 'over' : 'spent'}" style="width:${(Math.min(s, max) / max * 100).toFixed(1)}%"></span></span><span class="val">${usd(s)} / ${usd(v)}</span></div>`; }).join('')
    + `<p class="note">Left this week: ${usd(sim.leftThisWeek, true)}. Bright = spent, faint = the week's amount, red = over.</p>`;
}

function renderInsights() {
  $('insights').innerHTML = insights(live, tw, sim, base).map((x) => `<li class="${x.level}">${esc(x.text)}</li>`).join('');
}
function renderTicker() {
  const items = [`<b>POOL</b> ${usd(sim.pool0, true)}`, `<b>LOW</b> ${usd(sim.low.v)} ${day(sim.low.date).toUpperCase()}`, `<b>SAFE/DAY</b> ${usd(sim.safeDaily, true)}`, `<b>WEEKLY</b> ${usd(sim.weeklyNowTotal)}`,
    ...sim.days.slice(0, 14).flatMap((d) => d.events.filter((e) => Math.abs(e.amount) >= 100).map((e) => `${day(d.date).toUpperCase()} ${esc(e.label.toUpperCase())} ${sgn(e.amount)}`)),
    sim.under ? `<b>⚠ ${sim.under} DAYS UNDER CUSHION</b>` : 'NEVER UNDER THE CUSHION', 'THERE IS NO SPOON. ONLY MATH.'];
  $('ticker').innerHTML = items.join('<i>◆</i>');
}

// ── Horizon ──
function buildHorizon() {
  const endData = dataEnd(live), opts = [[live.horizon, `${day(live.horizon, { month: 'short', day: 'numeric' })} (live plan)`]];
  for (const iso of ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']) if (iso > live.horizon && iso <= endData) opts.push([iso, day(iso, { month: 'short', day: 'numeric', year: 'numeric' })]);
  if (!opts.some(([v]) => v === endData) && endData > live.horizon) opts.push([endData, day(endData, { month: 'short', day: 'numeric', year: 'numeric' }) + ' (data ends)']);
  $('horizon').innerHTML = opts.map(([v, t]) => `<option value="${v}" ${(tw.horizon || live.horizon) === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
$('horizon').onchange = (e) => { tw.horizon = e.target.value === live.horizon ? undefined : e.target.value; recompute(); };

// ── Controls ──
document.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + tab; }); buildTab(tab); };
function buildTabs() { for (const t of ['levers', 'weekly', 'bills', 'goals', 'extras']) buildTab(t); if (tab === 'timeline') buildTimeline(); }
function buildTab(t) { ({ levers: buildLevers, weekly: buildWeekly, bills: buildBills, goals: buildGoals, extras: buildExtras, timeline: buildTimeline })[t](); }
const set = (obj, path, v) => { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; if (v === undefined || v === '' || Number.isNaN(v)) delete o[ks.at(-1)]; else o[ks.at(-1)] = v; };
const tidy = () => { for (const k of ['weekly', 'bills', 'goals', 'off']) { if (!tw[k]) continue; for (const [n, v] of Object.entries(tw[k])) if (v && typeof v === 'object' && !Object.keys(v).length) delete tw[k][n]; if (!Object.keys(tw[k]).length) delete tw[k]; } };
const num = (v) => (v === '' || v == null ? undefined : +v);

function lever(id, label, liveVal, min, max, step, hint = '') {
  return `<div class="lv" data-lv="${id}"><span class="lab">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${tw[id] ?? liveVal}" data-k="${id}"><span><input type="number" step="${step}" value="${tw[id] ?? ''}" placeholder="${liveVal}" data-k="${id}"> <button data-reset="${id}" title="Back to live">↺</button></span><span class="live">live: ${esc(hint || usd(liveVal, true))}</span></div>`;
}
function buildLevers() {
  const lastZelle = live.events.find((e) => e.type === 'income' && /Horace/.test(e.label));
  $('tab-levers').innerHTML = lever('pool', 'Starting Pool', live.pool, -500, 5000, 1)
    + lever('cushion', 'Cushion (never below)', live.cushion, 0, 1000, 5)
    + lever('taylorPay', "Taylor's paycheck (each Friday)", 1216, 0, 2500, 1)
    + lever('horaceAdj', "Horace's zelle (+/− each one)", 0, -1000, 1000, 5, `$0 change; next zelle ${lastZelle ? usd(lastZelle.amount) + ' on ' + day(lastZelle.date) : 'n/a'}`)
    + '<p class="note">Drag or type. ↺ puts a lever back to the live number. Paychecks past the live plan\'s end are estimates.</p>';
}
$('tab-levers').addEventListener('input', (e) => {
  const k = e.target.dataset.k; if (!k) return;
  const v = num(e.target.value); set(tw, k, v);
  const row = e.target.closest('.lv'); row.querySelectorAll('[data-k]').forEach((x) => { if (x !== e.target) x.value = x.type === 'range' ? (v ?? x.closest('.lv').querySelector('[type=number]').placeholder) : (v ?? ''); });
  recompute();
});
$('tab-levers').addEventListener('click', (e) => { const k = e.target.dataset.reset; if (!k) return; delete tw[k]; buildLevers(); recompute(); });

function weeklyKeys() {
  const keys = new Set(); for (const p of live.phases || []) Object.keys(p.targets).forEach((k) => keys.add(k));
  Object.keys(tw.weekly || {}).forEach((k) => keys.add(k)); return [...keys];
}
function buildWeekly() {
  const ph = live.phases || [], p1 = ph[0]?.targets || {}, p2 = ph[ph.length - 1]?.targets || {};
  const rows = weeklyKeys().map((k) => { const o = tw.weekly?.[k] || {}, custom = !!o.custom;
    const nowLive = custom ? '' : p1[k] ?? 0, laterLive = custom ? '' : p2[k] ?? 0;
    return `<tr data-w="${esc(k)}" class="${o.now != null || o.later != null ? 'changed' : ''}"><td>${esc(catName(k))}${custom ? ' <span class="dim">(added)</span>' : ''}</td>
      <td><input type="range" min="0" max="300" step="1" value="${o.now ?? nowLive}" data-f="now"></td>
      <td><input type="number" min="0" step="1" value="${o.now ?? ''}" placeholder="${nowLive}" data-f="now"></td>
      <td><input type="number" min="0" step="1" value="${o.later ?? ''}" placeholder="${custom ? 'same' : laterLive}" data-f="later"></td>
      <td>${custom ? `<button data-del="${esc(k)}" title="Remove">✕</button>` : `<button data-wreset="${esc(k)}" title="Back to live">↺</button>`}</td></tr>`; }).join('');
  $('tab-weekly').innerHTML = `<table class="t"><tr><th>CATEGORY</th><th>NOW (PER WEEK)</th><th></th><th>FROM DEC 4</th><th></th></tr>${rows}</table>
    <div class="add">Add a category <input id="wn" placeholder="Fast Food"> $<input id="wa" type="number" min="0" placeholder="25">/wk <button id="wadd">Add</button></div>
    <p class="note">Weeks run Friday to Thursday. This week only counts what's left in each category.</p>`;
}
$('tab-weekly').addEventListener('input', (e) => {
  const tr = e.target.closest('[data-w]'); if (!tr || !e.target.dataset.f) return;
  const k = tr.dataset.w, f = e.target.dataset.f, v = num(e.target.value);
  setNamed('weekly', k, f, v); if (tw.weekly?.[k]?.custom && f === 'now' && v === undefined) tw.weekly[k].now = 0;
  if (f === 'now') tr.querySelectorAll('[data-f=now]').forEach((x) => { if (x !== e.target) x.value = x.type === 'range' ? (v ?? x.closest('tr').querySelector('[type=number][data-f=now]').placeholder) : (v ?? ''); });
  tidy(); recompute();
});
$('tab-weekly').addEventListener('click', (e) => {
  if (e.target.id === 'wadd') { const name = $('wn').value.trim(), amt = +$('wa').value; if (!name || !(amt >= 0)) return; (tw.weekly ??= {})[name] = { now: amt, custom: true, label: name }; buildWeekly(); recompute(); return; }
  const d = e.target.dataset.del || e.target.dataset.wreset; if (!d) return; delete tw.weekly[d]; tidy(); buildWeekly(); recompute();
});

function billList() {
  const by = new Map();
  for (const e of live.events) if (e.type === 'bill') { const b = by.get(e.label) || { name: e.label, first: e.date, amount: -e.amount, count: 0 }; b.count += 1; by.set(e.label, b); }
  return [...by.values()].sort((a, b) => a.first.localeCompare(b.first));
}
function buildBills() {
  $('tab-bills').innerHTML = `<table class="t"><tr><th>BILL</th><th>NEXT</th><th>AMOUNT</th><th>SHIFT DAYS</th><th>ON</th></tr>${billList().map((b) => { const t = tw.bills?.[b.name] || {}, lock = LOCKED.test(b.name);
    return `<tr data-b="${esc(b.name)}" class="${lock ? 'locked' : ''} ${t.off ? 'off' : ''} ${Object.keys(t).length ? 'changed' : ''}"><td>${lock ? '🔒 ' : ''}${esc(b.name)}</td><td>${day(b.first, { month: 'short', day: 'numeric' })}</td>
      <td>${lock ? usd(b.amount, true) : `<input type="number" min="0" step="0.01" value="${t.amount ?? ''}" placeholder="${b.amount}" data-f="amount">`}</td>
      <td>${lock ? '—' : `<input class="sh" type="number" step="1" value="${t.shift ?? ''}" placeholder="0" data-f="shift">`}</td>
      <td>${lock ? '' : `<input type="checkbox" ${t.off ? '' : 'checked'} data-f="on">`}</td></tr>`; }).join('')}</table>
    <p class="note">An amount or shift applies to every time that bill comes up. Turn one off to see life without it. 🔒 Debt Consolidation never moves.</p>`;
}
$('tab-bills').addEventListener('input', (e) => {
  const tr = e.target.closest('[data-b]'); const f = e.target.dataset.f; if (!tr || !f) return;
  const n = tr.dataset.b;
  if (f === 'on') setNamed('bills', n, 'off', e.target.checked ? undefined : true); else setNamed('bills', n, f, num(e.target.value) || undefined);
  tr.classList.toggle('off', !!tw.bills?.[n]?.off); tr.classList.toggle('changed', !!tw.bills?.[n]); recompute();
});
// Bill names can contain dots, so bills/goals use their own setter instead of a dotted path.
function setNamed(group, name, field, v) { tw[group] ??= {}; const o = tw[group][name] ??= {}; if (v === undefined || v === '') delete o[field]; else o[field] = v; tidy(); }

function goalList() { const by = new Map(); for (const e of live.events) if (e.type === 'goal' && !by.has(e.label)) by.set(e.label, { name: e.label, date: e.date, amount: -e.amount }); return [...by.values()]; }
function buildGoals() {
  const goals = goalList();
  $('tab-goals').innerHTML = goals.length ? `<table class="t"><tr><th>GOAL</th><th>AMOUNT LEFT</th><th>DATE</th><th>ON</th><th></th></tr>${goals.map((g) => { const t = tw.goals?.[g.name] || {};
    return `<tr data-g="${esc(g.name)}" class="${t.off ? 'off' : ''} ${Object.keys(t).length ? 'changed' : ''}"><td>${esc(g.name)}</td><td><input type="number" min="0" step="1" value="${t.amount ?? ''}" placeholder="${g.amount}" data-f="amount"></td><td><input type="date" value="${t.date ?? g.date}" data-f="date"></td><td><input type="checkbox" ${t.off ? '' : 'checked'} data-f="on"></td><td><button data-gmax="${esc(g.name)}">Max safe</button></td></tr>`; }).join('')}</table><p class="note">Amount left is what still has to come out of the Pool by that date.</p>` : '<p class="note">No active savings goals in the plan.</p>';
  $('s-goal').innerHTML = goals.map((g) => `<option>${esc(g.name)}</option>`).join('');
}
$('tab-goals').addEventListener('input', (e) => {
  const tr = e.target.closest('[data-g]'); const f = e.target.dataset.f; if (!tr || !f) return; const n = tr.dataset.g;
  const g = goalList().find((x) => x.name === n);
  if (f === 'on') setNamed('goals', n, 'off', e.target.checked ? undefined : true);
  else if (f === 'date') setNamed('goals', n, 'date', e.target.value && e.target.value !== g.date ? e.target.value : undefined);
  else setNamed('goals', n, 'amount', num(e.target.value));
  tr.classList.toggle('off', !!tw.goals?.[n]?.off); tr.classList.toggle('changed', !!tw.goals?.[n]); recompute();
});
$('tab-goals').addEventListener('click', (e) => { const n = e.target.dataset.gmax; if (n) solveGoal(n); });

const PRESETS = [
  { label: 'Fast Food', amount: -25, repeat: 'weekly', note: 'the plan from 11/4' },
  { label: "Taylor's raise", amount: 100, repeat: 'weekly' },
  { label: 'Truck payment', amount: -350, repeat: 'monthly' },
  { label: 'Tax refund', amount: 1500, repeat: 'once', date: '2027-02-15' },
  { label: 'Tooth repair', amount: -800, repeat: 'once' },
];
function buildExtras() {
  const xs = tw.extras || [];
  $('tab-extras').innerHTML = `<table class="t"><tr><th>WHAT-IF</th><th>IN/OUT</th><th>AMOUNT</th><th>STARTS</th><th>REPEATS</th><th></th></tr>${xs.map((x) => `<tr data-x="${esc(x.id)}" class="changed"><td><input value="${esc(x.label)}" data-f="label"></td>
    <td><select data-f="dir"><option value="out" ${x.amount < 0 ? 'selected' : ''}>Out</option><option value="in" ${x.amount > 0 ? 'selected' : ''}>In</option></select></td>
    <td><input type="number" min="0" step="0.01" value="${Math.abs(x.amount)}" data-f="amount"></td><td><input type="date" value="${x.date}" data-f="date"></td>
    <td><select data-f="repeat">${['once', 'weekly', 'monthly'].map((r) => `<option ${x.repeat === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td><button data-xdel="${esc(x.id)}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="dim">Nothing yet. Add one below or tap a quick idea.</td></tr>'}</table>
    <div class="add"><button id="xadd">+ Add a what-if</button> Quick ideas: ${PRESETS.map((p, i) => `<button data-preset="${i}">${esc(p.label)} ${sgn(p.amount)}${p.repeat === 'once' ? '' : '/' + (p.repeat === 'weekly' ? 'wk' : 'mo')}</button>`).join(' ')}</div>
    <p class="note">For pretend money in or out: a raise, a new bill, a side gig, a big purchase.</p>`;
}
const newId = () => Math.random().toString(36).slice(2, 8);
$('tab-extras').addEventListener('click', (e) => {
  if (e.target.id === 'xadd') { (tw.extras ??= []).push({ id: newId(), label: 'New what-if', amount: -50, date: addDays(live.today, 1), repeat: 'once' }); buildExtras(); recompute(); return; }
  const p = PRESETS[e.target.dataset.preset]; if (p) { (tw.extras ??= []).push({ id: newId(), label: p.label, amount: p.amount, date: p.date || addDays(live.today, 1), repeat: p.repeat }); buildExtras(); recompute(); return; }
  const d = e.target.dataset.xdel; if (d) { tw.extras = tw.extras.filter((x) => x.id !== d); if (!tw.extras.length) delete tw.extras; buildExtras(); recompute(); }
});
$('tab-extras').addEventListener('input', (e) => {
  const tr = e.target.closest('[data-x]'); const f = e.target.dataset.f; if (!tr || !f) return;
  const x = tw.extras.find((y) => y.id === tr.dataset.x);
  if (f === 'label') x.label = e.target.value.slice(0, 60);
  if (f === 'amount' || f === 'dir') { const a = Math.abs(+tr.querySelector('[data-f=amount]').value || 0); x.amount = tr.querySelector('[data-f=dir]').value === 'in' ? a : -a; }
  if (f === 'date' && e.target.value) x.date = e.target.value;
  if (f === 'repeat') x.repeat = e.target.value;
  recompute();
});

function buildTimeline() {
  if (!sim) return;
  const days = sim.days.filter((d) => d.events.length || d.date === sim.low.date);
  const offEvs = sim.events.filter((e) => e.off);
  $('tab-timeline').innerHTML = `<div class="tl">${days.map((d) => `<div class="day ${d.date === sim.low.date ? 'low' : ''}"><div class="dh"><span>${day(d.date)}${d.date === sim.low.date ? ' · LOW POINT' : ''}</span><b>${usd(d.pool)}</b></div>${d.events.map((e) => evRow(e)).join('')}</div>`).join('')}</div>`
    + (offEvs.length ? `<h3>TURNED OFF</h3><div class="tl">${offEvs.map((e) => `<div class="day">${evRow(e)}</div>`).join('')}</div>` : '')
    + '<p class="note">Untick anything to see the plan without it (a skipped paycheck, a bill you might drop). 🔒 items never move.</p>';
}
function evRow(e) {
  const lock = LOCKED.test(e.label) || e.type === 'extra';
  return `<label class="${e.off ? 'off' : ''}"><span>${lock ? (e.type === 'extra' ? '✦ ' : '🔒 ') : `<input type="checkbox" ${e.off ? '' : 'checked'} data-key="${esc(e.key)}"> `}${esc(e.label)}${e.est ? ' <span class="est">est.</span>' : ''}${e.off ? ` <span class="est">${esc(day(e.date, { month: 'short', day: 'numeric' }))}</span>` : ''}</span><span>${sgn(e.amount, true)}</span></label>`;
}
$('tab-timeline').addEventListener('change', (e) => {
  const k = e.target.dataset.key; if (!k) return;
  tw.off ??= {}; if (e.target.checked) delete tw.off[k]; else tw.off[k] = true; tidy(); recompute();
});

function markChanged() {
  document.querySelectorAll('#tab-levers .lv').forEach((r) => r.classList.toggle('changed', tw[r.dataset.lv] != null));
  document.querySelectorAll('#tab-weekly tr[data-w]').forEach((r) => { const o = tw.weekly?.[r.dataset.w]; r.classList.toggle('changed', !!o && (o.now != null || o.later != null)); });
  const n = Object.keys(tw).filter((k) => k !== 'horizon').reduce((t, k) => t + (typeof tw[k] === 'object' ? Object.keys(tw[k]).length : 1), 0);
  $('reset').textContent = n ? `Reset to live (${n})` : 'Reset to live';
}

// ── Solvers ──
const sout = (html) => { $('s-out').innerHTML = html; };
$('s-weekly').onclick = () => {
  const v = solve.extraWeekly(live, tw);
  sout(v == null ? `Nothing extra fits: the plan already dips under the cushion. Trim something first.` : `You could add up to <b>${usd(v)}/week</b> on top of today's plan and never go under ${usd(sim.cushion)}. <button id="s-weekly-add">Add it as a category</button>`);
  const b = $('s-weekly-add'); if (b) b.onclick = () => { const name = prompt('Name the new weekly category', 'Fast Food'); if (!name) return; (tw.weekly ??= {})[name] = { now: v, custom: true, label: name }; buildWeekly(); recompute(); sout(`Added ${esc(name)} at ${usd(v)}/week.`); };
};
function solveGoal(name) {
  const v = solve.goalMax(live, tw, name);
  sout(v == null ? `Even at $0 the plan dips under the cushion, so "${esc(name)}" can't grow until something else gives.` : `"${esc(name)}" can be as big as <b>${usd(v)}</b> on its date without dipping under the cushion. <button id="s-goal-apply">Use ${usd(v)}</button>`);
  const b = $('s-goal-apply'); if (b) b.onclick = () => { setNamed('goals', name, 'amount', v); buildGoals(); recompute(); sout(`Set "${esc(name)}" to ${usd(v)} in the what-if.`); };
}
$('s-goal-go').onclick = () => { if ($('s-goal').value) solveGoal($('s-goal').value); };
$('s-amt-go').onclick = () => {
  const a = Math.abs(+$('s-amt').value); if (!a) return;
  const d = solve.earliest(live, tw, a);
  sout(d ? `The earliest a ${usd(a)} buy fits is <b>${day(d)}</b>, and the Pool stays above ${usd(sim.cushion)} the whole way. <button id="s-amt-add">Add it as a what-if</button>` : `A ${usd(a)} buy doesn't fit anywhere before ${day(sim.end)} without going under the cushion. Try a later "Run to" date.`);
  const b = $('s-amt-add'); if (b) b.onclick = () => { (tw.extras ??= []).push({ id: newId(), label: `${usd(a)} buy`, amount: -a, date: d, repeat: 'once' }); buildExtras(); recompute(); sout('Added.'); };
};
$('s-date-go').onclick = () => {
  const d = $('s-date').value; if (!d) return;
  const v = solve.buyMax(live, tw, d < live.today ? live.today : d);
  sout(v == null ? 'Nothing fits that day: the plan already dips under the cushion.' : `The biggest one-time buy on ${day(d)} is <b>${usd(v)}</b>.`);
};
$('s-date').min = new Date().toISOString().slice(0, 10);

// ── Ask the Oracle (her answer shows here and on her page) ──
const say = (text, me) => { const d = document.createElement('div'); d.className = 'a' + (me ? ' me' : ''); d.textContent = text; $('answers').prepend(d); };
let poll = null;
async function ask(q) {
  say(q, true);
  try {
    await flush();
    const r = await api('/sandbox/ask', { question: q, tweaks: tw, summary: summary() });
    say('Sent. The Oracle is looking at your what-if…');
    let since = r.at, tries = 0; clearInterval(poll);
    poll = setInterval(async () => {
      tries += 1; if (tries > 80) { clearInterval(poll); return; }
      try { const x = await api('/sandbox/replies?since=' + encodeURIComponent(since)); for (const m of x.replies) { say(m.text); since = m.at; } if (x.replies.length && !x.busy) clearInterval(poll); } catch {}
    }, 3000);
  } catch (e) { if (e.message !== 'auth') say("Couldn't reach the Oracle: " + e.message); }
}
$('ask').onsubmit = (e) => { e.preventDefault(); const q = $('q').value.trim(); if (q) { $('q').value = ''; ask(q); } };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('mic').hidden = true; else {
  let rec = null;
  $('mic').onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
    rec.onresult = (ev) => { const t = [...ev.results].map((r) => r[0].transcript).join(' '); $('q').value = t; if (ev.results[ev.results.length - 1].isFinal) { $('q').value = ''; ask(t); } };
    rec.onend = () => { rec = null; $('mic').classList.remove('on'); };
    $('mic').classList.add('on'); rec.start();
  };
}

// ── Snapshots ──
function renderSnaps() {
  $('snaps').innerHTML = Object.entries(snapshots).map(([n, s]) => `<span class="s" title="Saved ${esc(new Date(s.at).toLocaleString())}${s.summary?.low ? ` · low ${usd(s.summary.low.v)}` : ''}">${esc(n)}<button data-load="${esc(n)}">Load</button><button data-sdel="${esc(n)}">✕</button></span>`).join('') || '<span class="dim">Save a scenario to come back to it or compare later.</span>';
}
$('snapsave').onclick = async () => { const n = $('snapname').value.trim(); if (!n) return; await flush(); snapshots = (await api('/sandbox/snapshot', { action: 'save', name: n })).snapshots; $('snapname').value = ''; renderSnaps(); };
$('snaps').onclick = async (e) => {
  const l = e.target.dataset.load, d = e.target.dataset.sdel;
  if (l) { tw = JSON.parse(JSON.stringify(snapshots[l].tweaks || {})); buildHorizon(); buildTabs(); recompute(); sync(`loaded "${l}"`); }
  if (d && confirm(`Delete the snapshot "${d}"?`)) { snapshots = (await api('/sandbox/snapshot', { action: 'delete', name: d })).snapshots; renderSnaps(); }
};

boot();
