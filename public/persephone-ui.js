// Persephone's ledger panels (2026-11-06): the Tables, the Schedule, the Patterns, the Emails, the HUD and a
// drawer for one table up close. Data comes from the server ('casino' events, built by server/persephone.js);
// every edit here is a real change in the Wolf Hall app (casino_do), and Persephone hears about it on her
// next turn. The 3D salon (persephone-scene.js) gets the same data through 'ps:data'.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => window.agentApp;
const TZ = 'America/Chicago';
const fmt = (n) => (n == null ? '—' : (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const clock = (t) => { const h = Number(t.slice(0, 2)), m = t.slice(3); return `${(h % 12) || 12}${m === '00' ? '' : ':' + m} ${h < 12 ? 'AM' : 'PM'}`; };
const hourLabel = (h) => `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

let data = null, openId = null, ref = 0, typing = false, pending = false;
const sched = {}; // siteId -> draft alert-time text on the Schedule tab

// ── Talking to the server ──
function get() { app()?.send({ type: 'casino_get' }); }
function act(action, args, okMsg) { app()?.send({ type: 'casino_do', action, args, ref: ++ref }); toast(okMsg || 'Saving…'); }
function ask(text) { if (app()?.ask(text)) toast('Asked Persephone'); }
function toast(msg, bad) {
  const t = $('ps-toast'); t.textContent = msg; t.className = 'ps-toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3800);
}
let getTimer = null;
const refreshSoon = () => { clearTimeout(getTimer); getTimer = setTimeout(get, 400); };
// This module loads after the 3D scene, so the connection's 'welcome' can come and go before it listens
// (2026-11-07: Horace's tables never arrived). Ask now if already connected, and keep asking until data comes.
if (app()?.connected?.()) get();
const firstData = setInterval(() => { if (data) clearInterval(firstData); else if (app()?.connected?.()) get(); }, 3000);

window.addEventListener('agent:event', (e) => {
  const ev = e.detail;
  if (ev.type === 'welcome') get();
  else if (ev.type === 'casino') { data = ev.data; if (typing) pending = true; else renderAll(); }
  else if (ev.type === 'casino_changed') refreshSoon();
  else if (ev.type === 'casino_result') { toast(ev.message, !ev.ok); if (ev.ok) refreshSoon(); }
  else if (ev.type === 'say' || ev.type === 'busy') { if (ev.type === 'busy' && !ev.busy) refreshSoon(); }
});
// Keep countdowns honest, and pick up claims made on the phone.
setInterval(() => { if (data && !typing) window.dispatchEvent(new CustomEvent('ps:data', { detail: { run: data.run } })); }, 60000);
setInterval(get, 3 * 60000);
document.addEventListener('focusin', (e) => { if (e.target.matches('.ps-pane input, .ps-pane textarea, .ps-pane select, .ps-drawer input, .ps-drawer textarea, .ps-drawer select')) typing = true; });
document.addEventListener('focusout', () => { typing = false; if (pending) { pending = false; setTimeout(() => { if (!typing) renderAll(); }, 200); } });

function renderAll() {
  if (!data) return;
  window.dispatchEvent(new CustomEvent('ps:data', { detail: { run: data.run } }));
  renderHud(); renderTables(); renderSchedule(); renderPatterns(); renderEmails();
  if (openId) openDrawer(openId);
}

// ── HUD ──
function renderHud() {
  const r = data.run;
  $('hud-sc').textContent = `${r.saved.estimated ? '~' : ''}${fmt(r.saved.sc)}`;
  $('hud-ready').innerHTML = `${r.counts.readyNow}<small>/${r.counts.active}</small>`;
  $('hud-today').textContent = r.counts.claimedToday;
  $('hud-month').textContent = fmt(r.sc.thisMonth);
}

// ── Tables ──
function statusOf(s) {
  if (s.ready) return `<span class="ps-ready">● Ready to collect</span>${s.streakAtRisk ? ' <span class="ps-warn">streak on the line</span>' : ''}`;
  if (s.readyAt) { const ms = Date.parse(s.readyAt) - Date.now(), m = Math.max(1, Math.ceil(ms / 60000)); return `Next in ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`}`; }
  return 'Collected';
}
function renderTables() {
  const r = data.run;
  let h = `<div class="ps-section-head"><h4>The tables</h4><span>${r.counts.active} sites · ${r.counts.readyNow} ready · ${fmt(r.saved.sc)} SC saved</span></div>`;
  h += '<ul class="ps-list">' + r.sites.map((s) => `
    <li class="ps-site${s.ready ? ' ready' : ''}" data-id="${s.id}">
      <div class="ps-site-main">
        <button class="ps-name" data-open="${s.id}" title="Sit down at this table">${esc(s.name)}</button>
        <div class="ps-sub">${statusOf(s)}${s.alertTimes?.length ? ` · 🔔 ${s.alertTimes.map(clock).join(', ')}` : ''}${s.minRedeemSc ? ` · redeem at ${fmt(s.minRedeemSc)}` : ''}</div>
      </div>
      <form class="ps-bal" data-bal="${s.id}" title="SC balance: type what the site shows and press Enter">
        <input name="sc" type="number" step="any" min="0" inputmode="decimal" value="${s.scBalance ?? ''}" placeholder="SC" aria-label="${esc(s.name)} SC balance">
        <small>${s.scEstimated ? `~${fmt(s.scSaved)} now` : 'SC'}</small>
      </form>
      ${s.url ? `<a class="ps-go" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open the site">↗</a>` : ''}
    </li>`).join('') + '</ul>';
  if (r.paused?.length) h += `<div class="ps-paused"><b>Off the floor:</b> ${r.paused.map((p) => `${esc(p.name)} <span class="ps-muted">(${esc(p.status)})</span> <button class="ps-link" data-restore="${p.id}">bring back</button>`).join(' · ')}</div>`;
  h += `<details class="ps-add"><summary>Add a table</summary>
    <form id="ps-add-form" class="ps-form">
      <label>Name<input name="name" required maxlength="60" placeholder="e.g. Crown Coins"></label>
      <label>Link<input name="url" type="url" required placeholder="https://…"></label>
      <label>Bonus resets<select name="resetRule"><option>Daily</option><option>Rolling 24h</option><option>Every N Hours</option></select></label>
      <label>At hour (0–23, Central)<input name="resetHour" type="number" min="0" max="23" placeholder="0"></label>
      <label>Every … hours<input name="everyHours" type="number" min="1" max="168" placeholder="for Every N Hours"></label>
      <button class="primary" type="submit">Seat it</button>
    </form></details>`;
  $('ps-tables').innerHTML = h;
}
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.matches('[data-bal]')) {
    e.preventDefault();
    const v = f.sc.value.trim(); if (v === '') return;
    act('balance', { siteId: f.dataset.bal, sc: Number(v) }, 'Saving the balance…'); f.sc.blur();
  } else if (f.id === 'ps-add-form') {
    e.preventDefault();
    const a = Object.fromEntries(new FormData(f)); for (const k of Object.keys(a)) if (a[k] === '') delete a[k];
    act('add', a, `Seating ${a.name}…`); f.reset();
  } else if (f.id === 'ps-drawer-form') {
    e.preventDefault();
    const a = Object.fromEntries(new FormData(f)), s = site(openId); if (!s) return;
    const fields = {};
    if (a.name && a.name !== s.name) fields.name = a.name;
    if (a.url && a.url !== s.url) fields.url = a.url;
    if ((a.notes || '') !== (s.notes || '')) fields.notes = a.notes || '';
    if (a.resetRule !== s.resetRule) fields.resetRule = a.resetRule;
    if (a.resetHour !== '' && Number(a.resetHour) !== s.resetHour) fields.resetHour = Number(a.resetHour);
    if (a.everyHours !== '' && Number(a.everyHours) !== s.everyHours) fields.everyHours = Number(a.everyHours);
    if (a.minRedeemSc !== '' && Number(a.minRedeemSc) !== s.minRedeemSc) fields.minRedeemSc = Number(a.minRedeemSc);
    if (Object.keys(fields).length) act('edit', { siteId: s.id, fields }, 'Saving…');
    if (a.sc !== '' && Number(a.sc) !== s.scBalance) act('balance', { siteId: s.id, sc: Number(a.sc) }, 'Saving…');
    const times = parseTimes(a.alerts);
    if (times.error) return toast(times.error, true);
    if (times.list.join() !== (s.alertTimes || []).join()) act('alerts', { siteId: s.id, times: times.list }, 'Setting the alerts…');
  }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, [data-open]'); if (!b) return;
  if (b.dataset.open) { openDrawer(b.dataset.open); window.dispatchEvent(new CustomEvent('ps:focus', { detail: { siteId: b.dataset.open } })); }
  else if (b.dataset.restore) act('restore', { siteId: b.dataset.restore }, 'Bringing it back…');
  else if (b.dataset.chip) addChip(b.dataset.chip, b.dataset.time);
  else if (b.id === 'ps-sched-all') applyAll();
  else if (b.id === 'ps-sched-save') saveSchedule();
  else if (b.id === 'ps-ask-patterns') ask('Look at my casino patterns and tell me what stands out. Put the details on your display.');
  else if (b.id === 'ps-ask-schedule') ask('Help me set all my alert times in one go. Ask me everything at once.');
  else if (b.id === 'ps-sync') { app()?.send({ type: 'ask', text: 'Sync your claim history from the app, quietly, then tell me in one line how many claims you have on file.' }); toast('Asked Persephone to sync'); }
  else if (b.id === 'ps-close') closeDrawer();
  else if (b.id === 'ps-remove' || b.id === 'ps-close-site') { const s = site(openId); if (s && confirm(`Take ${s.name} off the floor? (${b.id === 'ps-remove' ? 'Paused: it can come back' : 'Closed: done with it'}. Its history stays.)`)) { act('remove', { siteId: s.id, status: b.id === 'ps-remove' ? 'Paused' : 'Closed' }); closeDrawer(); } }
  else if (b.id === 'ps-collected') { const s = site(openId); if (s) act('collected', { siteId: s.id }, `Marking ${s.name} collected…`); }
  else if (b.id === 'ps-prev' || b.id === 'ps-next') window.dispatchEvent(new CustomEvent('ps:step', { detail: { dir: b.id === 'ps-prev' ? -1 : 1 } }));
  else if (b.id === 'ps-overview') { closeDrawer(); window.dispatchEvent(new CustomEvent('ps:focus', { detail: { siteId: null } })); }
  else if (b.id === 'ps-explore' || b.id === 'ps-explore-exit') { closeDrawer(); window.dispatchEvent(new CustomEvent('ps:explore', { detail: { on: b.id === 'ps-explore' } })); }
  else if (b.id === 'ps-quality') {
    const lvl = (localStorage.getItem('watson.persephone.quality') || 'high') === 'high' ? 'low' : 'high';
    window.dispatchEvent(new CustomEvent('ps:quality', { detail: { level: lvl } })); qualityLabel();
  }
});
function qualityLabel() { $('ps-quality').textContent = (localStorage.getItem('watson.persephone.quality') || 'high') === 'high' ? '✦ High' : '✧ Gentle'; }
window.addEventListener('ps:quality-auto', () => { qualityLabel(); toast('The PC was working hard, so the picture is set to Gentle. Tap ✧ to raise it.'); });
qualityLabel();
window.addEventListener('ps:select', (e) => openDrawer(e.detail.siteId));
const site = (id) => data?.run.sites.find((s) => s.id === id);

// ── A table up close ──
function openDrawer(id) {
  const s = site(id); if (!s) return closeDrawer();
  openId = id;
  const d = $('ps-drawer');
  const claims = (data.activity || []).filter((a) => a.siteId === id && a.type !== 'Play Run').slice(0, 8);
  const bal = (data.balances || []).filter((b) => b.siteId === id);
  const pat = data.patterns.sites.find((p) => p.name === s.name);
  if (typing && d.contains(document.activeElement)) return; // don't wipe what he's typing
  d.innerHTML = `
    <div class="ps-drawer-head"><div><div class="ps-kicker">Table</div><h3>${esc(s.name)}</h3><div class="ps-sub">${statusOf(s)}</div></div><button id="ps-close" class="ghost icon" aria-label="Close">✕</button></div>
    <div class="ps-drawer-stats">
      <div><span>SC balance</span><b>${s.scSaved != null ? `${s.scEstimated ? '~' : ''}${fmt(s.scSaved)}` : '—'}</b></div>
      <div><span>Streak</span><b>${s.streak || 0}</b></div>
      <div><span>Claims (40 days)</span><b>${pat ? pat.claims : '—'}</b></div>
      <div><span>Avg SC a claim</span><b>${pat?.avgScPerClaim ?? '—'}</b></div>
    </div>
    ${bal.length > 1 ? `<div class="ps-chart-title">Balance over time</div>${spark(bal.map((b) => [Date.parse(b.at), b.sc]), 'SC')}` : ''}
    <form id="ps-drawer-form" class="ps-form">
      <label>SC balance now<input name="sc" type="number" step="any" min="0" value="${s.scBalance ?? ''}" placeholder="what the site shows"></label>
      <label>Alert times (Central, on the quarter hour)<input name="alerts" value="${(s.alertTimes || []).map(clock).join(', ')}" placeholder="8 AM, 8:30 PM"></label>
      <label>Name<input name="name" value="${esc(s.name)}" maxlength="80"></label>
      <label>Link<input name="url" type="url" value="${esc(s.url)}"></label>
      <label>Bonus resets<select name="resetRule">${['Daily', 'Rolling 24h', 'Every N Hours'].map((r) => `<option${r === s.resetRule ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>At hour (0–23.99)<input name="resetHour" type="number" step="0.25" min="0" max="23.99" value="${s.resetHour ?? ''}"></label>
      <label>Every … hours<input name="everyHours" type="number" min="1" max="168" value="${s.everyHours ?? ''}"></label>
      <label>Redeems at (SC)<input name="minRedeemSc" type="number" min="0" step="any" value="${s.minRedeemSc ?? ''}"></label>
      <label class="wide">Notes<textarea name="notes" rows="3">${esc(s.notes || '')}</textarea></label>
      <div class="ps-row wide"><button class="primary" type="submit">Save</button>${s.url ? `<a class="ghost ps-btnlink" href="${esc(s.url)}" target="_blank" rel="noopener">Open the site ↗</a>` : ''}${s.ready ? '<button type="button" id="ps-collected" class="ghost">Mark collected</button>' : ''}</div>
    </form>
    <div class="ps-chart-title">Recent claims</div>
    <ul class="ps-mini">${claims.length ? claims.map((c) => `<li><span>${when(c.at)}</span><b>${c.sc != null ? fmt(c.sc) + ' SC' : 'collected'}</b></li>`).join('') : '<li class="ps-muted">None synced yet. Persephone syncs after each email check.</li>'}</ul>
    <div class="ps-row ps-danger"><button type="button" id="ps-remove" class="ghost">Pause this table</button><button type="button" id="ps-close-site" class="ghost">Close it for good</button></div>`;
  d.hidden = false;
}
function closeDrawer() { openId = null; $('ps-drawer').hidden = true; }

// ── Schedule: set every table's alert times at once ──
function parseTimes(text) {
  const out = [];
  for (const raw of String(text || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = raw.toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?::(\d{2}))?(a|am|p|pm)?$/);
    if (!m) return { error: `"${raw}" isn't a time` };
    let h = Number(m[1]); const min = Number(m[2] || 0);
    if (m[3]) { if (h < 1 || h > 12) return { error: `"${raw}" isn't a time` }; h = (h % 12) + (m[3][0] === 'p' ? 12 : 0); }
    if (h > 23 || min > 59) return { error: `"${raw}" isn't a time` };
    if (min % 15) return { error: `${raw}: alerts land on the quarter hour (:00, :15, :30, :45)` };
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return { list: [...new Set(out)].sort() };
}
function renderSchedule() {
  const sites = data.run.sites;
  for (const s of sites) if (!(s.id in sched)) sched[s.id] = (s.alertTimes || []).map(clock).join(', ');
  const anySet = sites.some((s) => s.alertTimes?.length);
  let h = `<div class="ps-section-head"><h4>The schedule</h4><span>${anySet ? 'Each table pings your phone at its own times, when it is ready.' : 'No table has its own times yet, so the app sends its 8 AM and 8 PM summary.'}</span></div>`;
  h += timeline(sites);
  h += `<div class="ps-allrow"><label>Same times for every table<input id="ps-sched-allval" placeholder="e.g. 8 AM, 8 PM"></label><button id="ps-sched-all" class="ghost">Fill them all</button><button id="ps-ask-schedule" class="ghost">Set it up with Persephone</button></div>`;
  h += '<ul class="ps-list ps-sched">' + sites.map((s) => `
    <li><div class="ps-site-main"><b>${esc(s.name)}</b><div class="ps-sub">resets ${s.resetRule === 'Every N Hours' ? `every ${s.everyHours}h` : `${s.resetRule === 'Daily' ? 'daily at' : 'rolling from'} ${clock(String(Math.floor(s.resetHour || 0)).padStart(2, '0') + ':00')} ${s.resetTz === TZ ? '' : s.resetTz.split('/')[1].replace('_', ' ')}`}</div></div>
      <input class="ps-times" data-sched="${s.id}" value="${esc(sched[s.id])}" placeholder="8 AM, 8 PM">
      <span class="ps-chips">${['08:00', '12:00', '20:00'].map((t) => `<button class="ps-chip" data-chip="${s.id}" data-time="${t}">+${clock(t)}</button>`).join('')}</span></li>`).join('') + '</ul>';
  h += '<div class="ps-row"><button id="ps-sched-save" class="primary">Save the whole schedule</button></div>';
  $('ps-schedule').innerHTML = h;
}
document.addEventListener('input', (e) => { if (e.target.dataset.sched) sched[e.target.dataset.sched] = e.target.value; });
function addChip(id, t) {
  const p = parseTimes(sched[id]); const list = p.error ? [] : p.list;
  if (!list.includes(t)) list.push(t);
  sched[id] = list.sort().map(clock).join(', ');
  const inp = document.querySelector(`[data-sched="${id}"]`); if (inp) inp.value = sched[id];
}
function applyAll() {
  const v = $('ps-sched-allval').value; const p = parseTimes(v);
  if (p.error) return toast(p.error, true);
  for (const s of data.run.sites) sched[s.id] = p.list.map(clock).join(', ');
  renderSchedule(); toast('Filled in. Press Save to make it real.');
}
function saveSchedule() {
  let n = 0;
  for (const s of data.run.sites) {
    const p = parseTimes(sched[s.id]);
    if (p.error) return toast(`${s.name}: ${p.error}`, true);
    if (p.list.join() !== (s.alertTimes || []).join()) { app()?.send({ type: 'casino_do', action: 'alerts', args: { siteId: s.id, times: p.list }, ref: ++ref }); n++; }
  }
  toast(n ? `Saving ${n} table${n === 1 ? '' : 's'}…` : 'Nothing changed.');
}
// A 24-hour ribbon: one tick per alert, in gold; hover a tick for the table.
function timeline(sites) {
  const W = 560, H = 54, x = (t) => 12 + ((Number(t.slice(0, 2)) * 60 + Number(t.slice(3))) / 1440) * (W - 24);
  let svg = `<svg class="ps-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Alert times across the day">`;
  for (let h = 0; h <= 24; h += 3) { const xx = 12 + (h / 24) * (W - 24); svg += `<line x1="${xx}" x2="${xx}" y1="10" y2="36" class="ps-grid"/><text x="${xx}" y="50" class="ps-axis" text-anchor="middle">${h === 24 ? '' : hourLabel(h)}</text>`; }
  const by = {};
  for (const s of sites) for (const t of s.alertTimes || []) (by[t] ||= []).push(s.name);
  for (const [t, names] of Object.entries(by)) svg += `<rect x="${x(t) - 3}" y="${36 - Math.min(24, 6 + names.length * 3)}" width="6" height="${Math.min(24, 6 + names.length * 3)}" rx="3" class="ps-mark" data-tip="${esc(clock(t))}: ${esc(names.join(', '))}"/>`;
  return svg + '</svg>';
}

// ── Patterns ──
function renderPatterns() {
  const p = data.patterns, run = data.run;
  const items = data.activity || [];
  let h = `<div class="ps-section-head"><h4>Patterns</h4><span>${p.claims.total} claims and ${p.emails.total} emails on file${data.syncedAt ? ` · synced ${when(data.syncedAt)}` : ''}</span></div>`;
  h += '<div class="ps-row"><button id="ps-ask-patterns" class="primary">Ask Persephone what stands out</button><button id="ps-sync" class="ghost">Sync history</button></div>';
  // 1. SC on each table (ranked).
  const bal = run.sites.filter((s) => s.scSaved != null).map((s) => ({ label: s.name, value: s.scSaved, tip: `${s.name}: ${s.scEstimated ? '~' : ''}${fmt(s.scSaved)} SC` })).sort((a, b) => b.value - a.value);
  h += `<div class="ps-chart-title">SC on each table</div>${bal.length ? bars(bal, 'SC') : '<p class="ps-muted">No balances yet. Type them on the Tables tab, or tell Persephone.</p>'}`;
  // 2. Average SC a claim, by site (only where amounts were logged).
  const avg = p.sites.filter((s) => s.avgScPerClaim != null).map((s) => ({ label: s.name, value: s.avgScPerClaim, tip: `${s.name}: ${s.avgScPerClaim} SC a claim over ${s.claims} claims` })).sort((a, b) => b.value - a.value);
  if (avg.length) h += `<div class="ps-chart-title">Average SC a claim</div>${bars(avg, 'SC')}`;
  // 3. When he collects (hour of day, Central) and 4. when the casino emails arrive.
  const hours = Array(24).fill(0);
  for (const it of items) if (it.type !== 'Play Run' && it.at) hours[Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(it.at))) % 24]++;
  h += `<div class="ps-chart-title">When you collect (hour of day)</div>${hist(hours, 'claims')}`;
  if (p.emails.total) h += `<div class="ps-chart-title">When the casino emails arrive</div>${hist(p.emails.byHour, 'emails')}`;
  // 5. Balance growth, one small chart per table (same scale within each).
  const bySite = {};
  for (const b of data.balances || []) (bySite[b.site] ||= []).push([Date.parse(b.at), b.sc]);
  const growing = Object.entries(bySite).filter(([, pts]) => pts.length > 1);
  if (growing.length) h += `<div class="ps-chart-title">Balances over time</div><div class="ps-multiples">${growing.map(([n, pts]) => `<div><div class="ps-mult-name">${esc(n)}</div>${spark(pts, 'SC')}</div>`).join('')}</div>`;
  // 6. The table view: every number above, per site.
  h += `<div class="ps-chart-title">By table</div><div class="ps-tablewrap"><table class="ps-table"><thead><tr><th>Table</th><th>Claims</th><th>Days</th><th>Avg SC</th><th>Usual hour</th><th>Emails</th><th>Free</th><th>Deals</th><th>Play net</th><th>SC a day</th></tr></thead><tbody>`
    + p.sites.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.claims}</td><td>${s.daysClaimed}</td><td>${s.avgScPerClaim ?? '—'}</td><td>${s.usualHour == null ? '—' : hourLabel(s.usualHour)}</td><td>${s.emails}</td><td>${s.freeEmails}</td><td>${s.dealEmails}</td><td>${s.playRuns ? fmt(s.playNet) : '—'}</td><td>${s.scPerDay ?? '—'}</td></tr>`).join('')
    + `</tbody></table></div><p class="ps-muted">Play runs overall: ${fmt(p.playRuns.wagered)} SC wagered, ${fmt(p.playRuns.won)} won, net ${fmt(p.playRuns.net)} SC.</p>`;
  $('ps-patterns').innerHTML = h;
}
// Horizontal bars: thin, rounded at the value end, value labels in muted ink, hover for the exact number.
function bars(rows, unit) {
  const W = 560, rowH = 22, lw = 150, max = Math.max(...rows.map((r) => r.value), 1), H = rows.length * rowH + 6;
  let svg = `<svg class="ps-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart in ${unit}">`;
  rows.forEach((r, i) => {
    const y = 4 + i * rowH, w = Math.max(2, (r.value / max) * (W - lw - 60));
    svg += `<text x="${lw - 8}" y="${y + 13}" class="ps-axis" text-anchor="end">${esc(r.label.length > 20 ? r.label.slice(0, 19) + '…' : r.label)}</text>`
      + `<rect x="${lw}" y="${y + 3}" width="${w}" height="12" rx="4" class="ps-mark" data-tip="${esc(r.tip)}"/>`
      + `<text x="${lw + w + 6}" y="${y + 13}" class="ps-val">${fmt(r.value)}</text>`;
  });
  return svg + '</svg>';
}
// 24 hourly columns with 2px gaps; hover for the count.
function hist(arr, noun) {
  const W = 560, H = 120, max = Math.max(...arr, 1), bw = (W - 24) / 24;
  let svg = `<svg class="ps-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${noun} by hour">`;
  svg += `<line x1="12" x2="${W - 12}" y1="96" y2="96" class="ps-grid"/>`;
  arr.forEach((v, h) => {
    const x = 12 + h * bw, hh = (v / max) * 80;
    if (v) svg += `<rect x="${x + 1}" y="${96 - hh}" width="${bw - 2}" height="${hh}" rx="3" class="ps-mark" data-tip="${hourLabel(h)}: ${v} ${noun}"/>`;
    if (h % 3 === 0) svg += `<text x="${x + bw / 2}" y="112" class="ps-axis" text-anchor="middle">${hourLabel(h)}</text>`;
  });
  return svg + '</svg>';
}
// A small line: 2px, gold, with its first and last values labeled.
function spark(pts, unit) {
  pts = pts.sort((a, b) => a[0] - b[0]);
  const W = 260, H = 64, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1, y0 = Math.min(0, ...ys), y1 = Math.max(...ys, 1);
  const X = (x) => 8 + ((x - x0) / Math.max(1, x1 - x0)) * (W - 56), Y = (y) => H - 10 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (H - 22);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="ps-svg ps-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance over time">`
    + `<line x1="8" x2="${W - 48}" y1="${H - 10}" y2="${H - 10}" class="ps-grid"/><path d="${d}" class="ps-line"/>`
    + pts.map((p) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="6" class="ps-hit" data-tip="${esc(when(new Date(p[0]).toISOString()))}: ${fmt(p[1])} ${unit}"/>`).join('')
    + `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="4" class="ps-dot"/><text x="${X(last[0]) + 8}" y="${Y(last[1]) + 4}" class="ps-val">${fmt(last[1])}</text></svg>`;
}

// ── Emails (her ledger) and the deals list ──
function renderEmails() {
  const em = data.emails || [];
  const kinds = { free_sc: 'Free SC', free_spins: 'Free spins', deal: 'Deal', tournament: 'Tournament', streak: 'Streak', promo: 'Promo', account: 'Account', other: 'Other' };
  let h = `<div class="ps-section-head"><h4>The post</h4><span>${em.length ? `the latest ${em.length} casino emails Persephone has read` : 'Persephone reads your casino email at 7:30 AM and 7 PM and files every one here.'}</span></div>`;
  if (em.length) h += '<ul class="ps-list ps-mail">' + em.map((e) => `
    <li class="k-${esc(e.category)}"><div class="ps-site-main"><b>${esc(e.site)}</b> <span class="ps-tag">${kinds[e.category] || esc(e.category)}</span>${e.addedToApp ? ' <span class="ps-tag ok">in the app</span>' : ''}
      <div class="ps-sub">${esc(e.summary || e.subject)}</div>
      <div class="ps-sub">${when(e.receivedAt)}${e.expiresAt ? ` · ends ${when(e.expiresAt)}` : ''}${e.rejectReason ? ` · skipped: ${esc(e.rejectReason)}` : ''}</div></div>
      <div class="ps-amt">${e.freeSc ? `${e.upTo ? 'up to ' : ''}${fmt(e.freeSc)} SC` : e.freeSpins ? `${fmt(e.freeSpins)} spins` : e.dealPrice ? `$${fmt(e.dealPrice)}` : ''}</div></li>`).join('') + '</ul>';
  if (data.deals) h += `<div class="ps-chart-title">Deals on offer (for your information, never a nudge)</div><pre class="ps-deals">${esc(data.deals)}</pre>`;
  $('ps-emails').innerHTML = h;
}

// ── Hover tooltips for every chart mark ──
const tip = document.createElement('div'); tip.className = 'ps-tip'; tip.hidden = true; document.body.append(tip);
document.addEventListener('pointerover', (e) => { const t = e.target.closest?.('[data-tip]'); if (!t) return; tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener('pointermove', (e) => { if (!tip.hidden) { tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 12}px`; } });
document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]')) tip.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openId) closeDrawer(); });
