# Watson

Watson is your voice-controlled assistant. You talk to it out loud, and it codes the Wolf Hall app, answers questions, and handles errands. It runs Claude Code underneath (through the Claude Agent SDK), inside the real repo at `~/projects/wolf-hall-app` in WSL. That means it follows the same rules as Claude Code there: the repo's `CLAUDE.md`, `/deploy`, `/wrap-up`, the `agent-smith` validator, your allow-list, and your Gmail, Calendar, Drive and Notion connectors.

## Start it

Double-click **`Watson.cmd`** in this folder. It starts Watson in a minimized WSL window and opens it in Chrome or Edge, already signed in.

To stop Watson, close that minimized window or press Ctrl+C in it.

### Always on
Watson starts by itself when you log in to Windows. It opens its own window with the mic on, listening for "Watson", and keeps listening while that window is minimized or covered. If Watson crashes, it restarts itself.
- Watson's window uses its own browser profile. The first time, allow the microphone when the browser asks.
- If you close Watson's window, it stops listening. Double-click `Watson.cmd` to bring it back.
- To stop starting at login: `powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 -Remove`. Run it without `-Remove` to turn it back on.

### GitHub and the knowledge folder
Watson's code is a git repo, and `knowledge/` holds anything you want Watson to know. Add or edit files there on this PC or on GitHub. Watson pulls from GitHub each time it starts, and before each request it checks for new or changed knowledge files and Claude Code memory notes. See `knowledge/README.md`. Never put passwords or card numbers in it. `.env` and `data/` (token, history, memory, backups) are never committed.

## Talking to Watson

| Do this | What happens |
|---|---|
| Click **Turn mic on**, then say **"Watson, …"** | Hands-free. Watson listens for its name and acts on what follows. |
| Say just **"Watson"** and pause | It chimes, and you have about 9 seconds to speak. |
| Hold the orb, or hold **Space** | Push-to-talk. Let go to send. |
| Tap the orb once, talk, tap again | Push-to-talk without holding (handy on a phone). |
| Say **"Watson, good morning"** | A spoken briefing, with details on the Screen panel. |
| After Watson finishes speaking | You have about 7 seconds to reply without saying "Watson". |
| **Esc**, the **Stop** button, or say "stop" | Stops Watson talking. |
| Say **"Watson, cancel"** while it's working | Stops the current job. |
| Say **"Watson, new conversation"** | Starts fresh. It keeps what it remembered about you. |
| Type in the box | Works the same as speaking. |

Watson speaks short answers and puts anything long on the **Screen** panel: diffs, code, lists and tables. **Activity** shows each file it reads and each command it runs. **Reminders** lists what's coming up. If a reminder comes due while no Watson window is open, Windows shows it as a notification, and Watson says it when you next open Watson.

### What Watson knows
Watson knows what Claude Code knows on this PC:
- **Claude Code memory files.** The notes Claude sessions save about you, the app and its hazards. They load at the start of each Watson conversation, and `list_claude_memories` picks up newer ones.
- **Past conversations.** `search_past_conversations` searches every earlier Claude Code session on this PC, in WSL, the Windows folders and the desktop app, including Watson's own. If nothing that was said matches, it also searches the commands and files those sessions worked on.
- **The repo right now.** The branch, the last 5 commits, uncommitted files and the newest PROGRESS.md entry, plus CLAUDE.md and the project commands.
- **Its own notes** in `data/memory.md`, for facts about you and how Watson should behave. App facts are saved as Claude Code memory files in both memory folders, so every Claude session sees them.

### Budget answers
The `wolf_hall` tool reads the live app for quick answers: the pool, upcoming bills, savings goals and cards. It can only read. Two of the app's reads also write to Notion, so Watson asks before using them:
- `/forecast` rewrites the Forecast Snapshot.
- This week's `/week-budget` writes rollover balances.

Say "Watson, good morning" for a briefing: calendar, important email, bills due this week, the pool and reminders.

### Things to try
- "Watson, what's the worker version and is live in sync with the repo?"
- "Watson, read the top of PROGRESS.md and tell me what's left open."
- "Watson, add a dark mode toggle to the settings screen. Show me the diff before anything else."
- "Watson, run /deploy." (It follows the repo's deploy checklist and asks before each live step.)
- "Watson, what's on my calendar tomorrow?" / "Any emails from Taylor today?"
- "Watson, remind me at 5 to move the laundry."
- "Watson, remember that I like answers short."

## Safety: what Watson asks before doing

Anything risky stops and asks you. A card appears, Watson says what it wants to do, and you answer **"yes"** or **"no"** out loud or tap a button. This applies even when your Claude Code allow-list would let it through:

- deploying or rolling back the worker, changing worker secrets, and Netlify deploys
- `git push`, hard resets, and other history rewrites
- deleting folders (`rm -r`)
- any `curl` that sends data (POST, PUT, PATCH, DELETE), so no accidental writes to Notion through the worker
- sending, replying to, forwarding or deleting email; creating or changing calendar events; editing Notion
- writing files outside the project, touching `.env` or secret files, and `sudo`
- loading the Wolf Hall forecast or this week's budget, because those write to Notion

Commands that aren't on your allow-list also ask first. You can answer **"yes, always"** to allow that kind of command for the rest of the session. If nobody answers within 10 minutes, the answer is no. The rules are in `server/approvals.js`, and `npm test` checks them.

Watson's address only listens on this PC (127.0.0.1). Every connection needs the access token in `.env` (`WATSON_TOKEN`). Anyone with that token can control Watson, so keep it private. To change it, edit `.env` and restart Watson.

## Phone access

Speech recognition on a phone needs an `https://` address, so Watson uses a Cloudflare Tunnel. Watson keeps running on your PC, and your phone talks to it through Cloudflare.

**Quick option (no domain needed).**

1. With Watson running, double-click **`Phone.cmd`**. It opens the tunnel in its own minimized window. Closing that window stops the tunnel. (The first time, run `bash scripts/install-cloudflared.sh` in WSL to install cloudflared. It needs no sudo.)
2. On the PC, open Watson's **⚙ Settings → Pair a phone**. It shows the phone address and a 6-digit code.
3. On your phone, open that address in Chrome (Android) or Safari (iPhone) and type the code. The phone gets the access token automatically and remembers it. Codes work once and expire after 5 minutes. Use **Add to Home Screen** for an app icon.

The address changes every time the tunnel restarts. Your phone remembers the token for each address, but a new address needs a new pairing. If a login is refused, the screen says why (wrong code, wrong capitalization, too many tries), and so does `data/server.log`. After 20 failed tries, that device has to wait 10 minutes.

To test the tunnel from the PC: `node scripts/check-remote.mjs <address>` (in WSL).

**Permanent option (needs a domain on your Cloudflare account).** Create a named tunnel to a hostname like `watson.yourdomain.com`, then put **Cloudflare Access** in front of it so only your email can open it:

```bash
cloudflared tunnel login
cloudflared tunnel create watson
cloudflared tunnel route dns watson watson.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8787 watson
```

Then, in the Cloudflare dashboard, go to Zero Trust → Access → Applications. Add a self-hosted app for `watson.yourdomain.com` with a policy that allows only your email (one-time PIN login). After that you get two locks: Cloudflare Access, then Watson's token.

## Settings (`.env`)

| Setting | Default | Meaning |
|---|---|---|
| `WATSON_TOKEN` | random | Access token. |
| `WATSON_PORT` | `8787` | Local port. |
| `WATSON_PROJECT_DIR` | `~/projects/wolf-hall-app` | The repo Watson works in. |
| `WATSON_MODEL` | `claude-opus-5-5` | Claude model. |
| `WATSON_EFFORT` | `high` | `low`/`medium` = faster replies, `xhigh`/`max` = more thorough. |
| `WATSON_PERMISSION_MODE` | `acceptEdits` | `acceptEdits` lets file edits inside the repo through without asking. `default` asks about edits too. Risky actions always ask. |
| `WATSON_MAX_BUDGET_USD` | (none) | Optional cap on what one request can spend. |
| `ANTHROPIC_API_KEY` | (none) | Optional. If set, Watson bills this API key instead of your Claude Code login. Your claude.ai connectors (Gmail, Calendar and so on) only load with the Claude Code login. |

The in-page **⚙ Settings** control hands-free vs push-to-talk, the voice, the speaking speed, the reply window, and whether you can interrupt by saying "stop". (That option works best with headphones, so Watson doesn't hear itself.)

## How it's built

```
public/            the web app (no build step)
  index.html, style.css
  voice.js         wake word, push-to-talk, speech in/out, yes/no parsing
  app.js           screen, approvals, connection to the server
server/            Node, runs in WSL
  index.js         web server + WebSocket (token, same-origin check)
  agent.js         the Claude Agent SDK session (Claude Code in the repo)
  approvals.js     the risk rules and the yes/no gate
  tools.js         Watson's own tools: show_on_screen, remember, reminders, now,
                   search_past_conversations, list_claude_memories, wolf_hall
  knowledge.js     Claude Code memory, repo snapshot, past-session search, live worker reads
  notify.js        Windows notifications for reminders when no screen is open
  store.js         data/ files: history, session id, memory, reminders
scripts/           launcher, WSL runner, phone tunnel
tests/             npm test
data/              created at runtime (not committed)
```

Watson keeps one Claude Code session going and picks it up again after a restart (`data/state.json`). "New conversation" starts a new one. Long-term facts live in `data/memory.md`, and Watson reads them at the start of each session.

**Watson can work on itself.** Say "Watson, add a … to yourself". Its own code is in its allowed folders, and changes take effect after a restart.

## Troubleshooting

- **The mic does nothing.** Use Chrome or Edge, and allow the microphone from the address-bar icon. Firefox has no speech recognition.
- **It mishears "Watson".** Hold Space or the orb instead, or say "Hey Watson".
- **"Speech recognition needs an internet connection".** Chrome and Edge send audio to their speech service. Check your connection.
- **Watson hears itself.** Leave "interrupt by saying stop" off, or use headphones.
- **"Problem talking to Claude".** Run `claude` once in WSL to check you're still logged in.
- **Logs:** `data/server.log`. For verbose logs, start Watson with `WATSON_DEBUG=1`.
