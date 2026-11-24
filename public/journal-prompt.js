// Morpheus's evening journal prompt (Night Shift #115): the card on his page. "Answer" makes his next words to
// Morpheus (typed or spoken) the answer; "Not tonight" skips the night. The server keeps the state.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = () => window.agentApp;
  if (!$('jp-card')) return;
  function render(p) {
    $('jp-card').hidden = !p;
    if (!p) return;
    $('jp-text').textContent = p.prompt || '';
    const answering = p.status === 'answering';
    $('jp-go').hidden = !answering;
    $('jp-answer').hidden = answering;
  }
  $('jp-answer').onclick = () => { app()?.send({ type: 'journal_prompt_answer' }); $('type-input')?.focus(); };
  $('jp-skip').onclick = () => { app()?.send({ type: 'journal_prompt_skip' }); render(null); };
  window.addEventListener('agent:event', (e) => {
    const ev = e.detail;
    if (ev.type === 'welcome') app()?.send({ type: 'journal_prompt_get' });
    if (ev.type === 'journal_prompt') render(ev.prompt);
  });
  // Coming back to the page (the phone wakes it from the push): refresh the card.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app()?.connected()) app().send({ type: 'journal_prompt_get' }); });
})();
