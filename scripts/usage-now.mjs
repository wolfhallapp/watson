// Prints the account's Claude plan usage right now (5-hour session and weekly), without sending Claude anything.
// Usage (in WSL): node scripts/usage-now.mjs
import { query } from '@anthropic-ai/claude-agent-sdk';
let release;
const prompt = (async function* () { await new Promise((r) => { release = r; }); })();
const q = query({ prompt, options: { settingSources: [] } });
(async () => { try { for await (const m of q) if (process.env.DEBUG) console.log('msg', m.type, m.subtype); } catch {} })();
const t0 = Date.now();
try {
  const r = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
  const w = r.rate_limits || {};
  const line = (label, x) => x ? `${label}: ${Math.round(x.utilization)}% used, resets ${new Date(x.resets_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}` : `${label}: unknown`;
  console.log(line('5-hour session', w.five_hour));
  console.log(line('Weekly', w.seven_day));
  if (process.env.DEBUG) console.log(`(${Date.now() - t0} ms)`, JSON.stringify(r.rate_limits));
} catch (e) { console.log('Could not read usage:', e.message); }
release(); q.close(); process.exit(0);
