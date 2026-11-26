// House PC heartbeat (11/24, Night Shift task #114, Horace round 16 3A/4A): every 5 minutes, one tiny POST to the
// Wolf Hall worker's /house/heartbeat (master key, no AI). The worker's 15-minute cron pushes Horace (only, round 17)
// when no beat has come for 20 minutes ("The house PC went quiet at 3:12 PM: power or internet?") and once more when
// the beats come back. The PC can't report its own power or Starlink outage, so the silence is the signal.
// A clean shutdown (Ctrl+C / SIGTERM) sends {stopping:true} first, so closing the Oracle on purpose isn't an outage.
// Needs Wolf Hall v362; until it's live the beats get a 404, which is logged once (not every 5 minutes).
import { WORKER_URL, workerKey } from './knowledge.js';

export const EVERY_MS = 5 * 60 * 1000;
export const TIMEOUT_MS = 15000;
export const STOP_TIMEOUT_MS = 3000;

/** One beat. Resolves {ok, status, at?, error?}; never throws. */
export async function sendBeat({ stopping = false, fetchImpl = fetch, key = workerKey, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const r = await fetchImpl(WORKER_URL + '/house/heartbeat', {
      method: 'POST', headers: { 'X-Worker-Key': typeof key === 'function' ? key() : key, 'Content-Type': 'application/json' },
      body: JSON.stringify(stopping ? { stopping: true } : {}), signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, status: r.status, error: j.error || `HTTP ${r.status}` };
    return { ok: true, status: r.status, at: j.at };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e).slice(0, 120) };
  }
}

/** What to log after a beat: only when the outcome changes (ok -> failing, failing -> ok, or a new kind of failure). */
export function beatLogLine(prev, res) {
  const kind = res.ok ? 'ok' : (res.status === 404 ? 'missing' : 'error');
  if (prev === kind) return { kind, line: null };
  if (kind === 'ok') return { kind, line: prev ? '  Heartbeat: the worker hears the PC again' : null };
  if (kind === 'missing') return { kind, line: '  Heartbeat: the worker has no /house/heartbeat yet (Wolf Hall v362 not deployed)' };
  return { kind, line: `  Heartbeat failed: ${res.error}` };
}

export function startHeartbeat({ every = EVERY_MS, firstAfter = 10000, send = sendBeat, log = console.log } = {}) {
  let last = null, stopped = false;
  const tick = async () => {
    if (stopped) return;
    const res = await send();
    const { kind, line } = beatLogLine(last, res);
    last = kind;
    if (line) log(line);
  };
  const first = setTimeout(tick, firstAfter);
  const timer = setInterval(tick, every);
  return {
    /** Stop beating and tell the worker it's a clean stop (at most STOP_TIMEOUT_MS). Never rejects. */
    async stop() {
      if (stopped) return;
      stopped = true; clearTimeout(first); clearInterval(timer);
      await send({ stopping: true, timeoutMs: STOP_TIMEOUT_MS }).catch(() => {});
    },
  };
}
