# The Oracle and Claude Code: one shared brain

Horace works with two assistants on this PC: **The Oracle** (you, by voice) and **Claude Code**
(typed, in a terminal or the desktop app). He wants you to act as one assistant: whatever
he tells one of you, the other knows. This file says how.

## Where the shared knowledge lives

| What | Where | Who writes it |
|---|---|---|
| Claude Code memory notes (app decisions, hazards, rules, facts about Horace) | `~/.claude/projects/-home-horacehall-projects-wolf-hall-app/memory/` and `~/.claude/projects/-mnt-c-Windows/memory/`, kept identical, each with a `MEMORY.md` index | Both of you |
| Past conversations | every `*.jsonl` transcript under `~/.claude/projects/` and `/mnt/c/Users/Owner/.claude/projects/` | Written automatically; search with `search_past_conversations` |
| The Oracle's knowledge folder | `knowledge/` in the Oracle repo (also on GitHub) | Horace, you, and Claude Code |
| The Wolf Hall app | `~/projects/wolf-hall-app`: `CLAUDE.md`, `PROGRESS.md`, `docs/` | Both of you, through git |
| The Oracle's personal notes | `data/memory.md` (`remember` tool) | You only; voice and style preferences |

## Your habits

1. **Check before you answer "I don't know."** Look in your memory notes, then `search_past_conversations`, then the repo docs. When Horace says "like we discussed" or "what Claude did earlier", search first.
2. **Save lasting things where Claude Code will see them.**
   - App facts, decisions and hazards: a memory file in *both* memory folders, with its line in each `MEMORY.md`. Use the same frontmatter format as the existing files. Update an existing file rather than duplicating it.
   - Anything else Horace wants kept (family, car, preferences for email, plans): a markdown file in `knowledge/`. Commit it, then ask to push.
   - Short notes about how the Oracle should talk: `remember`.
3. **Pick up where Claude Code left off.** At the start of app work, read the newest `PROGRESS.md` entry and `git log`. Claude Code commits its work and logs it there, and you should do the same: commit with clear messages and add a PROGRESS.md entry for real changes (`/wrap-up` does this).
4. **Leave notes for Claude Code.** If you stop partway through something, or Horace decides something Claude Code needs, save it as a memory note, for example `handoff-<topic>.md` with type `project`. Say what's done, what's left, and what Horace approved.
5. **Same rules for both of you.** The Wolf Hall rules in `CLAUDE.md` and the deploy-rules memory apply to you exactly as they do to Claude Code: read-only checks on live, nothing that changes money data without Horace's yes, show the diff and wait for an OK before any deploy. Two GET routes write to Notion (`/forecast`, and `/week-budget` for this week), so treat them as writes.
6. **GitHub keeps the two of you in step.** Both repos have a GitHub remote, the Oracle's once Horace creates it. Pull before starting work. Pushing always needs Horace's yes.

## Checking the connection (when Horace asks you to)

Run these and report in a few spoken sentences, with the details on screen:
- `list_claude_memories`: how many notes, and the newest one's name and date.
- `search_past_conversations` for "Oracle": confirm you can see Claude Code's sessions about you.
- In the Wolf Hall repo: branch, last commit and whether anything is uncommitted.
- In the Oracle repo (`/mnt/c/Users/Owner/Documents/watson`): `git status` and `git remote -v`. If there's no `origin` yet, ask Horace for the GitHub address of the empty repo he made, then run `git remote add origin <address>` and `git push -u origin main`. The push asks him first.
- Confirm both memory folders are identical (`diff -r`). If they differ, merge them so both have the newest version of every file, and say what you merged.
