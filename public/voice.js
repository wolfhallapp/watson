// Watson's ears and voice, using the browser's built-in speech recognition and
// speech synthesis (Chrome, Edge, Android Chrome, iOS Safari). When Watson's
// server has an ElevenLabs key, replies are spoken with that voice instead, and
// the browser voice takes over if ElevenLabs fails.
//
// Listening modes:
//   handsfree: always listening; say "Watson ..." to talk. After Watson speaks
//              you have a few seconds to reply without the wake word.
//   ptt:       only listens while you hold the mic button / spacebar (or tap
//              once to start and tap again to send).

const hasWindow = typeof window !== 'undefined'; // false when the tests import this file in Node
const SR = hasWindow && (window.SpeechRecognition || window.webkitSpeechRecognition);

// "Watson" and the ways speech recognition tends to mishear it. ("What's on"
// is left out on purpose: it would wake Watson in everyday conversation.)
// "Oracle" (her name since 2026-10-25) and how it gets misheard; "Watson" still works too.
export const ORACLE_WAKE = /\b(?:hey\s+|ok(?:ay)?\s+)?(?:the\s+)?(oracle|oracles|orakel|orical|oricle|auricle|aurical|watson|watsons|wattson|watsen|watts\s?on|what\s?son|whatson)\b[\s,.!?:-]*/i;
// The Architect (2026-10-25): the Construct's agent, on his own page.
export const ARCHITECT_WAKE = /\b(?:hey\s+|ok(?:ay)?\s+)?(?:the\s+)?(architect|architects|arkitect|archetect|archie\s?tect|r\s?kitect)\b[\s,.!?:-]*/i;
let WAKE = ORACLE_WAKE;
/** Which name wakes this page: ORACLE_WAKE (default) or ARCHITECT_WAKE. */
export function setWakeWord(re) { WAKE = re; }

const STOP_SPEAKING = /^(?:(?:oracle|watson|architect|ok|okay)[\s,]+)?(stop|stop talking|quiet|be quiet|shut up|enough|that's enough|silence|pause)\b/i;

export const speechSupported = { listen: !!SR, speak: hasWindow && 'speechSynthesis' in window };

export class Voice {
  constructor(handlers) {
    this.h = handlers; // { onCommand(text), onInterim(text), onState(state), onError(msg), onStopWord() }
    this.mode = 'handsfree';
    this.bargeIn = false; // keep listening while Watson talks (use headphones)
    this.speakEnabled = true;
    this.voiceName = '';
    this.rate = 1.05;
    this.browserPitch = 0.75;     // 0-2, 1 = normal
    this.browserRateFactor = 0.88;
    // The Oracle (2026-10-25): a mature woman's voice. Google's free UK female voice first, then other women's voices.
    // The Architect's page swaps in a man's list.
    this.voicePrefs = [/Google UK English Female/i, /Libby.*Natural/i, /Sonia.*Natural/i, /Maisie.*Natural/i, /Jenny.*Natural/i,
      /Microsoft (Hazel|Susan)/i, /Google US English/i, /Microsoft Zira/i, /Samantha/i, /Karen/i, /female/i];
    this.followUpMs = 7000;

    this.enabled = false; // the user has switched the mic on
    this.running = false; // recognition is currently started
    this.awakeUntil = 0;
    this.ptt = false; // holding / toggled push-to-talk
    this.pttBuffer = '';
    this.pttLast = ''; // last piece merged into pttBuffer (see mergePiece)
    this.lastInterim = '';
    this.flushOnEnd = false;
    this.speaking = false;
    this.startedAt = 0; // when the current recognition session started / the last one ended (listening log)
    this.endedAt = 0;
    this.queue = [];
    this.restartDelay = 250;
    this.awakeTimer = null;
    // ElevenLabs voice via Watson's server: { fetch(text, voiceId, speed) -> Promise<Blob>, defaultVoice }.
    this.cloud = null;
    this.cloudOff = false; // set when ElevenLabs is out of quota or has no key; browser voice from then on
    this.gen = 0; // bumped by stopSpeaking so late audio from a cancelled reply is dropped
    // Bluetooth headphones stay in muffled call mode for a moment after the mic is
    // released, so the first words sound far away. Wait this long before speaking.
    this.settleMs = 0;
    this.micReleasedAt = 0;
    // Phone browsers end a "final" result at every short pause, which cut sentences into
    // pieces. Hands-free commands are collected until this much silence, then sent.
    this.endPauseMs = 3000;
    this.heard = ''; // command collected so far
    this.heardTimer = null;
    this.audio = hasWindow && typeof Audio !== 'undefined' ? new Audio() : null;

    if (SR) this.#setupRecognition();
    if (speechSupported.speak) {
      speechSynthesis.onvoiceschanged = () => this.h.onVoices?.(this.voices());
    }
  }

  // ── State reporting ──
  get state() {
    if (!this.enabled && !this.ptt) return 'off';
    if (this.speaking) return 'speaking';
    if (this.ptt) return 'capturing';
    if (this.isAwake() || this.heard) return 'awake';
    return this.mode === 'handsfree' ? 'listening' : 'ptt-idle';
  }
  #emitState() { this.h.onState?.(this.state); }
  isAwake() { return Date.now() < this.awakeUntil; }

  wake(ms = this.followUpMs) {
    if (this.mode !== 'handsfree' || !this.enabled) return;
    this.awakeUntil = Date.now() + ms;
    clearTimeout(this.awakeTimer);
    this.awakeTimer = setTimeout(() => this.#emitState(), ms + 50);
    this.#emitState();
  }
  sleep() { this.awakeUntil = 0; this.#emitState(); }

  // ── Recognition ──
  #setupRecognition() {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript;
        if (res.isFinal) this.#final(t.trim());
        else interim += t;
      }
      this.lastInterim = interim.trim();
      if (this.lastInterim) {
        this.netErrors = 0;
        if (this.heard) this.#waitForPause(); // still talking: keep collecting
        // Still talking after "Watson": keep the wake window open until the sentence is finished.
        else if (this.isAwake()) this.awakeUntil = Math.max(this.awakeUntil, Date.now() + this.endPauseMs + 1000);
        this.h.onInterim?.(this.heard ? this.heard + ' ' + this.lastInterim : this.lastInterim);
        // Barge-in: start talking over Watson to cut it off.
        if (this.speaking && this.bargeIn && STOP_SPEAKING.test(this.lastInterim)) this.stopSpeaking();
      }
    };
    r.onerror = (e) => {
      this.#diag('error', { code: e.error });
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.enabled = false;
        this.h.onError?.('Microphone access was blocked. Allow the microphone for this page in the browser\'s address bar, then switch the mic back on.');
      } else if (e.error === 'network') {
        // The browser's speech service (Google's, in Chrome) drops a session now and then and
        // recovers on the next restart. Only say something if it keeps failing.
        this.netErrors = (this.netErrors || 0) + 1;
        if (this.netErrors === 3) this.h.onError?.('Speech recognition can\'t reach the browser\'s speech service right now. the Oracle keeps retrying; check the internet if this keeps happening.');
        this.restartDelay = Math.min(this.restartDelay * 2, 8000);
      } else if (e.error === 'audio-capture') {
        this.h.onError?.('No microphone was found.');
        this.enabled = false;
      }
      // 'no-speech' and 'aborted' are normal; onend restarts.
    };
    r.onend = () => {
      this.running = false;
      this.#diag('end', { durMs: this.startedAt ? Date.now() - this.startedAt : null, ptt: this.ptt, collecting: !!this.heard });
      this.endedAt = Date.now();
      if (this.flushOnEnd) this.#flushPtt();
      if (this.#shouldListen()) setTimeout(() => this.#startRecognition(), this.restartDelay);
      this.#emitState();
    };
    r.onstart = () => {
      this.running = true; this.restartDelay = 250;
      this.startedAt = Date.now();
      this.#diag('start', { gapMs: this.endedAt ? this.startedAt - this.endedAt : null, ptt: this.ptt, collecting: !!this.heard });
      this.#emitState();
    };
    this.r = r;
  }

  #shouldListen() {
    if (this.ptt) return true;
    if (!this.enabled || this.mode !== 'handsfree') return false;
    if (this.speaking && !this.bargeIn) return false;
    return true;
  }
  #startRecognition() {
    if (!this.r || this.running || !this.#shouldListen()) return;
    try { this.r.start(); } catch { /* already starting */ }
  }
  #stopRecognition() {
    if (this.r && this.running) { try { this.r.abort(); } catch {} }
  }

  #final(text) {
    if (!text) return;
    this.netErrors = 0;
    this.#diag('final', { text });
    if (this.ptt || this.flushOnEnd) {
      const m = mergePiece(this.pttBuffer, this.pttLast, text);
      this.pttBuffer = m.buf; this.pttLast = m.last; this.lastInterim = '';
      return;
    }
    if (this.speaking) {
      if (STOP_SPEAKING.test(text)) { this.stopSpeaking(); this.h.onStopWord?.(text); }
      return; // otherwise it's probably Watson hearing itself
    }
    if (this.mode !== 'handsfree') return;

    if (this.heard) { this.#collect(text); return; }
    const w = extractWake(text);
    if (w) {
      if (w.command) this.#collect(w.command);
      else { this.wake(9000); this.h.onWake?.(); }
      return;
    }
    if (this.isAwake()) { this.#collect(text); return; }
    this.#diag('ignored', { text });
    this.h.onIgnored?.(text);
  }
  #diag(ev, data = {}) { this.h.onDiag?.({ t: Date.now(), ev, mode: this.mode, ...data }); }
  #collect(text) {
    const m = mergePiece(this.heard, this.lastPiece, text);
    this.heard = m.buf;
    this.lastPiece = m.last;
    this.h.onInterim?.(this.heard);
    this.#waitForPause();
    this.#emitState();
  }
  #waitForPause() {
    clearTimeout(this.heardTimer);
    this.heardTimer = setTimeout(() => this.#sendHeard(), this.endPauseMs);
  }
  #sendHeard() {
    clearTimeout(this.heardTimer);
    const cmd = this.heard.trim();
    this.heard = '';
    this.lastPiece = '';
    this.sleep();
    if (cmd) { this.#diag('sent', { via: 'pause', text: cmd }); this.h.onCommand?.(cmd); }
  }

  /** Switch the always-on mic on or off (hands-free mode). */
  setEnabled(on) {
    this.enabled = !!on && !!SR;
    if (this.enabled) this.#startRecognition();
    else { clearTimeout(this.heardTimer); this.heard = ''; this.lastPiece = ''; this.sleep(); this.#stopRecognition(); }
    this.#emitState();
  }
  setMode(mode) {
    this.mode = mode === 'ptt' ? 'ptt' : 'handsfree';
    if (this.mode === 'ptt' && !this.ptt) this.#stopRecognition(); else this.#startRecognition();
    this.#emitState();
  }

  // ── Push-to-talk ──
  pttStart() {
    if (!SR) return;
    this.stopSpeaking();
    this.ptt = true;
    clearTimeout(this.heardTimer);
    this.pttBuffer = this.heard; // keep anything said hands-free just before
    this.pttLast = this.lastPiece;
    this.heard = '';
    this.lastPiece = '';
    this.lastInterim = '';
    this.flushOnEnd = false;
    if (!this.running) this.#startRecognition();
    this.#emitState();
  }
  pttEnd() {
    if (!this.ptt) return;
    this.ptt = false;
    this.flushOnEnd = true;
    // stop() (not abort) makes the browser deliver the last final result, then onend flushes.
    if (this.running) { try { this.r.stop(); } catch { this.#flushPtt(); } } else this.#flushPtt();
    setTimeout(() => { if (this.flushOnEnd) this.#flushPtt(); }, 2500); // safety net
    this.#emitState();
  }
  #flushPtt() {
    if (!this.flushOnEnd) return;
    this.flushOnEnd = false;
    // Words still unconfirmed when you tapped to send are kept too, not just the confirmed ones.
    const all = this.lastInterim ? mergePiece(this.pttBuffer, this.pttLast, this.lastInterim).buf : this.pttBuffer;
    const text = all.trim();
    this.pttBuffer = ''; this.pttLast = ''; this.lastInterim = '';
    if (text) {
      const cmd = text.replace(WAKE, (s, w, i) => (i === 0 ? '' : s)).trim() || text;
      this.#diag('sent', { via: 'tap', text: cmd });
      this.h.onCommand?.(cmd);
    }
    if (this.#shouldListen()) setTimeout(() => this.#startRecognition(), 200);
  }

  // ── Speaking ──
  voices() {
    return speechSupported.speak ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
  }
  pickVoice() {
    const all = this.voices();
    if (this.voiceName) { const v = all.find((x) => x.name === this.voiceName); if (v) return v; }
    for (const p of this.voicePrefs) { const v = all.find((x) => p.test(x.name)); if (v) return v; }
    return all[0] || null;
  }

  /** The ElevenLabs voice id to use, or null to use the browser's voice. */
  cloudVoice() {
    if (!this.cloud || this.cloudOff || !this.audio) return null;
    // ElevenLabs only when picked by name in Settings: the free tier runs out fast, so "Automatic"
    // is the free browser voice (per Horace, 2026-10-25).
    if (this.voiceName.startsWith('el:')) return this.voiceName.slice(3);
    return null;
  }

  /** Speak text. Long replies are split into sentences (Chrome cuts off long utterances). */
  speak(text, { wakeAfter = true, afterMs } = {}) {
    if (!this.speakEnabled || (!speechSupported.speak && !this.cloudVoice())) { if (wakeAfter) this.wake(afterMs); return; }
    const chunks = toSpeakable(text);
    if (!chunks.length) return;
    this.queue.push(...chunks.map((c, i) => ({ text: c, last: i === chunks.length - 1, wakeAfter, afterMs })));
    if (!this.speaking) this.#next();
  }
  #next() {
    const item = this.queue.shift();
    if (!item) { this.#doneSpeaking(); return; }
    if (!this.speaking) {
      this.speaking = true;
      if (!this.bargeIn && !this.ptt) {
        if (this.running) this.micReleasedAt = Date.now();
        this.#stopRecognition();
      }
      this.#emitState();
    }
    const gen = this.gen;
    const vid = this.cloudVoice();
    if (!vid) { this.#speakBrowser(item, gen); return; }
    item.audio ??= this.#fetchAudio(item.text, vid);
    if (this.queue[0]) this.queue[0].audio ??= this.#fetchAudio(this.queue[0].text, vid); // fetch the next sentence while this one plays
    item.audio.then(
      (blob) => { if (gen === this.gen) this.#playBlob(blob, item, gen); },
      (err) => { if (gen !== this.gen) return; this.#cloudFailed(err); this.#speakBrowser(item, gen); },
    );
  }
  #fetchAudio(text, vid) {
    const p = Promise.resolve().then(() => this.cloud.fetch(text, vid, this.rate));
    p.catch(() => {}); // a prefetch can be abandoned by stopSpeaking
    return p;
  }
  #playBlob(blob, item, gen) {
    const a = this.audio;
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      a.onended = a.onerror = null;
      URL.revokeObjectURL(url);
      if (gen !== this.gen) return;
      if (ok) this.#itemDone(item); else this.#speakBrowser(item, gen); // e.g. autoplay blocked before the first tap
    };
    this.#afterSettle(gen, () => {
      a.onended = () => finish(true);
      a.onerror = () => finish(false);
      a.src = url;
      a.playbackRate = 1; // speed is applied by ElevenLabs, which keeps the voice natural
      a.play().catch(() => finish(false));
    }, () => URL.revokeObjectURL(url));
  }
  /** Run fn once the headphones have had settleMs since the mic was released (or cancelled() if stopped meanwhile). */
  #afterSettle(gen, fn, cancelled) {
    const wait = this.micReleasedAt + this.settleMs - Date.now();
    if (wait <= 0) { fn(); return; }
    setTimeout(() => { if (gen === this.gen) fn(); else cancelled?.(); }, wait);
  }
  #cloudFailed(err) {
    // Quota used up, bad key or no key: stop asking ElevenLabs for the rest of this session.
    if ([401, 402, 503].includes(err?.status)) {
      this.cloudOff = true;
      this.h.onCloudOff?.(err.status === 402
        ? 'The ElevenLabs voice is out of characters for this month, so the Oracle is using the browser voice.'
        : 'The ElevenLabs voice isn\'t available, so the Oracle is using the browser voice.');
    }
  }
  #speakBrowser(item, gen) {
    if (!speechSupported.speak) { this.#itemDone(item); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    const v = this.pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    // Lower and a touch slower, so the free voice sounds like an older, unhurried woman (the Oracle).
    u.rate = this.rate * this.browserRateFactor;
    u.pitch = this.browserPitch;
    u.onend = u.onerror = () => { if (gen === this.gen) this.#itemDone(item); };
    this.#afterSettle(gen, () => speechSynthesis.speak(u));
  }
  #itemDone(item) {
    if (item.last && !this.queue.length) this.#doneSpeaking(item);
    else this.#next();
  }
  #doneSpeaking(item) {
    if (!this.speaking) return;
    this.speaking = false;
    if (item?.wakeAfter !== false) this.wake(item?.afterMs);
    this.#startRecognition();
    this.#emitState();
  }
  stopSpeaking() {
    this.gen++;
    this.queue = [];
    if (this.audio) this.audio.pause();
    if (speechSupported.speak) speechSynthesis.cancel();
    if (this.speaking) { this.speaking = false; this.wake(); this.#startRecognition(); this.#emitState(); }
  }
}

/**
 * Add a newly recognized piece of speech to what's been heard so far. Android re-sends the
 * whole growing sentence as each new result ("I need", "Watson I need to", ...): a piece that
 * extends the previous one replaces it, and a repeat is dropped. Returns { buf, last }.
 */
export function mergePiece(buf = '', last = '', text = '') {
  const piece = text.replace(new RegExp('^' + WAKE.source, 'i'), '').trim() || text.trim();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (last && norm(piece).startsWith(norm(last))) return { buf: buf.slice(0, buf.length - last.length) + piece, last: piece };
  if (last && norm(last).startsWith(norm(piece))) return { buf, last };
  return { buf: buf + (buf ? ' ' : '') + piece, last: piece };
}

/** If the text contains the wake word, returns { command } (empty when it was just "Watson"). */
export function extractWake(text) {
  const m = String(text || '').match(WAKE);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length).trim();
  return { command: after.length > 1 ? after : '' };
}

/** Turn a chat reply into short, listenable sentences. */
export function toSpeakable(text) {
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' (code is on screen) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\*\*|__|\*|~~|\|/g, '')
    .replace(/\s+—\s+|\s+–\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return [];
  // Very long replies: say the start and point at the screen.
  if (t.length > 900) t = t.slice(0, 900).replace(/\s+\S*$/, '') + '. The rest is on screen.';
  const sentences = t.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [t];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).length > 220 && cur) { chunks.push(cur.trim()); cur = s; } else cur += ' ' + s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** Interpret a spoken answer to an approval prompt. */
export function parseYesNo(text) {
  const t = String(text || '').toLowerCase().replace(/^(oracle|watson|architect|ok|okay|um|uh)[\s,]+/g, '').trim();
  // Horace's code words (2026-10-26): "red pill" = do it / deploy, "free your mind" = push it, "blue pill" = no.
  if (/^(the\s+)?red\s*pill\b|^free\s+your\s+mind\b/.test(t)) return { answer: true, always: false };
  if (/^(the\s+)?blue\s*pill\b/.test(t)) {
    const rest = t.replace(/^(the\s+)?blue\s*pill[\s,.!]*/, '').trim();
    return { answer: false, rest: rest.length > 8 ? rest : '' };
  }
  if (/^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|approve|approved|confirm|confirmed|affirmative|please do|go for it|send it|ship it|deploy it)\b/.test(t)) {
    return { answer: true, always: /\b(always|every time|for (this|the) session|don't ask)\b/.test(t) };
  }
  if (/^always( allow)?\b/.test(t)) return { answer: true, always: true };
  if (/^(no|nope|nah|don't|do not|deny|denied|negative|cancel|stop|wait|hold on|not now|never mind|nevermind)\b/.test(t)) {
    const rest = t.replace(/^(no|nope|nah|don't|do not|deny|negative|cancel|wait|hold on|not now)[\s,.!]*(?:instead[\s,]*)?/, '').trim();
    return { answer: false, rest: rest.length > 8 ? rest : '' };
  }
  return null;
}
