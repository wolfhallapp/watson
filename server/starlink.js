// Reads the Starlink dish's own status and recent per-second history (read-only), the same data
// the Starlink app shows. gRPC-web to the dish at 192.168.100.1:9201; the protobuf reply is decoded
// by hand so no extra packages are needed. Used to tell Horace the real cause when Claude can't be
// reached (2026-10-30: the Oracle kept blaming a "proxy" while Starlink was passing ~0.5 Mbps).
const DISH = 'http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle';

// Request { get_status = 1004 } / { get_history = 1007 }: tag bytes for an empty sub-message.
const REQUESTS = { status: [0xe2, 0x3e, 0x00], history: [0xfa, 0x3e, 0x00] };

async function call(kind, timeoutMs = 5000) {
  const msg = Buffer.from(REQUESTS[kind]);
  const frame = Buffer.concat([Buffer.from([0, 0, 0, 0, msg.length]), msg]);
  const res = await fetch(DISH, {
    method: 'POST', headers: { 'Content-Type': 'application/grpc-web+proto', 'X-Grpc-Web': '1' }, body: frame,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5 || buf[0] !== 0) throw new Error(`unexpected reply from the dish (${res.status}, ${buf.length} bytes)`);
  return buf.subarray(5, 5 + buf.readUInt32BE(1));
}

// Minimal protobuf decoder: [{ field, wire, value }] where value is a number or a Buffer.
function varint(b, i) { let r = 0n, s = 0n; for (;;) { const x = b[i++]; r |= BigInt(x & 0x7f) << s; s += 7n; if (!(x & 0x80)) return [r, i]; } }
export function decode(b) {
  const out = []; let i = 0;
  while (i < b.length) {
    let key; [key, i] = varint(b, i);
    const field = Number(key >> 3n), wire = Number(key & 7n);
    if (wire === 0) { let v; [v, i] = varint(b, i); out.push({ field, wire, value: Number(v) }); }
    else if (wire === 1) { out.push({ field, wire, value: b.readDoubleLE(i) }); i += 8; }
    else if (wire === 5) { out.push({ field, wire, value: b.readFloatLE(i) }); i += 4; }
    else if (wire === 2) { let n; [n, i] = varint(b, i); out.push({ field, wire, value: b.subarray(i, i + Number(n)) }); i += Number(n); }
    else throw new Error(`wire type ${wire}`);
  }
  return out;
}
const floats = (buf) => Array.from({ length: Math.floor(buf.length / 4) }, (_, k) => buf.readFloatLE(k * 4));

/** The raw decoded status message (for scripts/starlink.mjs raw). */
export async function dishStatusFields() {
  const top = decode(await call('status'));
  const st = top.find((x) => x.field === 2004); // Response.dish_get_status
  return st ? decode(st.value) : top;
}

/**
 * Summary of the dish's recent history (it keeps about the last 15 minutes, one sample a second).
 * Speeds are for the whole house, measured at the dish.
 */
export async function dishSummary() {
  const top = decode(await call('history'));
  const h = top.find((x) => x.field === 2006) || top[0]; // Response.dish_get_history
  const hist = decode(h.value);
  const current = hist.find((x) => x.field === 1)?.value;
  const series = (f) => { const e = hist.find((x) => x.field === f && x.wire === 2); return e ? floats(e.value) : []; };
  // Ring buffers: 1001 ping drop rate, 1002 latency ms, 1003 downlink bps, 1004 uplink bps.
  const order = (arr) => { if (!arr.length || current == null) return arr; const k = current % arr.length; return [...arr.slice(k), ...arr.slice(0, k)]; };
  const drop = order(series(1001)), lat = order(series(1002)), down = order(series(1003)), up = order(series(1004));
  const outages = []; let run = 0;
  for (const d of drop) { if (d >= 1) run++; else if (run) { outages.push(run); run = 0; } }
  if (run) outages.push(run);
  const pct = (a, p) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * p)] : 0; };
  const mbps = (bps) => Math.round(bps / 1e5) / 10;
  return {
    seconds: drop.length,
    offlineSeconds: drop.filter((d) => d >= 1).length,
    lossySeconds: drop.filter((d) => d > 0 && d < 1).length,
    outages: outages.length,
    longestOutageS: outages.length ? Math.max(...outages) : 0,
    latencyMs: { median: Math.round(pct(lat, 0.5)), p95: Math.round(pct(lat, 0.95)) },
    downMbps: { median: mbps(pct(down, 0.5)), peak: mbps(pct(down, 0.95)) },
    upMbps: { median: mbps(pct(up, 0.5)), peak: mbps(pct(up, 0.95)) },
  };
}

/** A real download test (default 5 MB through Cloudflare's public speed test), in Mbps. */
export async function downloadMbps(bytes = 5_000_000, timeoutMs = 30000) {
  const start = Date.now();
  let got = 0;
  try {
    const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}`, { signal: AbortSignal.timeout(timeoutMs) });
    for await (const chunk of res.body) got += chunk.length;
  } catch { /* timed out or dropped: report what arrived */ }
  const secs = (Date.now() - start) / 1000;
  return { mbps: Math.round((got * 8) / secs / 1e5) / 10, bytes: got, seconds: Math.round(secs * 10) / 10, complete: got >= bytes };
}

/** One plain-English sentence about the connection, for screens and for the agent. Never throws. */
export async function describeConnection({ speedTest = false } = {}) {
  let dish = null, test = null, dishError = null;
  try { dish = await dishSummary(); } catch (e) { dishError = e.message; }
  if (speedTest) test = await downloadMbps();
  const parts = [];
  if (dish) {
    const peak = Math.max(dish.downMbps.peak, dish.upMbps.peak);
    parts.push(`Starlink dish, last ${Math.round(dish.seconds / 60)} min: ${dish.outages ? `${dish.outages} outage(s), longest ${dish.longestOutageS}s` : 'no outages'}, latency ${dish.latencyMs.median} ms, `
      + `whole-house traffic peaking at ${dish.downMbps.peak} Mbps down / ${dish.upMbps.peak} Mbps up${peak < 2 ? ' (very low)' : ''}.`);
  } else parts.push(`Couldn't read the Starlink dish (${dishError}).`);
  if (test) parts.push(`Download test: ${test.mbps} Mbps${test.complete ? '' : ' (did not finish in 30 s)'}; normal Starlink is 50+ Mbps.`);
  const slow = (test && test.mbps < 5) || (!test && dish && Math.max(dish.downMbps.peak, dish.upMbps.peak) < 2 && dish.outages === 0);
  const verdict = test && test.mbps < 5 ? 'The internet connection is very slow right now (Starlink side, not a proxy or this PC).'
    : dish?.outages ? 'Starlink had dropouts recently.'
    : test ? 'The connection looks fine.' : '';
  return { text: [verdict, ...parts].filter(Boolean).join(' '), dish, test, slow };
}
