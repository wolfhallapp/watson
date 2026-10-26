// The Oracle's Matrix digital rain, drawn behind everything. Light on the CPU: ~16 fps,
// pauses when the tab is hidden, and stays still for people who prefer reduced motion.
(function () {
  const canvas = document.getElementById('rain');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ZΞΛ';
  const size = 16;
  let cols = [], w = 0, h = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Array.from({ length: Math.ceil(w / size) }, () => Math.random() * -h / size);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  }
  function frame() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.09)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = size + 'px "Share Tech Mono", Consolas, monospace';
    for (let i = 0; i < cols.length; i++) {
      const y = cols[i] * size;
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      ctx.fillStyle = Math.random() < 0.06 ? '#d8ffe2' : '#00ff41';
      ctx.fillText(ch, i * size, y);
      cols[i] = y > h && Math.random() > 0.975 ? 0 : cols[i] + 1;
    }
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { for (let k = 0; k < 40; k++) frame(); return; }
  let timer = null;
  const start = () => { if (!timer) timer = setInterval(frame, 60); };
  const stop = () => { clearInterval(timer); timer = null; };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
})();
