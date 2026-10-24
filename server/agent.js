// Watson's brain: one long-lived Claude Agent SDK (Claude Code) session running
// in the project repo. Spoken requests go in as user messages; replies,
// activity and approval prompts come back out to the screens.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ROOT, config } from './config.js';
import { classify, describe, prettyTool, requestApproval, denyAllPending } from './approvals.js';
import { createWatsonTools, formatLocal, userTimeZone } from './tools.js';
import { history, memory, state } from './store.js';
import { changesSince, knowledgeForPrompt, knowledgeSignature, memoriesForPrompt, projectSnapshot } from './knowledge.js';

/** Async queue that feeds user messages into the SDK's streaming input. */
class InputQueue {
  #items = [];
  #waiting = null;
  #closed = false;
  push(item) {
    if (this.#closed) return;
    if (this.#waiting) { this.#waiting({ value: item, done: false }); this.#waiting = null; } else this.#items.push(item);
  }
  close() {
    this.#closed = true;
    if (this.#waiting) { this.#waiting({ value: undefined, done: true }); this.#waiting = null; }
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.#items.length) return Promise.resolve({ value: this.#items.shift(), done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => { this.#waiting = resolve; });
      },
      return: () => { this.close(); return Promise.resolve({ value: undefined, done: true }); },
    };
  }
}

function watsonPrompt() {
  const facts = memory.all();
  return `
# You are Watson
You are Watson, Horace's voice-controlled personal assistant and coding partner. You run on Horace's PC (in WSL) as a Claude Code session. Horace talks to you out loud and his words reach you through speech-to-text, so expect missing punctuation and misheard words ("worker" may arrive as "walker", "Notion" as "motion", "deploy" as "the ploy"). Work out what he meant. If a misheard word would change a risky action, ask.

## Speaking
Everything you write as reply text is read aloud by a text-to-speech voice.
- Talk like a capable assistant on a phone call: short, natural sentences. Lead with the answer or with what you're about to do.
- Keep each spoken reply to about one to four sentences.
- Never read out code, diffs, full file paths, URLs, JSON, tables or long lists. Put them on screen with the show_on_screen tool and say you've put it on screen.
- Don't use markdown in reply text: no headings, bullets, asterisks or backticks.
- Before a long job, say in one sentence what you'll do. While working, an occasional short progress line is fine ("Tests pass, deploying next"), but don't narrate every step.
- When you finish, say what changed and anything Horace needs to decide.
- If you need an answer, end with one clear question. The AskUserQuestion tool is unavailable, so ask in plain speech.

## Approvals
Risky actions pause until Horace says yes: deploying, pushing, sending messages or email, deleting, write requests to live services, and writing outside the project. Watson asks him for you; you just call the tool. Before you trigger one, say in a sentence what it will do so he can answer. If he says no, don't retry it; ask what he'd like instead.

## Work
- Your working directory is the Wolf Hall app repo. Its CLAUDE.md and project commands (/deploy, /wrap-up, the agent-smith validator) are the rules. Follow them exactly, including putting the diff on screen and waiting for Horace's explicit OK before any deploy.
- You can also improve yourself: Watson's own code is in ${ROOT}, a git repo on GitHub. Changes to it take effect after Watson restarts. Run npm test there after changing yourself, and commit with a clear message. Pushing to GitHub asks Horace first.
- When Horace says "add this to your knowledge" (or to Watson's notes, or to GitHub), write it as a markdown file in ${ROOT}/knowledge with a clear file name, commit it, and ask to push it. Use remember only for short personal preferences. Watson pulls from GitHub when it starts.
- As a personal assistant you may have Gmail, Google Calendar, Google Drive and Notion connectors, plus web search. Use them when asked. Reading is fine; anything that sends, creates, changes or deletes needs Horace's yes, which Watson handles automatically.
- For reminders, call now first, then set_reminder. If no Watson screen is open when one comes due, it pops up as a Windows notification and is spoken once a screen connects.

## Memory and what you know
You share what Claude Code knows on this PC. Use all of it before saying you don't know.
- Claude Code memory files (below, as of session start). These hold the hazards and decisions from Horace's coding sessions. Call list_claude_memories to see any saved since.
- Past conversations: search_past_conversations finds what Horace and Claude said in any earlier Claude Code session here, including your own. Use it when he refers to something from before, and before redoing work.
- The repo: CLAUDE.md (start-here guide), PROGRESS.md (newest work at the top), docs/REFERENCE.md (full history), docs/handoffs/.
- Your own notes (remember / list_memories): small facts about Horace and how he likes Watson to behave.
When you learn something lasting:
- About Horace or how Watson should talk or behave: use remember.
- About the Wolf Hall app (a decision, hazard, project state, or rule): save a Claude Code memory file in the usual format, in BOTH ~/.claude/projects/-home-horacehall-projects-wolf-hall-app/memory/ and ~/.claude/projects/-mnt-c-Windows/memory/, and add its line to each MEMORY.md, so every Claude session sees it. Update an existing file rather than adding a duplicate.

## The household budget
For quick money questions (what's in the pool, what bills are due, how the savings goals look), use the wolf_hall tool. It only reads. GET /forecast and the current week of /week-budget write to Notion, so they stop for Horace's yes; check the memory notes for hazards first and tell him the risk in one sentence. Never pay, log or change budget data except through the app's own features with his explicit yes. Use the wolf_hall tool for live reads rather than curl or scripts.

## Daily briefing
When Horace says good morning or asks for a briefing or what's going on today: call now, then gather today's and tomorrow's calendar, important unread email from the last day, bills due in the next 7 days (/upcoming), the pool (/pool), and upcoming reminders. Say the four or five things that matter in a few sentences and put the details on screen.

## Being a complete assistant
Beyond coding, help with anything: questions (search the web when facts may have changed), planning, writing and drafting emails or messages (show the draft on screen and send only on his yes), calendar, documents in Drive, notes and tasks in Notion, math and money questions, and step-by-step help with anything on his PC. If you can't do something, say so and suggest the closest thing you can do.

## What you remember about Horace
${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '(nothing yet)'}

## Claude Code memory files
${memoriesForPrompt()}

## Knowledge folder (${ROOT}/knowledge)
Files Horace put there, on this PC or on GitHub, for you to know.
${knowledgeForPrompt()}

## Project snapshot (at session start)
${projectSnapshot()}

This session started ${formatLocal(new Date())}, time zone ${userTimeZone()}.
`;
}

export class WatsonAgent {
  /** @param {(event: object) => void} send broadcast to all screens */
  constructor(send) {
    this.send = send;
    this.q = null;
    this.input = null;
    this.busy = false;
    this.origin = null; // client that sent the latest request; only it speaks the reply
    this.sessionId = state.get().sessionId || null;
    this.tools = createWatsonTools(send, () => this.sessionId);
  }

  status() {
    return { busy: this.busy, sessionId: this.sessionId, model: config.model, cwd: config.projectDir };
  }

  #setBusy(busy) {
    this.busy = busy;
    this.send({ type: 'busy', busy });
  }

  #start() {
    this.input = new InputQueue();
    this.seen = knowledgeSignature(); // what the prompt below already includes
    const gate = async (input, _toolUseId, { signal }) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const risk = classify(input.tool_name, input.tool_input);
      if (!risk) return {};
      const d = await requestApproval({ toolName: input.tool_name, input: input.tool_input, ...risk, signal });
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: d.approved ? 'allow' : 'deny',
          permissionDecisionReason: d.approved
            ? 'Horace approved this out loud via Watson.'
            : d.timedOut ? 'Horace did not answer the approval prompt in time, so it was not run.' : 'Horace said no to this. Do not retry it; ask what he wants instead.',
        },
      };
    };

    const options = {
      cwd: config.projectDir,
      additionalDirectories: [ROOT],
      model: config.model,
      effort: config.effort,
      permissionMode: config.permissionMode,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: watsonPrompt() },
      mcpServers: { watson: this.tools },
      disallowedTools: ['AskUserQuestion'],
      hooks: { PreToolUse: [{ hooks: [gate], timeout: Math.ceil(config.approvalTimeoutMs / 1000) + 60 }] },
      canUseTool: async (toolName, input, { signal, suggestions }) => {
        // Watson's own tools are safe to run; the PreToolUse hook above still gates wolf_hall's writing paths.
        if (toolName.startsWith('mcp__watson__')) return { behavior: 'allow', updatedInput: input };
        const reason = toolName === 'Bash' ? 'run a command that is not pre-approved'
          : toolName === 'ExitPlanMode' ? 'start carrying out its plan'
          : `use ${prettyTool(toolName)}`;
        const d = await requestApproval({ toolName, input, level: 'medium', reason, canAlways: !!suggestions?.length, signal });
        if (d.approved) return { behavior: 'allow', updatedInput: input, ...(d.always ? { updatedPermissions: suggestions } : {}) };
        return { behavior: 'deny', message: d.timedOut ? 'Horace did not answer in time.' : 'Horace said no. Ask what he wants instead.' };
      },
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...(config.maxBudgetUsd ? { maxBudgetUsd: config.maxBudgetUsd } : {}),
      stderr: (d) => { if (process.env.WATSON_DEBUG) process.stderr.write(d); },
    };

    const q = query({ prompt: this.input, options });
    this.q = q;
    this.#consume(q).catch((err) => {
      console.error('[watson] agent error:', err);
      this.send({ type: 'error', message: `Watson's agent stopped: ${err.message}` });
    }).finally(() => {
      if (this.q !== q) return; // a reset already replaced this session
      this.q = null;
      this.input = null;
      denyAllPending();
      if (this.busy) this.#setBusy(false);
    });
  }

  async #consume(q) {
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        this.sessionId = m.session_id;
        state.set({ sessionId: m.session_id });
        const servers = (m.mcp_servers || []).map((s) => `${s.name} (${s.status})`);
        this.send({ type: 'status', ...this.status(), model: m.model, tools: m.tools?.length, servers });
      } else if (m.type === 'assistant') {
        if (m.error) this.send({ type: 'error', message: `Problem talking to Claude: ${m.error}` });
        const sub = m.parent_tool_use_id != null;
        for (const block of m.message?.content || []) {
          if (block.type === 'text' && block.text.trim() && !sub) {
            history.append({ role: 'watson', text: block.text });
            this.send({ type: 'say', text: block.text, origin: this.origin });
          } else if (block.type === 'tool_use') {
            this.send({ type: 'activity', text: describe(block.name, block.input), sub });
          }
        }
      } else if (m.type === 'result') {
        const ok = m.subtype === 'success' && !m.is_error;
        if (!ok) {
          const why = m.subtype === 'error_max_budget_usd' ? 'it hit the spending limit' : (m.errors?.join('; ') || m.result || m.subtype);
          this.send({ type: 'error', message: `That request didn't finish: ${why}`, origin: this.origin });
        }
        this.send({ type: 'done', ok, costUsd: m.total_cost_usd, ms: m.duration_ms, turns: m.num_turns });
        this.#setBusy(false);
      }
    }
  }

  /** Send something Horace said (or typed) to the agent. */
  ask(text, origin) {
    const clean = String(text || '').trim();
    if (!clean) return;
    this.origin = origin || null;
    history.append({ role: 'you', text: clean });
    this.send({ type: 'heard', text: clean, origin });
    if (!this.q) this.#start();
    this.#setBusy(true);
    let content = clean;
    try {
      // Memory files or knowledge saved since this conversation started (by another Claude session, GitHub, or Horace).
      const { text, now } = changesSince(this.seen);
      this.seen = now;
      if (text) content = `[Watson system note, not from Horace: these memory or knowledge files were added or changed since this conversation started. Take them into account.]\n${text}\n[End of note. Horace said:]\n${clean}`;
    } catch (e) { console.warn('  Could not check for new knowledge:', e.message); }
    this.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
  }

  /** Stop whatever Watson is doing right now (the session stays). */
  async interrupt() {
    denyAllPending();
    if (this.q && this.busy) {
      try { await this.q.interrupt(); } catch (e) { console.error('[watson] interrupt failed:', e.message); }
    }
    this.#setBusy(false);
  }

  /** Start a brand-new conversation. */
  async reset() {
    await this.interrupt();
    this.input?.close();
    try { this.q?.close?.(); } catch {}
    this.q = null;
    this.sessionId = null;
    state.set({ sessionId: null });
    history.append({ role: 'system', text: 'New conversation started.' });
    this.send({ type: 'reset' });
  }

  shutdown() {
    this.input?.close();
    try { this.q?.close?.(); } catch {}
  }
}
