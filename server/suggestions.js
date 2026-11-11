// Suggestions that learn (designed 2026-11-06, built 2026-11-11 on the Night Shift, per Horace 11/4).
// One small log, data/suggestions.jsonl: every idea the Oracle, the Architect or the Night Shift offers,
// and what Horace did with it. Each kind of idea gets a smoothed acceptance score, used to rank the
// open ideas for the morning briefing and to help the Night Shift pick its own work.
// It only ranks and suggests: nothing here ever runs anything, and the log never holds Taylor's Ask
// questions or anything from Morpheus.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

export const SOURCES = ['night', 'oracle', 'architect', 'briefing'];
export const KINDS = ['fix', 'new feature', 'polish', 'money', 'casino', 'taylor', 'oracle'];
export const OUTCOMES = ['offered', 'accepted', 'rejected', 'changed'];
export const IGNORED_AFTER_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** Smoothed acceptance rate: (accepted + 0.5 × changed + 1) / (offered + 2). A new kind starts at 0.5. */
export function kindScore({ offered = 0, accepted = 0, changed = 0 } = {}) {
  return (accepted + 0.5 * changed + 1) / (offered + 2);
}

/**
 * Folds the event log into one item per id: its latest answer, and "ignored" when it was offered
 * more than 7 days ago with no answer. Events without an "offered" line still count (an idea Horace
 * answered on the spot).
 */
export function foldItems(events, now = new Date()) {
  const items = new Map();
  for (const e of events) {
    if (!e || !e.id || !OUTCOMES.includes(e.outcome)) continue;
    let it = items.get(e.id);
    if (!it) {
      it = { id: e.id, source: e.source, kind: e.kind, title: e.title, offeredAt: e.at, status: 'open', answeredAt: null, note: '' };
      items.set(e.id, it);
    }
    if (e.outcome === 'offered') { if (e.at < it.offeredAt) it.offeredAt = e.at; continue; }
    it.status = e.outcome;
    it.answeredAt = e.at;
    if (e.note) it.note = e.note;
  }
  for (const it of items.values()) {
    if (it.status === 'open' && now - new Date(it.offeredAt) > IGNORED_AFTER_DAYS * DAY) it.status = 'ignored';
  }
  return [...items.values()];
}

/** Per kind: counts and score. Every item counts as offered once, whatever happened next. */
export function scoreKinds(items) {
  const out = {};
  for (const k of KINDS) out[k] = { offered: 0, accepted: 0, changed: 0, rejected: 0, ignored: 0, open: 0 };
  for (const it of items) {
    const c = out[it.kind] || (out[it.kind] = { offered: 0, accepted: 0, changed: 0, rejected: 0, ignored: 0, open: 0 });
    c.offered += 1;
    c[it.status] += 1;
  }
  for (const c of Object.values(out)) c.score = kindScore(c);
  return out;
}

/** Open ideas, best kind first (ties: newest first). Money ideas rank like any other but always need his yes. */
export function rankOpen(items, scores = scoreKinds(items)) {
  return items
    .filter((it) => it.status === 'open')
    .sort((a, b) => (scores[b.kind]?.score ?? 0.5) - (scores[a.kind]?.score ?? 0.5) || (a.offeredAt < b.offeredAt ? 1 : -1));
}

const pct = (n) => `${Math.round(n * 100)}%`;

/** The "why" behind a kind's rank, in plain words. */
export function because(kind, scores) {
  const c = scores[kind];
  if (!c || !c.offered) return `no history yet for ${kind} ideas`;
  const yes = c.accepted + c.changed;
  return `you said yes to ${yes} of ${c.offered} ${kind} idea${c.offered === 1 ? '' : 's'}`;
}

/** One briefing line, or null when nothing is open. */
export function briefingLine(items) {
  const scores = scoreKinds(items);
  const [top] = rankOpen(items, scores);
  if (!top) return null;
  return `💡 Top idea today: ${top.title} (${because(top.kind, scores)}).`;
}

/** A short table of the scores, for the Night Shift and the list action. */
export function scoreSummary(items) {
  const scores = scoreKinds(items);
  const rows = Object.entries(scores)
    .filter(([, c]) => c.offered)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([k, c]) => `- ${k}: score ${pct(c.score)} (offered ${c.offered}: yes ${c.accepted}, yes with changes ${c.changed}, no ${c.rejected}, ignored ${c.ignored}, open ${c.open})`);
  return rows.length ? rows.join('\n') : 'No suggestions logged yet; every kind starts even (50%).';
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function makeSuggestionLog(filePath = path.join(DATA_DIR, 'suggestions.jsonl')) {
  const events = () => {
    try {
      return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  };
  const items = (now = new Date()) => foldItems(events(), now);

  /** Finds an item by exact id, else the newest item whose id or title contains the text. */
  const find = (match, now = new Date()) => {
    const all = items(now);
    const exact = all.find((it) => it.id === match);
    if (exact) return exact;
    const needle = String(match).toLowerCase();
    const hits = all.filter((it) => it.id.includes(needle) || it.title.toLowerCase().includes(needle));
    return hits.sort((a, b) => (a.offeredAt < b.offeredAt ? 1 : -1))[0] || null;
  };

  return {
    events,
    items,
    find,
    /** Logs one event. "offered" makes a new item; an answer needs `id` (or a match) of an earlier one, or a title and kind to log it fresh. */
    log({ outcome, id, match, source, kind, title, note = '' }, now = new Date()) {
      if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(', ')}`);
      let item = null;
      if (outcome !== 'offered' && (id || match)) {
        item = find(id || match, now);
        if (!item && !title) throw new Error(`No suggestion matches "${id || match}".`);
      }
      const e = {
        at: now.toISOString(),
        id: item?.id || id || `${slug(title)}-${crypto.randomBytes(2).toString('hex')}`,
        source: item?.source || source,
        kind: item?.kind || kind,
        title: item?.title || String(title || '').replace(/\s+/g, ' ').trim(),
        outcome,
        ...(note ? { note: String(note).replace(/\s+/g, ' ').trim() } : {}),
      };
      if (!SOURCES.includes(e.source)) throw new Error(`source must be one of ${SOURCES.join(', ')}`);
      if (!KINDS.includes(e.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
      if (!e.title) throw new Error('title is required');
      fs.appendFileSync(filePath, JSON.stringify(e) + '\n');
      return e;
    },
  };
}

export const suggestions = makeSuggestionLog();
