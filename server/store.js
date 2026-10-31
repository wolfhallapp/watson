// Small JSON/text persistence under data/: conversation history, session id,
// The Oracle's long-term memory notes and reminders.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const file = (name) => path.join(DATA_DIR, name);

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
}

// ── Session state (lets the Oracle resume the same conversation after a restart) ──
export const state = {
  get() { return readJson('state.json', {}); },
  set(patch) { writeJson('state.json', { ...this.get(), ...patch }); },
};

// ── Conversation history shown in the UI (one file per agent: the Oracle, the Architect) ──
export function makeHistory(name) {
  return {
    append(entry) {
      fs.appendFileSync(file(name), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    },
    recent(n = 150) {
      try {
        const lines = fs.readFileSync(file(name), 'utf8').trim().split('\n');
        return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    },
  };
}
export const history = makeHistory('history.jsonl');

// ── Long-term memory: one fact per line in data/memory.md ──
const MEMORY = 'memory.md';
export const memory = {
  all() {
    try { return fs.readFileSync(file(MEMORY), 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)); } catch { return []; }
  },
  add(fact) {
    const clean = fact.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const facts = this.all();
    if (!facts.includes(clean)) facts.push(clean);
    this.save(facts);
  },
  remove(match) {
    const needle = match.toLowerCase();
    const facts = this.all();
    const kept = facts.filter((f) => !f.toLowerCase().includes(needle));
    this.save(kept);
    return facts.length - kept.length;
  },
  save(facts) {
    fs.writeFileSync(file(MEMORY), '# Things the Oracle remembers\n\n' + facts.map((f) => `- ${f}`).join('\n') + '\n');
  },
};

// ── Reminders ──
export const reminders = {
  all() { return readJson('reminders.json', []); },
  save(list) { writeJson('reminders.json', list); },
  add(r) { const list = this.all(); list.push(r); this.save(list); return r; },
  remove(id) { const list = this.all(); const kept = list.filter((r) => r.id !== id); this.save(kept); return list.length !== kept.length; },
};
