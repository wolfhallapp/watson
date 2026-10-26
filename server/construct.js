// The Construct (2026-10-25, per Horace): his project to find 1,000 small, legit ways to earn
// money from home, run by the Architect. One tree: 10 branches (more can grow), strategies on
// each, and for every strategy its setup steps, notes and the real payouts it made.
//
// Lives in data/construct.json on this PC (never pushed). The first run seeds it from
// server/construct-seed.json, a copy of the Notion "The Tree" database as of 2026-10-25.
// Earned totals always come from logged payouts, never from estimates. None of this touches
// the Wolf Hall Pool or budget.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, ROOT } from './config.js';

export const GOAL = 1000;
export const DEFAULT_BRANCHES = ['1 Passive devices', '2 Cashback & receipts', '3 Rewards & points', '4 Paid opinions & testing',
  '5 AI training work', '6 Found money', '7 Sell your stuff', '8 Digital products', '9 Services with AI', '10 Content & affiliate'];
export const OPTIONS = {
  status: ['Idea', 'Researching', 'Started', 'Earning', 'Paused', 'Dropped'],
  setup: ['Minutes', 'An hour', 'A day', 'A week+'],
  dailyTime: ['None', 'Under 5 min', '15-30 min', '1 hr+'],
  role: ['Runs it for you', 'Does most of it', 'Helps', 'You only'],
  risk: ['Low', 'Medium', 'High'],
  kind: ['Cash', 'Gift card', 'Savings', 'Credit'],
};
const TZ = 'America/Chicago';
const FIELDS = ['name', 'branch', 'status', 'estMonthly', 'setup', 'dailyTime', 'role', 'risk', 'priority', 'how', 'watch', 'link'];

const money = (n) => Math.round(n * 100) / 100;
const newId = (p) => p + crypto.randomBytes(4).toString('hex');
export const dayStr = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export class Construct {
  /** @param {string} file JSON file; @param {string|null} seedFile used when the file doesn't exist yet */
  constructor(file = path.join(DATA_DIR, 'construct.json'), seedFile = path.join(ROOT, 'server', 'construct-seed.json')) {
    this.file = file;
    this.seedFile = seedFile;
    this.listeners = new Set();
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let seed = { strategies: [] };
    try { if (this.seedFile) seed = JSON.parse(fs.readFileSync(this.seedFile, 'utf8')); } catch {}
    const data = { goal: GOAL, branches: [...DEFAULT_BRANCHES], strategies: seed.strategies || [], seededFrom: seed.seededFrom || null };
    this.save(data);
    return data;
  }

  save(data) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Find a strategy by id, or loosely by name ("prolific" finds "Prolific research studies"). */
  static find(data, ref) {
    if (!ref) return null;
    const list = data.strategies;
    const n = norm(ref);
    return list.find((s) => s.id === ref) || list.find((s) => norm(s.name) === n)
      || (n.length >= 3 ? list.filter((s) => norm(s.name).includes(n)).sort((a, b) => a.name.length - b.name.length)[0] : null) || null;
  }

  /**
   * Do one thing to the tree. Used by both the Architect's tool and the screen's buttons.
   * Returns { ok, message, strategy? }; throws Error with a plain message when the input is wrong.
   */
  apply(action, a = {}) {
    const data = this.load();
    const result = this.#apply(data, action, a);
    if (result.changed !== false) {
      this.save(data);
      for (const fn of this.listeners) { try { fn(this.summary(data)); } catch {} }
    }
    delete result.changed;
    return result;
  }

  #need(data, a) {
    const s = Construct.find(data, a.id || a.strategy);
    if (!s) throw new Error(`No strategy matches "${a.id || a.strategy || ''}".`);
    return s;
  }

  #setFields(data, s, a) {
    for (const k of FIELDS) {
      if (a[k] === undefined) continue;
      let v = a[k];
      if (k === 'branch') {
        if (!data.branches.includes(v)) throw new Error(`Unknown branch "${v}". Branches: ${data.branches.join(', ')}. Add one with add_branch first.`);
      } else if (OPTIONS[k]) {
        if (!OPTIONS[k].includes(v)) throw new Error(`${k} must be one of: ${OPTIONS[k].join(', ')}`);
      } else if (k === 'estMonthly' || k === 'priority') {
        v = v === null || v === '' ? null : Number(v);
        if (v !== null && !(Number.isFinite(v) && v >= 0 && v <= 100000)) throw new Error(`${k} must be a number`);
      } else {
        v = String(v).slice(0, k === 'name' ? 200 : 2000).trim();
        if (k === 'name' && !v) throw new Error('A strategy needs a name.');
      }
      s[k] = v;
    }
    s.updated = new Date().toISOString();
  }

  #apply(data, action, a) {
    switch (action) {
      case 'add': {
        const items = Array.isArray(a.strategies) ? a.strategies : [a];
        const added = [], skipped = [];
        for (const it of items) {
          if (!it.name || !it.branch) throw new Error('Each new strategy needs a name and a branch.');
          if (data.strategies.some((s) => norm(s.name) === norm(it.name))) { skipped.push(it.name); continue; }
          const s = { id: newId('s'), status: 'Idea', steps: [], notes: [], payouts: [], created: new Date().toISOString() };
          this.#setFields(data, s, { ...it, status: it.status || 'Idea' });
          if (Array.isArray(it.steps)) s.steps = it.steps.map((t) => ({ id: newId('t'), text: String(t).slice(0, 500), done: false }));
          data.strategies.push(s);
          added.push(s.name);
        }
        return { ok: true, changed: added.length > 0, message: `Planted ${added.length}${skipped.length ? `; already on the tree: ${skipped.join(', ')}` : ''}. The tree has ${data.strategies.length} of ${data.goal}.` };
      }
      case 'update': {
        const s = this.#need(data, a);
        this.#setFields(data, s, a.fields || a);
        return { ok: true, message: `Updated ${s.name}.`, strategy: s };
      }
      case 'add_branch': {
        const name = String(a.name || '').trim().slice(0, 60);
        if (!name) throw new Error('Name the branch.');
        if (data.branches.some((b) => norm(b) === norm(name))) return { ok: true, changed: false, message: `${name} is already a branch.` };
        const label = /^\d+\s/.test(name) ? name : `${data.branches.length + 1} ${name}`;
        data.branches.push(label);
        return { ok: true, message: `New branch: ${label}.` };
      }
      case 'add_steps': {
        const s = this.#need(data, a);
        const steps = (a.steps || []).map((t) => String(t).trim()).filter(Boolean);
        if (!steps.length) throw new Error('Give the steps.');
        if (a.replace) s.steps = s.steps.filter((t) => t.done);
        for (const t of steps) s.steps.push({ id: newId('t'), text: t.slice(0, 500), done: false });
        if (s.status === 'Idea') s.status = 'Researching';
        s.updated = new Date().toISOString();
        return { ok: true, message: `${s.name} now has ${s.steps.length} steps.`, strategy: s };
      }
      case 'step': {
        const s = this.#need(data, a);
        const st = s.steps.find((t) => t.id === a.stepId) || (Number.isInteger(a.number) ? s.steps[a.number - 1] : null);
        if (!st) throw new Error(`${s.name} has no step ${a.stepId || a.number || ''}.`);
        st.done = a.done !== false;
        st.doneAt = st.done ? new Date().toISOString() : undefined;
        if (st.done && (s.status === 'Idea' || s.status === 'Researching')) s.status = 'Started';
        s.updated = new Date().toISOString();
        const left = s.steps.filter((t) => !t.done).length;
        return { ok: true, message: `${st.done ? 'Done' : 'Reopened'}: ${st.text}. ${left} step${left === 1 ? '' : 's'} left on ${s.name}.`, strategy: s };
      }
      case 'note': {
        const s = this.#need(data, a);
        const t = String(a.text || '').trim();
        if (!t) throw new Error('Give the note.');
        s.notes.push({ at: new Date().toISOString(), text: t.slice(0, 2000) });
        s.updated = new Date().toISOString();
        return { ok: true, message: `Noted on ${s.name}.`, strategy: s };
      }
      case 'payout': {
        const s = this.#need(data, a);
        const amount = Number(a.amount);
        if (!(Number.isFinite(amount) && money(amount) >= 0.01 && amount <= 100000)) throw new Error('The amount must be at least $0.01.');
        const today = dayStr();
        const date = a.date ? String(a.date) : today;
        const dt = new Date(date + 'T12:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== date || date > today) throw new Error('The date must be a real YYYY-MM-DD, not in the future.');
        const kind = a.kind || 'Cash';
        if (!OPTIONS.kind.includes(kind)) throw new Error(`kind must be one of: ${OPTIONS.kind.join(', ')}`);
        s.payouts.push({ id: newId('p'), amount: money(amount), date, kind, notes: String(a.notes || '').slice(0, 500), logged: new Date().toISOString() });
        if (['Idea', 'Researching', 'Started'].includes(s.status)) s.status = 'Earning';
        s.updated = new Date().toISOString();
        return { ok: true, message: `Logged $${money(amount).toFixed(2)} from ${s.name}. It has earned $${earned(s).toFixed(2)} so far.`, strategy: s };
      }
      case 'undo_payout': {
        for (const s of data.strategies) {
          const i = s.payouts.findIndex((p) => p.id === a.payoutId);
          if (i < 0) continue;
          const [p] = s.payouts.splice(i, 1);
          s.updated = new Date().toISOString();
          return { ok: true, message: `Removed the $${p.amount.toFixed(2)} payout from ${s.name}.`, strategy: s };
        }
        throw new Error('No payout with that id.');
      }
      default:
        throw new Error(`Unknown action ${action}.`);
    }
  }

  /** Everything the screen shows: totals, branches, strategies (best first) and recent payouts. */
  summary(data = this.load(), now = new Date()) {
    const today = dayStr(now);
    const monthStart = today.slice(0, 8) + '01';
    const weekStart = dayStr(new Date(now.getTime() - 6 * 864e5));
    const pays = data.strategies.flatMap((s) => s.payouts.map((p) => ({ ...p, strategyId: s.id, strategy: s.name })));
    const sum = (list) => money(list.reduce((t, p) => t + p.amount, 0));
    const live = data.strategies.filter((s) => s.status === 'Started' || s.status === 'Earning');
    const rank = { Earning: 0, Started: 1, Researching: 2, Idea: 3, Paused: 4, Dropped: 5 };
    const strategies = data.strategies.map((s) => ({
      ...s, earned: earned(s), stepsDone: s.steps.filter((t) => t.done).length,
      nextStep: s.steps.find((t) => !t.done) || null,
    })).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (a.priority ?? 99) - (b.priority ?? 99) || a.name.localeCompare(b.name));
    return {
      goal: data.goal || GOAL,
      today,
      options: OPTIONS,
      totals: {
        strategies: data.strategies.length,
        live: live.length,
        earning: data.strategies.filter((s) => s.status === 'Earning').length,
        estMonthlyLive: money(live.reduce((t, s) => t + (s.estMonthly || 0), 0)),
        earnedAll: sum(pays), earnedMonth: sum(pays.filter((p) => p.date >= monthStart)), earnedWeek: sum(pays.filter((p) => p.date >= weekStart)),
      },
      branches: data.branches.map((b) => {
        const mine = data.strategies.filter((s) => s.branch === b);
        return { name: b, count: mine.length, live: mine.filter((s) => s.status === 'Started' || s.status === 'Earning').length, earned: money(mine.reduce((t, s) => t + earned(s), 0)) };
      }),
      strategies,
      // Today's moves: the next open step on everything being worked on.
      moves: strategies.filter((s) => ['Researching', 'Started', 'Earning'].includes(s.status) && s.nextStep)
        .map((s) => ({ strategyId: s.id, strategy: s.name, step: s.nextStep })),
      recentPayouts: pays.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 30),
    };
  }

  /** A compact text view of the tree for the Architect. */
  describe(filter = {}) {
    const sum = this.summary();
    let list = sum.strategies;
    if (filter.branch) list = list.filter((s) => norm(s.branch).includes(norm(filter.branch)));
    if (filter.status) list = list.filter((s) => s.status === filter.status);
    const t = sum.totals;
    const head = `The tree: ${t.strategies} of ${sum.goal} ways · ${t.live} running · earned $${t.earnedAll.toFixed(2)} all time, $${t.earnedMonth.toFixed(2)} this month.\nBranches: ${sum.branches.map((b) => `${b.name} (${b.count})`).join(', ')}`;
    const rows = list.map((s) => {
      const steps = s.steps.length ? ` · steps ${s.stepsDone}/${s.steps.length}${s.nextStep ? ` (next: ${s.nextStep.text} [${s.nextStep.id}])` : ''}` : '';
      return `- [${s.id}] ${s.name} · ${s.branch} · ${s.status}${s.estMonthly != null ? ` · est $${s.estMonthly}/mo` : ''}${s.earned ? ` · earned $${s.earned.toFixed(2)}` : ''}${steps}`;
    });
    return head + '\n' + (rows.join('\n') || '(no strategies match)');
  }
}

function earned(s) { return money((s.payouts || []).reduce((t, p) => t + p.amount, 0)); }
