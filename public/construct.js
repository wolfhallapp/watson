// The Construct on the Architect's page: Horace's tree of small ways to earn from home.
// The server sends the whole tree on connect and after every change ("construct" events);
// buttons here either change the tree directly (construct_do) or ask the Architect to act.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + (Number(n) || 0).toFixed(2);
  const app = () => window.agentApp;

  let data = null;
  let filter = 'all';
  let search = '';
  let pending = false; // a change arrived while Horace was typing; render when he's done
  const open = new Set(JSON.parse(sessionStorage.getItem('cx.open') || '[]')); // expanded branches and cards
  const saveOpen = () => sessionStorage.setItem('cx.open', JSON.stringify([...open]));

  const FILTERS = [['all', 'All'], ['working', 'Working'], ['ideas', 'Ideas'], ['earning', 'Earning'], ['parked', 'Paused / dropped']];
  const matches = (s) => {
    if (search && !(s.name + ' ' + s.how + ' ' + s.branch).toLowerCase().includes(search)) return false;
    switch (filter) {
      case 'working': return ['Researching', 'Started', 'Earning'].includes(s.status);
      case 'ideas': return s.status === 'Idea';
      case 'earning': return s.status === 'Earning' || s.earned > 0;
      case 'parked': return s.status === 'Paused' || s.status === 'Dropped';
      default: return true;
    }
  };

  function toast(msg, bad) {
    const t = $('cx-toast');
    t.textContent = msg; t.className = 'cx-toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function ask(text) {
    if (!app()?.ask(text)) return;
    toast('Asked the Architect');
    // On a phone, jump to the conversation so the answer is in view.
    if (!window.matchMedia('(min-width: 861px)').matches) document.querySelector('.mobile-tabs [data-tab="convo"]')?.click();
  }
  let ref = 0;
  function act(action, args) { app()?.send({ type: 'construct_do', action, args, ref: ++ref }); }

  function pill(text, cls = '') { return text ? `<span class="cx-pill ${cls}">${esc(text)}</span>` : ''; }
  const statusCls = (s) => 'st-' + String(s).toLowerCase();

  function card(s) {
    const isOpen = open.has(s.id);
    const steps = s.steps.length ? `<span class="cx-steps">${s.stepsDone}/${s.steps.length} steps</span>` : '';
    let body = '';
    if (isOpen) {
      const stepList = s.steps.length
        ? '<ol class="cx-steplist">' + s.steps.map((t) => `<li class="${t.done ? 'done' : ''}"><label><input type="checkbox" data-act="step" data-id="${esc(s.id)}" data-step="${esc(t.id)}" ${t.done ? 'checked' : ''}> <span>${esc(t.text)}</span></label>${t.done ? '' : `<button class="cx-mini" data-act="help-step" data-id="${esc(s.id)}" data-step="${esc(t.id)}">Help me</button>`}</li>`).join('') + '</ol>'
        : '<p class="cx-muted">No steps yet. Ask the Architect to work on it and he\'ll lay them out.</p>';
      const notes = s.notes.length ? '<ul class="cx-notes">' + s.notes.slice(-5).map((n) => `<li><time>${esc(n.at.slice(5, 10))}</time> ${esc(n.text)}</li>`).join('') + '</ul>' : '';
      const pays = s.payouts.length ? '<ul class="cx-pays">' + s.payouts.slice().reverse().map((p) => `<li>${esc(p.date)} · <b>${money(p.amount)}</b> ${esc(p.kind)}${p.notes ? ' · ' + esc(p.notes) : ''} <button class="cx-mini warn" data-act="undo" data-pay="${esc(p.id)}">Undo</button></li>`).join('') + '</ul>' : '';
      body = `<div class="cx-body">
        ${s.how ? `<p>${esc(s.how)}</p>` : ''}
        ${s.watch ? `<p class="cx-watch">⚠ ${esc(s.watch)}</p>` : ''}
        ${s.link ? `<p><a href="${esc(/^https?:\/\//.test(s.link) ? s.link : '#')}" target="_blank" rel="noopener noreferrer">Open the site</a></p>` : ''}
        <div class="cx-row">
          <button class="primary" data-act="work" data-id="${esc(s.id)}">▶ Work on this with the Architect</button>
          <button class="ghost" data-act="research" data-id="${esc(s.id)}">Research it</button>
          <select data-act="status" data-id="${esc(s.id)}" aria-label="Status">${data.options.status.map((o) => `<option ${o === s.status ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        </div>
        <h5>Steps</h5>${stepList}
        <h5>It paid me</h5>
        <form class="cx-row cx-payform" data-id="${esc(s.id)}">
          <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount $" required>
          <select name="kind">${data.options.kind.map((k) => `<option>${esc(k)}</option>`).join('')}</select>
          <input name="date" type="date" max="${esc(data.today)}" value="${esc(data.today)}">
          <button class="ghost" type="submit">Log payout</button>
        </form>
        ${pays}
        <h5>Notes</h5>${notes}
        <form class="cx-row cx-noteform" data-id="${esc(s.id)}"><input name="text" placeholder="Add a note" required><button class="ghost" type="submit">Save</button></form>
      </div>`;
    }
    return `<article class="cx-card ${statusCls(s.status)} ${isOpen ? 'open' : ''}">
      <button class="cx-head" data-act="toggle" data-key="${esc(s.id)}" aria-expanded="${isOpen}">
        <span class="cx-name">${esc(s.name)}</span>
        <span class="cx-pills">${pill(s.status, statusCls(s.status))}${s.earned ? pill('earned ' + money(s.earned), 'earned') : s.estMonthly != null ? pill('~$' + s.estMonthly + '/mo') : ''}${pill(s.dailyTime && s.dailyTime !== 'None' ? s.dailyTime + '/day' : s.dailyTime === 'None' ? 'no daily time' : '')}${steps}</span>
      </button>${body}</article>`;
  }

  const typing = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|number|date|search)$/.test(el.type)));
  function render(force = false) {
    const box = $('cx');
    if (!box || !data) return;
    // Don't yank the page out from under someone typing; catch up when they leave the field.
    if (!force && box.contains(document.activeElement) && typing(document.activeElement)) { pending = true; return; }
    pending = false;
    const t = data.totals;
    const pct = Math.min(100, (t.strategies / data.goal) * 100);
    const moves = data.moves.slice(0, 6).map((m) => `<li><label><input type="checkbox" data-act="step" data-id="${esc(m.strategyId)}" data-step="${esc(m.step.id)}"> <b>${esc(m.strategy)}</b>: ${esc(m.step.text)}</label> <button class="cx-mini" data-act="help-step" data-id="${esc(m.strategyId)}" data-step="${esc(m.step.id)}">Help me</button></li>`).join('');
    const shown = data.strategies.filter(matches);
    const branches = data.branches.map((b) => {
      const list = shown.filter((s) => s.branch === b.name);
      if (!list.length && (filter !== 'all' || search)) return '';
      const key = 'b:' + b.name;
      const isOpen = open.has(key) || !!search;
      return `<section class="cx-branch ${isOpen ? 'open' : ''}">
        <div class="cx-bhead">
          <button class="cx-btoggle" data-act="toggle" data-key="${esc(key)}" aria-expanded="${isOpen}"><span class="cx-caret">${isOpen ? '▾' : '▸'}</span> ${esc(b.name.replace(/^\d+\s/, ''))} <span class="cx-count">${b.count}${b.live ? ` · ${b.live} running` : ''}${b.earned ? ` · ${money(b.earned)}` : ''}</span></button>
          <button class="cx-mini" data-act="grow-branch" data-branch="${esc(b.name)}">🌱 Grow</button>
        </div>
        ${isOpen ? (list.map(card).join('') || '<p class="cx-muted">No leaves here yet.</p>') : ''}
      </section>`;
    }).join('');
    const recent = data.recentPayouts.slice(0, 8).map((p) => `<li>${esc(p.date)} · <b>${money(p.amount)}</b> · ${esc(p.strategy)} <span class="cx-muted">${esc(p.kind)}</span></li>`).join('');

    box.innerHTML = `
      <div class="cx-hero">
        <div class="cx-stat"><b>${money(t.earnedAll)}</b><span>earned, all time</span></div>
        <div class="cx-stat"><b>${money(t.earnedMonth)}</b><span>this month</span></div>
        <div class="cx-stat"><b>${money(t.earnedWeek)}</b><span>last 7 days</span></div>
      </div>
      <div class="cx-goal">
        <div class="cx-goalline"><span><b>${t.strategies}</b> of ${data.goal.toLocaleString()} ways</span><span>${t.live} running${t.estMonthlyLive ? ` · est ~$${t.estMonthlyLive}/mo` : ''}</span></div>
        <div class="cx-bar"><i id="cx-fill"></i></div>
      </div>
      <section class="cx-moves">
        <h4>Today's moves</h4>
        ${moves ? `<ul>${moves}</ul>` : '<p class="cx-muted">Nothing in motion yet. Pick a leaf below and press "Work on this", or ask the Architect where to start.</p>'}
        <div class="cx-row"><button class="primary" data-act="grow">🌱 Grow the tree</button><button class="ghost" data-act="start">Where should I start?</button></div>
      </section>
      <div class="cx-tools">
        <div class="cx-chips">${FILTERS.map(([k, l]) => `<button class="cx-chip ${filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`).join('')}</div>
        <input id="cx-search" type="search" placeholder="Search the tree" value="${esc(search)}" aria-label="Search the tree">
      </div>
      ${branches || '<p class="cx-muted">Nothing matches.</p>'}
      ${recent ? `<section class="cx-recent"><h4>Recent payouts</h4><ul>${recent}</ul></section>` : ''}
      <form class="cx-plant cx-row" id="cx-plant">
        <input name="name" placeholder="Plant your own idea…" required>
        <select name="branch">${data.branches.map((b) => `<option>${esc(b)}</option>`).join('')}</select>
        <button class="ghost" type="submit">Plant</button>
      </form>`;
    $('cx-fill').style.width = Math.max(pct, 0.6) + '%';
  }

  const strat = (id) => data?.strategies.find((s) => s.id === id);
  const stepOf = (s, id) => s?.steps.find((t) => t.id === id);

  document.addEventListener('click', (e) => {
    const el = e.target.closest('#cx [data-act]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const s = strat(el.dataset.id);
    switch (el.dataset.act) {
      case 'toggle': { const k = el.dataset.key; open.has(k) ? open.delete(k) : open.add(k); saveOpen(); render(); break; }
      case 'filter': filter = el.dataset.f; render(); break;
      case 'work': if (s) ask(`Let's work on "${s.name}". Check where it stands today, lay out the setup steps if it has none, and take me through the next one.`); break;
      case 'research': if (s) ask(`Research "${s.name}": is it legit and paying right now, what does it really pay, and is it worth my time? Update the tree with what you find.`); break;
      case 'help-step': { const st = stepOf(s, el.dataset.step); if (s && st) ask(`Help me with this step on "${s.name}": ${st.text}`); break; }
      case 'grow-branch': ask(`Grow the ${el.dataset.branch.replace(/^\d+\s/, '')} branch: find 5 new legit ideas that aren't on the tree yet and plant them.`); break;
      case 'grow': ask('Grow the tree: find 10 new legit ways to earn from home that are not on it yet, favoring the thinnest branches, and plant them.'); break;
      case 'start': ask('Where should I start? Look at the tree and pick the best two or three for me this week, and say why.'); break;
      case 'undo': if (confirm('Remove this payout?')) act('undo_payout', { payoutId: el.dataset.pay }); break;
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('#cx [data-act]');
    if (!el) return;
    if (el.dataset.act === 'step') act('step', { strategy: el.dataset.id, stepId: el.dataset.step, done: el.checked });
    if (el.dataset.act === 'status') act('update', { strategy: el.dataset.id, fields: { status: el.value } });
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'cx-search') return;
    search = e.target.value.trim().toLowerCase();
    clearTimeout(render.h);
    render.h = setTimeout(() => {
      const pos = $('cx-search')?.selectionStart ?? 0;
      render(true);
      const n = $('cx-search'); n?.focus(); n?.setSelectionRange(pos, pos);
    }, 250);
  });
  document.addEventListener('focusout', () => { setTimeout(() => { if (pending) render(); }, 50); });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.closest('#cx')) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    if (f.classList.contains('cx-payform')) {
      const amount = Number(v.amount);
      if (!(amount >= 0.01)) { toast('Type how much it paid', true); return; }
      act('payout', { strategy: f.dataset.id, amount, kind: v.kind, date: v.date || undefined });
    } else if (f.classList.contains('cx-noteform')) {
      act('note', { strategy: f.dataset.id, text: v.text });
    } else if (f.id === 'cx-plant') {
      act('add', { name: v.name, branch: v.branch });
    }
    document.activeElement?.blur();
  });

  window.addEventListener('agent:event', (e) => {
    const ev = e.detail;
    if ((ev.type === 'welcome' || ev.type === 'construct') && ev.construct) { data = ev.construct; render(); }
    if (ev.type === 'construct_result') toast(ev.message, !ev.ok);
  });
})();
