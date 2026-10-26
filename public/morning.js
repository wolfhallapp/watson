// The Oracle's Morning tab ("Wake up, Neo"): Horace's daily check-in, on the same Morning Log as the
// Wolf Hall app's Morning screen. The Oracle fills it while they talk ("good morning"); Horace can tap
// and type here too. Every change saves at once through the server, which updates every open screen.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = () => window.agentApp;
  if (app()?.agent && app().agent !== 'oracle') return;

  let data = null;
  let pending = false;
  const SCALES = [
    ['sleepQuality', 'Sleep quality', ['😫', '😴', '😐', '🙂', '😎']],
    ['energy', 'Energy', ['🪫', '😮‍💨', '😐', '⚡', '🚀']],
    ['mood', 'Mood', ['😞', '😕', '😐', '🙂', '😄']],
  ];
  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) : '');
  const typing = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|number|time)$/.test(el.type)));

  function save(body) { app()?.send({ type: 'morning_do', body }); }
  function toast(msg, bad) {
    let t = $('mn-toast');
    if (!t) { t = document.createElement('div'); t.id = 'mn-toast'; t.className = 'mn-toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.className = 'mn-toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3000);
  }

  function render(force = false) {
    const box = $('mn');
    if (!box || !data) return;
    if (!force && box.contains(document.activeElement) && typing(document.activeElement)) { pending = true; return; }
    pending = false;
    if (!data.ok) { box.innerHTML = `<p class="empty">Couldn't load the morning: ${esc(data.error)}</p>`; return; }
    const e = data.entry || {};
    const w = data.week;
    const field = (k, label, type = 'text', ph = '') => `<label class="mn-field"><span>${label}</span><input data-k="${k}" type="${type}" ${type === 'number' ? 'step="0.1" inputmode="decimal"' : ''} placeholder="${esc(ph)}" value="${esc(e[k] ?? '')}"></label>`;
    const scale = ([k, label, faces]) => `<div class="mn-scale"><span>${label}</span><div>${faces.map((f, i) =>
      `<button type="button" class="mn-face ${e[k] === i + 1 ? 'on' : ''}" data-scale="${k}" data-v="${i + 1}" title="${i + 1}">${f}<small>${i + 1}</small></button>`).join('')}</div></div>`;
    const counter = (k, label, icon) => `<div class="mn-counter"><span>${icon} ${label}</span><div><button type="button" data-add="${k}" data-v="-1">−</button><b>${e[k] || 0}</b><button type="button" data-add="${k}" data-v="1">+</button></div></div>`;
    const top = (i) => `<div class="mn-top ${e['top' + i + 'Done'] ? 'done' : ''}"><input type="checkbox" data-top="${i}" ${e['top' + i + 'Done'] ? 'checked' : ''} ${e['top' + i] ? '' : 'disabled'} aria-label="Done"><input data-k="top${i}" type="text" placeholder="Top ${i}" value="${esc(e['top' + i] || '')}"></div>`;
    const stat = (label, v, unit = '') => `<div class="mn-stat"><b>${v == null ? '—' : esc(v) + unit}</b><span>${label}</span></div>`;
    const bars = data.days.map((x) => {
      const dn = new Date(x.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      return `<div class="mn-day ${x.checkedIn ? 'in' : ''}"><div class="mn-barbox"><i data-h="${x.sleepHours == null ? 0 : Math.min(100, x.sleepHours * 10)}"></i></div><small>${dn}</small><span>${x.mood ? SCALES[2][2][Math.min(4, Math.max(0, Math.round(x.mood) - 1))] : '·'}</span></div>`;
    }).join('');

    box.innerHTML = `
      <div class="mn-head">
        <div><h4>Wake up, Neo</h4><div class="mn-sub">${esc(new Date(data.today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }))}</div></div>
        <div class="mn-badges"><span class="mn-badge">🔥 ${data.streak}-day streak</span>${e.checkedIn ? `<span class="mn-badge on">✓ Checked in ${clock(e.checkedIn)}${e.source === 'App' ? ' (phone)' : ''}</span>` : '<span class="mn-badge">Not checked in yet</span>'}</div>
      </div>
      ${e.briefing ? `<section class="mn-brief"><h5>📡 Today's briefing <small>${clock(e.briefingAt)}</small></h5><p>${esc(e.briefing)}</p></section>` : ''}
      <section class="mn-grid">
        <div class="mn-card"><h5>😴 Sleep</h5><div class="mn-two">${field('bedtime', 'Bedtime', 'time')}${field('wake', 'Woke up', 'time')}</div>
          <div class="mn-big">${e.sleepHours != null ? e.sleepHours + ' hours' : '—'}</div>${e.watchSleep ? `<div class="mn-sub">⌚ ${esc(e.watchSleep)}</div>` : ''}${scale(SCALES[0])}</div>
        <div class="mn-card"><h5>⚡ How you feel</h5>${scale(SCALES[1])}${scale(SCALES[2])}</div>
        <div class="mn-card"><h5>⚖️ Body</h5>${field('weight', 'Weight (lb)', 'number', 'also goes to the Health log')}
          <label class="mn-check"><input type="checkbox" data-bool="meds" ${e.meds ? 'checked' : ''}> 💊 Meds &amp; vitamins taken</label>${field('medsNote', 'Which ones', 'text', 'optional')}</div>
        <div class="mn-card"><h5>💧 Today so far</h5><div class="mn-two">${counter('water', 'Water', '💧')}${counter('caffeine', 'Coffee / C4', '☕')}</div>
          <label class="mn-field"><span>🥓 Keto plan</span><textarea data-k="keto" rows="2" placeholder="Breakfast, lunch, dinner">${esc(e.keto || '')}</textarea></label></div>
        <div class="mn-card mn-wide"><h5>🎯 Top 3 today</h5>${top(1)}${top(2)}${top(3)}</div>
        <div class="mn-card mn-wide">${field('gratitude', '🙏 Grateful for')}<label class="mn-field"><span>📝 Note to self</span><textarea data-k="note" rows="2">${esc(e.note || '')}</textarea></label></div>
      </section>
      ${e.checkedIn ? '' : '<div class="mn-actions"><button type="button" class="primary" data-act="checkin">✓ Check in</button><span class="mn-sub">Or just say "good morning" and I\'ll walk you through it.</span></div>'}
      <section class="mn-week"><h5>Last 7 days</h5><div class="mn-bars">${bars}</div>
        <div class="mn-stats">${stat('check-ins', w.checkIns + '/7')}${stat('avg sleep', w.sleepHours, 'h')}${stat('sleep quality', w.sleepQuality, '/5')}${stat('energy', w.energy, '/5')}${stat('mood', w.mood, '/5')}
        ${stat('weight', w.weightChange == null ? null : (w.weightChange > 0 ? '+' : '') + w.weightChange, ' lb')}${stat('water/day', w.water)}${stat('top 3 done', w.topsSet ? w.topsDone + '/' + w.topsSet : null)}</div></section>`;
    box.querySelectorAll('.mn-barbox i').forEach((i) => { i.style.height = i.dataset.h + '%'; });
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#mn button');
    if (!b) return;
    if (b.dataset.scale) save({ [b.dataset.scale]: Number(b.dataset.v) });
    else if (b.dataset.add) save({ [b.dataset.add + 'Add']: Number(b.dataset.v) });
    else if (b.dataset.act === 'checkin') save({ checkIn: true });
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t.closest('#mn')) return;
    if (t.dataset.top) save({ ['top' + t.dataset.top + 'Done']: t.checked });
    else if (t.dataset.bool) save({ [t.dataset.bool]: t.checked });
    else if (t.dataset.k) {
      const v = t.type === 'number' ? (t.value === '' ? undefined : Number(t.value)) : t.value;
      if (v !== undefined && String(v) !== String((data?.entry || {})[t.dataset.k] ?? '')) save({ [t.dataset.k]: v });
    }
  });
  document.addEventListener('focusout', () => { setTimeout(() => { if (pending) render(); }, 60); });

  window.addEventListener('agent:event', (e) => {
    const ev = e.detail;
    if (ev.type === 'welcome') app()?.send({ type: 'morning_get' });
    if (ev.type === 'morning') {
      data = ev.data; render();
      if (ev.focus) document.querySelectorAll('[data-tab="morning"]').forEach((b) => { if (b.offsetParent) b.click(); });
    }
    if (ev.type === 'morning_result' && (!ev.ok || /Checked in|failed/.test(ev.message))) toast(ev.message, !ev.ok);
  });
  window.addEventListener('agent:tab', (e) => { if (e.detail === 'morning') app()?.send({ type: 'morning_get' }); });
  // Keep it fresh when he checks in on his phone.
  setInterval(() => { if ($('tab-morning')?.classList.contains('active') && document.visibilityState === 'visible') app()?.send({ type: 'morning_get' }); }, 120000);
})();
