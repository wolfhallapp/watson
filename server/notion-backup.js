// Nightly Notion backup (11/23, Night Shift queue #22). Every night after 3 AM Central the Oracle copies every
// Wolf Hall database to C:\Users\Owner\Documents\Wolf Hall backups\YYYY-MM-DD\<name>.json and keeps 14 days.
// The first complete backup of each month is also copied to monthly\YYYY-MM and kept 12 months (#120, for Google Drive).
// It reads through the worker's GET /system/backup (Wolf Hall v300: master key only, read-only, 100 rows a call),
// so there is no Notion token on the PC. The folder is private: never in git, never uploaded anywhere.
// No AI call. Until v300 is deployed the route answers 404/403, and the backup waits quietly.
import fs from 'node:fs';
import path from 'node:path';
import { WORKER_URL, workerKey } from './knowledge.js';
import { windowsNotify } from './notify.js';

export const BACKUP_DIR = process.env.WATSON_BACKUP_DIR || '/mnt/c/Users/Owner/Documents/Wolf Hall backups';
export const KEEP_DAYS = 14;
export const RUN_HOUR = 3; // Central; after the Night Shift starts, before the 6:40 briefing
export const CHECK_MS = 10 * 60 * 1000;
export const TRIES_PER_DAY = 3; // a failed night is retried, but not all day long
const MAX_PAGES = 500; // 50,000 rows per table, a guard against a cursor that never ends

/** YYYY-MM-DD and the hour in Central time. */
export function central(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return { day, hour };
}

async function getJson(fetchFn, url, key) {
  const r = await fetchFn(url, { headers: { 'X-Worker-Key': key }, signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}

/** Day folders (YYYY-MM-DD) older than keepDays before `day` are removed. Nothing else in the folder is touched. */
export function prune(dir, day, keepDays = KEEP_DAYS) {
  const cutoff = new Date(Date.parse(day + 'T12:00:00Z') - keepDays * 86400000).toISOString().slice(0, 10);
  const gone = [];
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name <= cutoff && fs.statSync(path.join(dir, name)).isDirectory()) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      gone.push(name);
    }
  }
  return gone;
}

/**
 * One full backup. Returns { ok, day, counts: {name: rows}, errors: {name: text}, pruned } or
 * { ok: false, waiting: true } when the route isn't live yet (nothing is written then).
 * Each table goes to <name>.json.part first and is renamed only when complete, so a half table never
 * looks like a good one. A failed table is listed in _summary.json and the rest still run.
 */
export async function runBackup({ fetchFn = fetch, workerUrl = WORKER_URL, key = workerKey(), dir = BACKUP_DIR, now = new Date(), keepDays = KEEP_DAYS } = {}) {
  const { day } = central(now);
  const list = await getJson(fetchFn, `${workerUrl}/system/backup`, key);
  if (list.status === 404 || list.status === 403 || !Array.isArray(list.json?.databases)) {
    return { ok: false, waiting: true, status: list.status };
  }
  const out = path.join(dir, day);
  fs.mkdirSync(out, { recursive: true });
  writeReadme(dir);
  const counts = {}, errors = {};
  for (const name of list.json.databases) {
    if (!/^[a-z0-9-]+$/.test(name)) { errors[name] = 'bad name'; continue; }
    try {
      const rows = []; let cursor = null, id = null, pages = 0;
      do {
        const r = await getJson(fetchFn, `${workerUrl}/system/backup?db=${name}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, key);
        if (r.status !== 200 || !Array.isArray(r.json?.rows)) throw new Error(`HTTP ${r.status}${r.json?.error ? ': ' + r.json.error : ''}`);
        rows.push(...r.json.rows); id = r.json.id; cursor = r.json.has_more ? r.json.next_cursor : null;
        if (++pages > MAX_PAGES) throw new Error('too many pages');
      } while (cursor);
      const file = path.join(out, `${name}.json`);
      fs.writeFileSync(file + '.part', JSON.stringify({ db: name, id, backedUpAt: now.toISOString(), count: rows.length, rows }, null, 1));
      fs.renameSync(file + '.part', file);
      counts[name] = rows.length;
    } catch (e) { errors[name] = String(e.message || e); }
  }
  const ok = Object.keys(errors).length === 0;
  fs.writeFileSync(path.join(out, '_summary.json'), JSON.stringify({ day, at: now.toISOString(), ok, counts, errors }, null, 2));
  const pruned = prune(dir, day, keepDays);
  let monthly = null; // a locked file (Drive syncing it) must not lose the night's backup, so a copy error is only reported
  if (ok) try { monthly = keepMonthly(dir, day); } catch (e) { monthly = { copied: null, pruned: [], error: String(e.message || e) }; }
  return { ok, day, counts, errors, pruned, monthly };
}

export const MONTHLY_DIR = 'monthly';
export const KEEP_MONTHS = 12;

/**
 * Monthly copy (11/24, Night Shift #120): the first complete backup of each month (normally the 1st) is also copied
 * to monthly/YYYY-MM/, and month folders older than keepMonths are removed. Horace can point Google Drive for desktop
 * at the monthly folder so one copy a month lives off the PC. Copies to YYYY-MM.part first, then renames.
 * Returns { copied: 'YYYY-MM' | null, pruned: [...] }.
 */
export function keepMonthly(dir, day, keepMonths = KEEP_MONTHS) {
  const month = day.slice(0, 7);
  const mdir = path.join(dir, MONTHLY_DIR);
  fs.mkdirSync(mdir, { recursive: true });
  let copied = null;
  const dest = path.join(mdir, month);
  if (!fs.existsSync(dest)) {
    fs.rmSync(dest + '.part', { recursive: true, force: true });
    fs.cpSync(path.join(dir, day), dest + '.part', { recursive: true });
    fs.renameSync(dest + '.part', dest);
    copied = month;
  }
  const [y, m] = month.split('-').map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1 - keepMonths, 1)).toISOString().slice(0, 7);
  const pruned = [];
  for (const name of fs.readdirSync(mdir)) {
    if (/^\d{4}-\d{2}$/.test(name) && name <= cutoff && fs.statSync(path.join(mdir, name)).isDirectory()) {
      fs.rmSync(path.join(mdir, name), { recursive: true, force: true });
      pruned.push(name);
    }
  }
  return { copied, pruned };
}

export function doneToday(dir = BACKUP_DIR, now = new Date()) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, central(now).day, '_summary.json'), 'utf8')).ok === true; } catch { return false; }
}

export const README = `# Wolf Hall backups (private)

The Oracle copies every Wolf Hall Notion database here each night after 3 AM and keeps the last 14 days.
Nothing here is in git. Each day folder has one JSON file per database plus _summary.json
(row counts and any table that failed). It reads through the worker's /system/backup, master key only.

The first complete backup of each month (normally the 1st) is also copied to monthly\\YYYY-MM and kept 12 months.
Only that monthly folder is meant for Google Drive (Horace's choice, 11/23): Google Drive for desktop syncs it to
his own Drive. The day folders stay on the PC.

Left out on purpose: the Jake-Taylor private chat thread, and push-subscription keys (phones re-subscribe by themselves).

## Restore one row by hand

1. Open the day folder from before the mistake and the file for that table (for example bill-payment-log.json).
   Search it for the row's name. Each row has its id, created_time, last_edited_time and properties.
2. If the row still exists in Notion but a field is wrong: open it in Notion and type the old values back in from
   "properties" (a number is under "number", text under "rich_text" -> "plain_text", a choice under "select" -> "name",
   a date under "date" -> "start", a checkbox under "checkbox").
3. If the row was deleted: first look in Notion's Trash (Settings > Trash) and restore it there; that keeps its id,
   which other rows may point at (for example a "Project ID" or "Wishlist Item ID" stamp). Only if it's gone from Trash,
   add a new row in the same table and type the values in. The new row gets a new id, so search the other backup files
   for the old id and fix any row that pointed at it.
4. Money tables (bills, Bill Payment Log, receipts, line items, the Pool in live-state): restore the record only. Never
   press Pay or change the Pool to "replay" a payment; the bank balance already has it (CLAUDE.md conventions 1 and 18).
   Ask Horace before restoring anything in these.
`;

export function writeReadme(dir = BACKUP_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'README.md');
  if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== README) fs.writeFileSync(f, README);
}

let timer = null, running = false, waitingLogged = false;
const tries = new Map(); // day -> attempts
/** Checks every 10 minutes; runs once a day after RUN_HOUR Central when today's backup isn't done yet (up to 3 tries). */
export function startNotionBackup({ every = CHECK_MS } = {}) {
  const tick = async () => {
    const now = new Date();
    const { day, hour } = central(now);
    if (running || hour < RUN_HOUR || (tries.get(day) || 0) >= TRIES_PER_DAY || doneToday(BACKUP_DIR, now)) return;
    running = true;
    try {
      const r = await runBackup({ now });
      if (!r.waiting) tries.set(day, (tries.get(day) || 0) + 1);
      if (r.waiting) { if (!waitingLogged) console.log(`  Notion backup: waiting for Wolf Hall v300 (/system/backup answered ${r.status})`); waitingLogged = true; return; }
      const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
      console.log(`  Notion backup ${r.day}: ${Object.keys(r.counts).length} tables, ${total} rows${r.ok ? '' : `, ${Object.keys(r.errors).length} failed`}${r.monthly?.copied ? `; monthly copy ${r.monthly.copied}` : ''}${r.monthly?.error ? `; monthly copy failed: ${r.monthly.error}` : ''}`);
      if (!r.ok && tries.get(day) >= TRIES_PER_DAY) windowsNotify(`Wolf Hall backup: ${Object.keys(r.errors).length} table(s) failed tonight after ${TRIES_PER_DAY} tries (${Object.keys(r.errors).join(', ')}). The rest are saved; it runs again tomorrow night.`);
    } catch (e) { tries.set(day, (tries.get(day) || 0) + 1); console.warn('  Notion backup:', e.message); }
    finally { running = false; }
  };
  if (timer) clearInterval(timer);
  timer = setInterval(tick, every);
  setTimeout(tick, 90000);
  return () => clearInterval(timer);
}
