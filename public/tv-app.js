// The house TV (11/23). Loaded as a file: the Oracle's security policy blocks inline scripts.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let token = ''; try { token = JSON.parse(localStorage.getItem('watson.token') || '""'); } catch (e) { /* */ }
  const hashTok = new URLSearchParams(location.hash.slice(1)).get('token');
  if (hashTok) { token = hashTok; try { localStorage.setItem('watson.token', JSON.stringify(token)); } catch (e) { /* */ } history.replaceState(null, '', location.pathname); }
  $('lf').onsubmit = (e) => { e.preventDefault(); token = $('tok').value.trim(); try { localStorage.setItem('watson.token', JSON.stringify(token)); } catch (er) { /* */ } $('login').hidden = true; load(); };

  // Clock
  function tick() {
    const d = new Date();
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    $('clock').innerHTML = h + ':' + String(d.getMinutes()).padStart(2, '0') + '<small>' + ap + '</small>';
    $('date').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tick(); setInterval(tick, 1000);

  // Boot screen: a short Matrix-style start each time the TV page opens.
  const bootLines = ['> jacking in to wolf hall...', '> signal found: the house', '> the oracle is watching over the kitchen', '> welcome home.'];
  (function boot() {
    let i = 0, j = 0, out = '';
    const step = () => {
      if (i >= bootLines.length) { setTimeout(() => $('boot').classList.add('gone'), 900); return; }
      if (j <= bootLines[i].length) { $('bootText').innerHTML = esc(out + bootLines[i].slice(0, j)) + '<span class="cursor">&nbsp;</span>'; j++; setTimeout(step, 45); }
      else { out += bootLines[i] + '\n'; i++; j = 0; setTimeout(step, 350); }
    };
    step();
  })();

  // Cards rotate every 20 seconds.
  let cards = [], idx = 0, timer = null;
  let playing = false;
  function show(n) {
    const els = $('cards').children; if (!els.length) return;
    idx = (n + els.length) % els.length;
    [...els].forEach((c, i) => c.classList.toggle('on', i === idx));
    // A commercial holds the screen until it ends (muted until sound is on).
    [...els].forEach((c, i) => { const v = c.querySelector('video'); if (v && i !== idx) { v.pause(); } });
    const v = els[idx].querySelector('video');
    playing = false;
    if (v) {
      v.muted = !soundOn; v.currentTime = 0; playing = true;
      v.onended = v.onerror = () => { playing = false; show(idx + 1); };
      v.play().catch(() => { playing = false; });
    }
    $('dots').innerHTML = [...els].map((_, i) => '<i class="' + (i === idx ? 'on' : '') + '"></i>').join('');
  }
  function daysLabel(n) { return n === 0 ? 'TODAY' : n === 1 ? 'DAY' : 'DAYS'; }
  function render(s) {
    $('wx').textContent = s.weather || '';
    $('wk').textContent = (s.week || '').replace(/^Weather:\s*/i, '');
    cards = [];
    const today = (s.today || []).concat(s.weekLines || []).slice(0, 6);
    if (today.length) cards.push('<h2>Around the house</h2><ul class="lines">' + today.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>');
    if (s.trip) {
      const t = s.trip, target = new Date(t.phase === 'before' ? t.leave : t.back), days = Math.max(0, Math.ceil((target - new Date()) / 86400000));
      cards.push('<h2>' + (t.phase === 'before' ? 'Road trip to Hugo' : 'Back home') + '</h2><div class="trip"><span class="n">' + days + '</span> <span class="big">' + (days === 1 ? 'day' : 'days') + (t.phase === 'before' ? ' until we leave' : ' until we\'re home') + '</span></div>'
        + (t.freezes && t.freezes.length ? '<ul class="lines">' + t.freezes.map((f) => '<li class="warn">❄️ ' + esc(f) + '</li>').join('') + '</ul>' : ''));
    }
    // 11/24 (Horace: "more verses, more informative data"): the forecast, the sky, school, facts, a space picture,
    // and three verses spread through the deck.
    const verses = (s.verses && s.verses.length ? s.verses : s.verse ? [s.verse] : []);
    const verseCard = (v) => '<h2>A word for today</h2><div class="verse">“' + esc(v.text) + '”<cite>' + esc(v.ref) + ' (ESV)</cite></div>';
    if (verses[0]) cards.push(verseCard(verses[0]));
    if (s.forecast) cards.push('<h2>The forecast</h2><div class="fc">' + s.forecast.periods.map((p) => '<div class="' + (p.day ? 'd' : 'n') + '"><b>' + esc(p.name) + '</b><span class="t">' + esc(p.temp) + '°</span><span>' + esc(p.text) + '</span>'
      + (p.rain >= 20 ? '<span class="r">💧 ' + esc(p.rain) + '%</span>' : '') + '</div>').join('') + '</div>'
      + (s.forecast.alerts.length ? '<ul class="lines">' + s.forecast.alerts.map((a) => '<li class="warn">⚠️ ' + esc(a) + '</li>').join('') + '</ul>' : ''));
    if (s.sky) cards.push('<h2>The sky today</h2><div class="sky"><div><div class="n">🌅</div><b>' + esc(s.sky.sunrise) + '</b><span>Sunrise</span></div><div><div class="n">🌇</div><b>' + esc(s.sky.sunset) + '</b><span>Sunset</span></div>'
      + '<div><div class="n">☀️</div><b>' + esc(s.sky.daylight) + '</b><span>Daylight</span></div><div><div class="n">' + esc(s.sky.moon.icon) + '</div><b>' + esc(s.sky.moon.name) + '</b><span>Full moon: ' + esc(s.sky.moon.toFull) + '</span></div></div>');
    if (s.school) cards.push('<h2>School · Jarrell ISD</h2><ul class="lines"><li><b>' + esc(s.school.today) + '</b>' + esc(s.school.back || '') + '</li>' + s.school.upcoming.map((u) => '<li>📅 ' + esc(u) + '</li>').join('') + '</ul>');
    if (s.facts && s.facts[0]) cards.push('<h2>Did you know?</h2><div class="fact">' + esc(s.facts[0]) + '</div>');
    if (verses[1]) cards.push(verseCard(verses[1]));
    if (s.space) cards.push('<h2>Space picture of the day</h2><div class="space"><img src="tv/space.img?t=' + encodeURIComponent(token) + '" alt=""><div><b>' + esc(s.space.title) + '</b><p>' + esc(s.space.text) + '</p><small>NASA</small></div></div>');
    if (s.facts && s.facts[1]) cards.push('<h2>Did you know?</h2><div class="fact">' + esc(s.facts[1]) + '</div>');
    if (s.countdowns && s.countdowns.length) cards.push('<h2>Coming up</h2><div class="cd">' + s.countdowns.slice(0, 4).map((c) => '<div><div class="n">' + (c.days === 0 ? '🎉' : c.days) + '</div><div class="u">' + daysLabel(c.days) + '</div><div class="w">' + esc(c.icon + ' ' + c.name) + '</div></div>').join('') + '</div>');
    if (s.church && s.church.length) cards.push('<h2>Church this week</h2><ul class="lines">' + s.church.map((c) => '<li><b>' + esc(c.when) + ' · ' + esc(c.time) + '</b>' + esc(c.what) + '</li>').join('') + '</ul>');
    if (s.packing && s.packing.length) cards.push('<h2>Before we leave</h2><ul class="lines">' + s.packing.map((t) => '<li>☐ ' + esc(t) + '</li>').join('') + '</ul>');
    if (s.shipped) cards.push('<h2>New in Wolf Hall · ' + esc(s.shipped.version) + '</h2><ul class="lines">' + s.shipped.items.map((t) => '<li>✦ ' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</li>').join('') + '</ul>');
    (s.commercials || []).forEach((name) => cards.push('<video class="ad" src="tv/media/' + encodeURIComponent(name) + '.mp4?t=' + encodeURIComponent(token) + '" playsinline preload="metadata"></video>'));
    if (s.facts && s.facts[2]) cards.push('<h2>Did you know?</h2><div class="fact">' + esc(s.facts[2]) + '</div>');
    if (verses[2]) cards.push(verseCard(verses[2]));
    $('cards').innerHTML = cards.map((c) => '<section class="card">' + c + '</section>').join('');
    show(idx);
  }
  async function load() {
    if (!token) { $('login').hidden = false; return; }
    try {
      const r = await fetch('tv/state', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (r.status === 401) { $('login').hidden = false; return; }
      if (r.ok) render(await r.json());
    } catch (e) { /* the PC's server is restarting; keep the last screen */ }
  }
  load();
  setInterval(load, 5 * 60000);
  if (!timer) timer = setInterval(() => { if (!playing && !night) show(idx + 1); }, 20000);

  // ── The Oracle's voice on the TV (her designed voice, through the PC). Chrome needs one click before sound. ──
  let soundOn = false, talking = Promise.resolve();
  function say(text) {
    if (!soundOn || night) return talking;
    talking = talking.then(async () => {
      try {
        const r = await fetch('tts', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: 'dv:oracle' }) });
        if (!r.ok) return;
        const a = new Audio(URL.createObjectURL(await r.blob()));
        document.querySelectorAll('video').forEach((v) => { v.volume = 0.25; });
        await a.play(); await new Promise((res) => { a.onended = a.onerror = res; });
        document.querySelectorAll('video').forEach((v) => { v.volume = 1; });
      } catch (e) { /* the PC voice is busy or off */ }
    });
    return talking;
  }
  function partOfDay(h) { return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }
  function enableSound() {
    if (soundOn) return;
    soundOn = true; $('hint').hidden = true;
    say('Good ' + partOfDay(new Date().getHours()) + ', Wolf Hall. The screen is awake, and so am I.');
  }
  document.addEventListener('click', enableSound);
  // On the hour, 7 AM to 10 PM: the time and the weather.
  let lastHour = -1;
  setInterval(() => {
    const d = new Date(), h = d.getHours();
    if (d.getMinutes() !== 0 || h === lastHour || h < 7 || h > 22) return;
    lastHour = h;
    const w = $('wx').textContent ? ' ' + $('wx').textContent.replace(/(\d+)°/, '$1 degrees') + '.' : '';
    say("It's " + (h % 12 || 12) + " o'clock." + w);
  }, 15000);

  // ── Night mode, 11 PM to 6 AM: just a dim clock, so it doesn't light up the house. ──
  let night = false;
  function nightCheck() {
    const h = new Date().getHours(); const n = h >= 23 || h < 6;
    if (n === night) return; night = n;
    document.body.classList.toggle('night', night);
    if (night) document.querySelectorAll('video').forEach((v) => v.pause());
  }
  nightCheck(); setInterval(nightCheck, 60000);
  setTimeout(() => location.reload(), 6 * 3600000); // a fresh start every 6 hours
  document.addEventListener('dblclick', () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); });
})();
