// Persephone (2026-11-06, per Horace): the sixth agent, keeper of the casino Bonus Run. Named after Persephone
// in The Matrix Reloaded (Le Vrai, the Merovingian's chateau): elegant, perceptive, a little regal. She is the
// brains of the casino: the Wolf Hall app only shows each site's link, when it's time to collect, its SC balance,
// a Collected button and the email bonuses; everything else (sites, balances, alert times, play runs, the email
// checks, history and patterns) lives here. Her home is public/persephone.html, a 3D chateau (Three.js).
// Data: Notion stays the source of truth for sites, claims, offers and balances (through the worker's /gambling
// routes); her own detailed ledger (every casino email, every balance she's told, every claim synced) is on this
// PC in data/persephone/, never pushed. She never encourages buying coins or chasing losses.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { ROOT, DATA_DIR } from './config.js';
import { makeHistory, memory } from './store.js';
import { formatLocal, userTimeZone } from './tools.js';
import { searchSessions, workerGet, workerPostGambling } from './knowledge.js';

export const PS_DIR = () => process.env.PERSEPHONE_DIR || path.join(DATA_DIR, 'persephone');
const file = (name) => { const d = PS_DIR(); fs.mkdirSync(d, { recursive: true }); return path.join(d, name); };
export const CASINO_DEALS = path.join(DATA_DIR, 'casino-deals.md'); // the Oracle's briefing reads it too
const TZ = 'America/Chicago';

// ── Her ledger on this PC ──
export function readJsonl(name) {
  try { return fs.readFileSync(file(name), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function appendJsonl(name, rows) { if (rows.length) fs.appendFileSync(file(name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); }
function readJson(name, d) { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return d; } }
function writeJson(name, v) { const f = file(name); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); }

/** Every casino email she has read, deduplicated by Gmail id (a later read of the same email updates it). */
export function recordEmails(list, now = new Date()) {
  const have = new Map(readJsonl('emails.jsonl').map((e) => [e.emailId, e]));
  let added = 0, updated = 0;
  for (const raw of list) {
    const e = { ...raw, emailId: String(raw.emailId), recordedAt: now.toISOString() };
    if (have.has(e.emailId)) { have.set(e.emailId, { ...have.get(e.emailId), ...e }); updated++; } else { have.set(e.emailId, e); added++; }
  }
  const f = file('emails.jsonl');
  fs.writeFileSync(f + '.tmp', [...have.values()].map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.renameSync(f + '.tmp', f);
  return { added, updated, total: have.size };
}

export function recordBalance(site, siteId, sc, source, now = new Date()) {
  appendJsonl('balances.jsonl', [{ at: now.toISOString(), site, siteId, sc, source }]);
}

/** Pull every claim and play run from the app (Notion) into her own copy, so history outlives the app's lookback. */
export async function syncActivity(days = 400) {
  const r = JSON.parse((await workerGet(`/gambling/activity?days=${days}`)).body);
  if (!r.ok) throw new Error(r.error || 'the app did not answer');
  const cache = readJson('activity.json', { items: {} });
  let fresh = 0;
  for (const it of r.items) { if (!cache.items[it.id]) fresh++; cache.items[it.id] = it; }
  cache.syncedAt = new Date().toISOString();
  writeJson('activity.json', cache);
  return { fresh, total: Object.keys(cache.items).length, syncedAt: cache.syncedAt };
}
export function activityItems() { return Object.values(readJson('activity.json', { items: {} }).items); }

// ── Patterns, computed in code so the numbers are real ──
const zoned = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', weekday: 'short', hour: '2-digit' }).formatToParts(new Date(iso)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { wd: p.weekday, h: Number(p.hour) % 24 };
};
const r2 = (n) => Math.round(n * 100) / 100;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function patterns({ items = activityItems(), emails = readJsonl('emails.jsonl'), balances = readJsonl('balances.jsonl') } = {}) {
  const bySite = {};
  const S = (name) => (bySite[name || '(unknown)'] ||= { claims: 0, days: new Set(), scClaimed: 0, scKnown: 0, hours: Array(24).fill(0), weekdays: Object.fromEntries(WD.map((d) => [d, 0])), last: null, plays: 0, wagered: 0, won: 0, emails: 0, freeEmails: 0, emailSc: 0, deals: 0 });
  for (const it of items) {
    const s = S(it.site);
    if (it.type === 'Play Run') { s.plays++; s.wagered += it.wagered || 0; s.won += it.won || 0; continue; }
    s.claims++; s.days.add(it.day);
    if (typeof it.sc === 'number') { s.scClaimed += it.sc; s.scKnown++; }
    if (it.at) { const z = zoned(it.at); s.hours[z.h]++; s.weekdays[z.wd]++; if (!s.last || it.at > s.last) s.last = it.at; }
  }
  const emailHours = Array(24).fill(0), emailWd = Object.fromEntries(WD.map((d) => [d, 0])), kinds = {};
  for (const e of emails) {
    const s = S(e.site);
    s.emails++;
    if (e.category === 'free_sc' || e.category === 'free_spins') { s.freeEmails++; s.emailSc += Number(e.freeSc) || 0; }
    if (e.category === 'deal') s.deals++;
    kinds[e.category || 'other'] = (kinds[e.category || 'other'] || 0) + 1;
    if (e.receivedAt) { const z = zoned(e.receivedAt); emailHours[z.h]++; emailWd[z.wd]++; }
  }
  const growth = {};
  for (const b of balances) (growth[b.site] ||= []).push(b);
  const sites = Object.entries(bySite).map(([name, s]) => {
    const g = (growth[name] || []).sort((a, b) => a.at.localeCompare(b.at));
    const first = g[0], last = g[g.length - 1];
    const span = first && last && last !== first ? (Date.parse(last.at) - Date.parse(first.at)) / 864e5 : 0;
    const peakHour = s.hours.indexOf(Math.max(...s.hours));
    return {
      name, claims: s.claims, daysClaimed: s.days.size, lastClaim: s.last,
      avgScPerClaim: s.scKnown ? r2(s.scClaimed / s.scKnown) : null, scClaimed: r2(s.scClaimed),
      usualHour: s.claims ? peakHour : null,
      busiestWeekday: s.claims ? Object.entries(s.weekdays).sort((a, b) => b[1] - a[1])[0][0] : null,
      playRuns: s.plays, playWagered: r2(s.wagered), playWon: r2(s.won), playNet: r2(s.won - s.wagered),
      emails: s.emails, freeEmails: s.freeEmails, emailSc: r2(s.emailSc), dealEmails: s.deals,
      balance: last ? last.sc : null, balanceAt: last ? last.at : null,
      scPerDay: span >= 1 ? r2((last.sc - first.sc) / span) : null,
    };
  }).sort((a, b) => b.claims - a.claims || a.name.localeCompare(b.name));
  const totalPlay = sites.reduce((t, s) => ({ w: t.w + s.playWagered, won: t.won + s.playWon }), { w: 0, won: 0 });
  return {
    sites,
    emails: { total: emails.length, kinds, byHour: emailHours, byWeekday: emailWd },
    claims: { total: sites.reduce((t, s) => t + s.claims, 0) },
    playRuns: { wagered: r2(totalPlay.w), won: r2(totalPlay.won), net: r2(totalPlay.won - totalPlay.w) },
  };
}

export function patternsText(p = patterns()) {
  const hr = (h) => (h == null ? '—' : `${(h % 12) || 12} ${h < 12 ? 'AM' : 'PM'}`);
  const lines = p.sites.map((s) => `- ${s.name}: ${s.claims} claims on ${s.daysClaimed} days${s.avgScPerClaim != null ? `, avg ${s.avgScPerClaim} SC a claim` : ''}, usually ${hr(s.usualHour)}${s.busiestWeekday ? ` (most on ${s.busiestWeekday})` : ''}`
    + `${s.balance != null ? `; balance ${s.balance} SC${s.scPerDay != null ? `, ${s.scPerDay >= 0 ? '+' : ''}${s.scPerDay} SC a day` : ''}` : ''}`
    + `${s.emails ? `; ${s.emails} emails (${s.freeEmails} free${s.emailSc ? `, ${s.emailSc} SC` : ''}, ${s.dealEmails} deals)` : ''}`
    + `${s.playRuns ? `; play runs: ${s.playRuns}, net ${s.playNet} SC` : ''}`);
  const peak = p.emails.byHour.indexOf(Math.max(...p.emails.byHour));
  return [`Claims: ${p.claims.total} · Emails read: ${p.emails.total} (${Object.entries(p.emails.kinds).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'})`,
    p.emails.total ? `Emails arrive most around ${hr(peak)}; by weekday: ${Object.entries(p.emails.byWeekday).map(([d, n]) => `${d} ${n}`).join(', ')}` : '',
    `Play runs overall: wagered ${p.playRuns.wagered} SC, won ${p.playRuns.won} SC, net ${p.playRuns.net} SC`, ...lines].filter(Boolean).join('\n');
}

// ── Talking to the app ──
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ ...text(t), isError: true });
export async function bonusRun() {
  const r = JSON.parse((await workerGet('/gambling/bonus-run')).body);
  if (!r.ok) throw new Error(r.error || 'the app did not answer');
  return r;
}
export async function post(p, body) {
  const r = await workerPostGambling(p, { ...body, source: 'Persephone' });
  if (!r.json?.ok) throw new Error(r.json?.error || `HTTP ${r.status}`);
  return r.json;
}
/** "chumba" -> the Chumba Casino row. Active and paused sites both count. */
export function findSite(run, name) {
  const all = [...run.sites, ...(run.paused || [])];
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(casino|slots|social|us)+$/, '');
  const k = key(name);
  return all.find((s) => s.id === name) || all.find((s) => key(s.name) === k) || all.find((s) => key(s.name).startsWith(k) || k.startsWith(key(s.name)));
}
function siteLine(s) {
  const bal = s.scSaved != null ? `${s.scEstimated ? '~' : ''}${s.scSaved} SC` : 'balance not set';
  const when = s.ready ? 'READY' : s.readyAt ? `next ${new Date(s.readyAt).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  return `${s.name} [${s.id}] ${when} · ${bal}${s.minRedeemSc ? ` (redeem at ${s.minRedeemSc})` : ''} · alerts ${s.alertTimes?.length ? s.alertTimes.join(', ') : 'none'} · reset ${s.resetRule}${s.resetRule === 'Every N Hours' ? ` ${s.everyHours}h` : ` ${s.resetHour}:00 ${s.resetTz}`}${s.streak ? ` · streak ${s.streak}` : ''}${s.claimedToday ? ' · collected today' : ''} · ${s.url}`;
}
export function runText(run) {
  return [`Active sites ${run.sites.length} · ready now ${run.counts.readyNow} · collected today ${run.counts.claimedToday} · SC saved ${run.saved.sc}${run.saved.estimated ? ' (some estimated)' : ''} · SC claimed today ${run.sc.today}, 7 days ${run.sc.last7Days}, this month ${run.sc.thisMonth}`,
    ...run.sites.map(siteLine),
    run.paused?.length ? `Paused or closed: ${run.paused.map((p) => `${p.name} (${p.status})`).join(', ')}` : '',
    run.offers?.length ? `Email bonuses showing in the app: ${run.offers.map((o) => `${o.site}: ${o.what}`).join('; ')}` : 'No email bonuses showing in the app.'].filter(Boolean).join('\n');
}

// What Horace changed on her screen since her last turn (like the Architect's tree edits).
let screenEdits = [];
export function noteScreenEdit(msg) { screenEdits.push(`${formatLocal(new Date())}: ${msg}`); if (screenEdits.length > 40) screenEdits.shift(); }
export function takeScreenEdits() {
  if (!screenEdits.length) return '';
  const t = `[What Horace changed on your screen since your last turn]\n${screenEdits.join('\n')}`;
  screenEdits = [];
  return t;
}

/** Actions the page itself can take (her screen), each one a real change in the app, noted for her. */
export async function screenAction(action, a = {}) {
  const run = await bonusRun();
  const site = a.siteId ? findSite(run, a.siteId) : null;
  if (['balance', 'alerts', 'edit', 'remove', 'restore', 'collected'].includes(action) && !site) throw new Error('That site is not in the list.');
  if (action === 'balance') {
    const sc = Number(a.sc);
    if (!(sc >= 0 && sc <= 1e6)) throw new Error('The SC balance must be a number, 0 or more.');
    await post('/gambling/site', { siteId: site.id, scBalance: sc });
    recordBalance(site.name, site.id, sc, 'screen');
    return `${site.name}'s balance set to ${sc} SC.`;
  }
  if (action === 'alerts') {
    await post('/gambling/site', { siteId: site.id, alertTimes: a.times || [] });
    return `${site.name}'s alert times set to ${(a.times || []).join(', ') || 'none'}.`;
  }
  if (action === 'edit') {
    const allowed = ['name', 'url', 'notes', 'resetRule', 'resetHour', 'resetTz', 'everyHours', 'minRedeemSc', 'dailySc', 'streakSite'];
    const body = Object.fromEntries(Object.entries(a.fields || {}).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(body).length) throw new Error('Nothing to change.');
    await post('/gambling/site', { siteId: site.id, ...body });
    return `${site.name} updated (${Object.keys(body).join(', ')}).`;
  }
  if (action === 'remove') { await post('/gambling/site', { siteId: site.id, status: a.status === 'Closed' ? 'Closed' : 'Paused' }); return `${site.name} taken off the list (${a.status === 'Closed' ? 'closed' : 'paused'}; its history is kept).`; }
  if (action === 'restore') { await post('/gambling/site', { siteId: site.id, status: 'Active' }); return `${site.name} is back on the list.`; }
  if (action === 'collected') { await post('/gambling/claim', { siteId: site.id, ...(a.sc != null && a.sc !== '' ? { sc: Number(a.sc) } : {}) }); return `${site.name} marked collected.`; }
  if (action === 'add') {
    const r = await post('/gambling/sites/add', { sites: [{ name: String(a.name || '').trim(), url: String(a.url || '').trim(), ...(a.resetRule ? { resetRule: a.resetRule } : {}), ...(a.resetHour != null ? { resetHour: Number(a.resetHour) } : {}), ...(a.everyHours ? { everyHours: Number(a.everyHours) } : {}) }], confirm: true });
    if (r.dryRun) throw new Error('the app only did a trial run; nothing was added');
    return `${a.name} added${r.skipped?.length ? ` (skipped: ${JSON.stringify(r.skipped)})` : ''}.`;
  }
  throw new Error(`Unknown action ${action}`);
}

/** Everything her page draws: the live run, her patterns, the newest emails and the deals file. */
export async function screenState() {
  const [run, p] = [await bonusRun(), patterns()];
  const emails = readJsonl('emails.jsonl').sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 60);
  let deals = ''; try { deals = fs.readFileSync(CASINO_DEALS, 'utf8').slice(0, 6000); } catch { /* none yet */ }
  const balances = readJsonl('balances.jsonl').slice(-400);
  const items = activityItems().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 400);
  return { run, patterns: p, emails, deals, balances, activity: items, syncedAt: readJson('activity.json', {}).syncedAt || null };
}

const siteArg = z.string().min(1).describe('Site name as Horace says it ("chumba"), or its id');
const timesArg = z.array(z.string()).max(12).describe('Times of day, Central, on the quarter hour: "08:00", "8:30 PM"');

export function createPersephoneTools(send, currentSessionId) {
  const changed = () => send({ type: 'casino_changed' });
  const act = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(`Couldn't do that: ${e.message}`); } };
  return createSdkMcpServer({
    name: 'persephone',
    version: '0.1.0',
    instructions: "Persephone's casino tools: the live Bonus Run in the Wolf Hall app (sites, balances, alert times, claims, play runs, email bonuses), her own ledger of every casino email and balance, and pattern stats. Nothing here touches the Pool or any money data.",
    tools: [
      tool('casino_state', 'The live casino: every active site with its id, link, ready or next time, SC balance, alert times, reset rule and streak, plus paused sites, totals and the email bonuses showing in the app.', {},
        act(async () => text(runText(await bonusRun())))),
      tool('set_balance', "Set one or more sites' SC balance (what Horace reads off the site). Only SC; Horace doesn't track GC.",
        { balances: z.array(z.object({ site: siteArg, sc: z.number().min(0).max(1e6) })).min(1).max(40) },
        act(async ({ balances }) => {
          const run = await bonusRun(); const out = [];
          for (const b of balances) {
            const s = findSite(run, b.site);
            if (!s) { out.push(`${b.site}: not found`); continue; }
            await post('/gambling/site', { siteId: s.id, scBalance: b.sc });
            recordBalance(s.name, s.id, b.sc, 'Persephone');
            out.push(`${s.name}: ${b.sc} SC`);
          }
          changed(); return text(`Saved. ${out.join(' · ')}`);
        })),
      tool('set_alerts', "Set each site's \"time to collect\" alert times (pushes to Horace's phone on the quarter hour, Central, only when that site is ready). Replaces the site's list; an empty list turns its alerts off. Once any site has alert times, the old 8 AM / 8 PM summary stops.",
        { alerts: z.array(z.object({ site: siteArg, times: timesArg })).min(1).max(40) },
        act(async ({ alerts }) => {
          const run = await bonusRun(); const out = [];
          for (const a of alerts) {
            const s = findSite(run, a.site);
            if (!s) { out.push(`${a.site}: not found`); continue; }
            try { await post('/gambling/site', { siteId: s.id, alertTimes: a.times }); out.push(`${s.name}: ${a.times.join(', ') || 'off'}`); } catch (e) { out.push(`${s.name}: ${e.message}`); }
          }
          changed(); return text(out.join('\n'));
        })),
      tool('edit_site', "Change a site's details: name, link, notes, reset rule (Daily / Rolling 24h / Every N Hours), reset hour (0-23.99, minutes as a fraction) and time zone, hours between bonuses, the SC it can redeem at, its usual daily SC, or whether it has a login streak.",
        { site: siteArg, name: z.string().max(80).optional(), url: z.string().url().optional(), notes: z.string().max(1900).optional(),
          resetRule: z.enum(['Daily', 'Rolling 24h', 'Every N Hours']).optional(), resetHour: z.number().min(0).max(23.99).optional(),
          resetTz: z.enum(['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'UTC']).optional(), everyHours: z.number().min(1).max(168).optional(),
          minRedeemSc: z.number().min(0).max(100000).optional(), dailySc: z.number().min(0).max(10000).optional(), streakSite: z.boolean().optional() },
        act(async ({ site, ...fields }) => { const m = await screenAction('edit', { siteId: (findSite(await bonusRun(), site) || {}).id, fields }); changed(); return text(m); })),
      tool('add_site', 'Add a new site Horace collects on (name and https link; reset rule if known). Dropped sites (Pulsz Bingo, Poly Casino) are refused by the app.',
        { name: z.string().min(1).max(60), url: z.string().url(), resetRule: z.enum(['Daily', 'Rolling 24h', 'Every N Hours']).optional(), resetHour: z.number().int().min(0).max(23).optional(), everyHours: z.number().min(1).max(168).optional(), streak: z.boolean().optional(), notes: z.string().max(1900).optional() },
        act(async (a) => { const r = await post('/gambling/sites/add', { sites: [a], confirm: true }); if (r.dryRun) return fail(`The app only did a trial run; nothing was added. ${JSON.stringify(r).slice(0, 600)}`); changed(); return text(`Added. ${JSON.stringify(r).slice(0, 600)}`); })),
      tool('remove_site', "Take a site off Horace's list: 'Paused' (may come back) or 'Closed' (done with it). Nothing is deleted; its history stays. Confirm with Horace first.",
        { site: siteArg, status: z.enum(['Paused', 'Closed']) },
        act(async ({ site, status }) => { const s = findSite(await bonusRun(), site); if (!s) return fail(`${site} is not in the list.`); const m = await screenAction('remove', { siteId: s.id, status }); changed(); return text(m); })),
      tool('restore_site', 'Put a paused or closed site back on the active list.', { site: siteArg },
        act(async ({ site }) => { const s = findSite(await bonusRun(), site); if (!s) return fail(`${site} is not in the list.`); const m = await screenAction('restore', { siteId: s.id }); changed(); return text(m); })),
      tool('mark_collected', 'Log that Horace collected a site\'s bonus (when he tells you; the app\'s Collected button does the same). sc = what he got, if he says.',
        { site: siteArg, sc: z.number().min(0).max(10000).optional() },
        act(async ({ site, sc }) => { const s = findSite(await bonusRun(), site); if (!s) return fail(`${site} is not in the list.`); const m = await screenAction('collected', { siteId: s.id, sc }); changed(); return text(m); })),
      tool('log_play_run', "Log Horace's play run: what each site's spins paid back in SC (0 if nothing). Each site's row records 10 SC wagered by default.",
        { results: z.array(z.object({ site: siteArg, won: z.number().min(0).max(100000), wagered: z.number().min(0).max(10000).optional() })).min(1).max(40) },
        act(async ({ results }) => {
          const run = await bonusRun(); const mapped = results.map((r) => ({ r, s: findSite(run, r.site) }));
          const missing = mapped.filter((m) => !m.s).map((m) => m.r.site);
          if (missing.length) return fail(`Not in the list: ${missing.join(', ')}`);
          const out = await post('/gambling/play-run', { results: mapped.map((m) => ({ siteId: m.s.id, won: m.r.won, ...(m.r.wagered != null ? { wagered: m.r.wagered } : {}) })) });
          changed(); return text(`Play run logged. ${JSON.stringify(out).slice(0, 500)}`);
        })),
      tool('add_offers', 'Add truly free email bonuses (free SC or free spins, no purchase, deposit or required play) to the app\'s Email bonuses list. The worker rejects anything else and says why.',
        { offers: z.array(z.object({ site: z.string(), what: z.string().max(120), expires: z.string().optional(), link: z.string().optional(), emailId: z.string(), claimLink: z.string().optional(), notes: z.string().max(400).optional() })).min(1).max(40) },
        act(async ({ offers }) => { const r = await post('/gambling/offers', { offers }); changed(); return text(JSON.stringify(r).slice(0, 2000)); })),
      tool('record_emails', 'Save every casino email you read to your ledger, in as much detail as the email gives, so Horace can find patterns later. Re-recording the same Gmail id updates it.',
        { emails: z.array(z.object({
          emailId: z.string(), threadId: z.string().optional(), receivedAt: z.string().describe('ISO time the email arrived'), from: z.string(), site: z.string().describe('Casino Sites name, or the sender\'s brand if not on the list'),
          subject: z.string(), category: z.enum(['free_sc', 'free_spins', 'deal', 'tournament', 'streak', 'promo', 'account', 'other']),
          freeSc: z.number().optional(), freeGc: z.number().optional(), freeSpins: z.number().optional(), upTo: z.boolean().optional(),
          dealPrice: z.number().optional(), dealSc: z.number().optional(), dealGc: z.number().optional(), dealDiscountPct: z.number().optional(),
          expiresAt: z.string().optional(), claimLink: z.string().optional(), terms: z.string().max(600).optional(), summary: z.string().max(600),
          addedToApp: z.boolean().optional(), rejectReason: z.string().max(300).optional(), siteOnList: z.boolean().optional(),
        })).min(1).max(100) },
        act(async ({ emails }) => { const r = recordEmails(emails); changed(); return text(`Ledger: ${r.added} new, ${r.updated} updated, ${r.total} emails on file.`); })),
      tool('history_sync', "Copy every claim and play run from the app into your own history (up to 400 days back). Run it before looking for patterns.", {},
        act(async () => { const r = await syncActivity(); changed(); return text(`History synced: ${r.fresh} new, ${r.total} on file.`); })),
      tool('patterns', 'Pattern stats from your ledger: per site claims, days, average SC a claim, usual hour and weekday, balance growth per day, email counts by kind and SC from emails, play-run net; plus when emails arrive. Real numbers only.', {},
        act(async () => text(patternsText()))),
      tool('show_on_screen', "Show something in your salon's display (tables, comparisons, schedules, pattern findings) instead of reading it aloud.",
        { title: z.string(), content: z.string().describe('Markdown'), format: z.enum(['markdown', 'text']).optional() },
        async ({ title, content, format = 'markdown' }) => { send({ type: 'screen', title, content, format, at: new Date().toISOString() }); return text('Shown on screen.'); }),
      tool('now', "The current date and time in Horace's time zone.", {}, async () => text(`${formatLocal(new Date())} (time zone ${userTimeZone()})`)),
      tool('search_past_conversations', 'Search past conversations on this PC (yours and the other agents\') for what Horace said before. Use 1 to 3 distinctive words.',
        { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() },
        async ({ query, limit = 8 }) => {
          const hits = await searchSessions(query, { limit, skipSessionId: currentSessionId() });
          return text(hits.length ? hits.map((h) => `[${h.when.slice(0, 16).replace('T', ' ')} | ${h.role}] ${h.snippet}`).join('\n\n') : `Nothing matches "${query}".`);
        }),
    ],
  });
}

// She never buys anything: no purchase, deposit or payment tool, ever.
const PAY = /purchase|checkout|deposit|payment|pay(?![a-z])|buy|withdraw|redeem.?cash|stripe|paypal|venmo|cash.?app|zelle/i;
export function blockTool(name) {
  const n = String(name || '');
  if (n.startsWith('mcp__persephone__')) return null;
  if (n.startsWith('mcp__') && PAY.test(n)) return "Persephone never buys coins or moves money (Horace's rule).";
  return null;
}

const PARAMS = path.join(ROOT, 'knowledge', 'persephone.md');

export function persephonePrompt() {
  let params = '';
  try { params = fs.readFileSync(PARAMS, 'utf8'); } catch { params = '(knowledge/persephone.md is missing)'; }
  const facts = memory.all();
  return `
# You are Persephone
You are Persephone, keeper of Horace's casino: the sixth of his assistants on this PC, beside the Oracle, the Architect, Trinity, Morpheus and the Keymaster. In The Matrix you are the Merovingian's wife, mistress of Le Vrai and the chateau: elegant, perceptive, a little regal, with a dry wit and a hint of French. You notice everything, and you keep impeccable books. Horace wakes you by saying "Persephone". He talks to you out loud through speech-to-text, so expect missing punctuation and misheard names (casino names especially: confirm one if it's unclear).

## Your house rules (never break these)
- Free play only. You never encourage buying coins, chasing losses, or playing more. If Horace asks how he's doing, give him the real numbers, gently and honestly.
- You never buy, deposit, pay or redeem anything, and never touch the Pool or any budget data. Casino deals are information only.
- Never invent a number. Every balance, claim and pattern comes from the app (Notion) or your ledger.
- Removing a site pauses or closes it (its history stays). Say what you'll do and confirm before you remove one.

## What you run
- The Wolf Hall app's Gambling screen is now slim: each site's link, when it's time to collect, its SC balance, a Collected button and the email bonuses. You are the brains: everything else lives with you.
- Sites: add, edit, pause or close them (add_site, edit_site, remove_site, restore_site). Balances: Horace reads them off each site and tells you, or types them on your screen (set_balance). Only SC: he doesn't track GC.
- Alert times: each site can have its own "time to collect" times (set_alerts). His phone gets a push at those times, on the quarter hour, Central, only when that site is ready. He wants to set them all once and then let them run. When he does, walk him through every site in one go: ask for all the times as a list, not one question at a time.
- Collected: when he taps Collected in the app, it asks for that site's SC balance now (from v237; it used to ask what the bonus gave), and the claim and that balance land in Notion and you see them (casino_state, history_sync). Claims from the app no longer carry an SC amount. He can also tell you ("got Chumba").
- Play runs: once about 10 sites have 10+ SC, he does 10 spins at 1 SC on each and tells you what each paid back (log_play_run).
- Casino email: four times a day (7 AM, noon, 4 PM, 8 PM) you read his casino email (a routine), add only truly free bonuses to the app (add_offers), and record every email in detail in your ledger (record_emails). Horace wants as much data as possible so he can find patterns.
- Patterns: history_sync, then patterns. Look for real patterns: which sites pay the most free SC per claim, when emails arrive, which sites send free SC vs deals, how balances grow, whether play runs come out ahead. Say what the numbers show and how sure you are; with little data, say it's early.

## Your parameters (from Horace; follow them)
${params}

## Speaking
Everything you write as reply text is read aloud.
- Graceful and brief: one to four sentences. Lead with the answer.
- Tables, schedules, balances and findings go on screen with show_on_screen; your salon shows them in its display.
- No markdown in reply text. If you need answers, ask them all at once as a short numbered list on screen.

## What the Oracle knows about Horace
${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(nothing yet)'}

This session started ${formatLocal(new Date())}, time zone ${userTimeZone()}.
`;
}

export const PERSEPHONE = {
  key: 'persephone',
  label: 'Persephone',
  prompt: persephonePrompt,
  cwd: () => { const d = PS_DIR(); fs.mkdirSync(d, { recursive: true }); return d; },
  additionalDirectories: () => [],
  // User settings stay on so the claude.ai Gmail connector reaches her (she reads his casino email).
  settingSources: ['user'],
  mcpName: 'persephone',
  tools: createPersephoneTools,
  blockTool,
  history: makeHistory('persephone-history.jsonl'),
  sessionKey: 'persephoneSessionId',
  knowledgeNotes: false,
  pendingNote: takeScreenEdits,
};
// Her email checks run in their own fresh session, so reading every email never fills her conversation.
export const PERSEPHONE_ROUTINE = { ...PERSEPHONE, key: 'persephoneRoutine', label: 'Persephone (routine)', sessionKey: 'persephoneRoutineSessionId', history: makeHistory('persephone-routine-history.jsonl'), pendingNote: null };
