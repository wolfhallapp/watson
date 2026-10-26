# The Construct: 1,000 small ways to earn (started 2026-10-25)

Horace's project: find 1,000 small, legit ways to make a little money from home, from 15 cents a
day up. The trunk is small earners; each branch is a family of strategies; each strategy is a leaf.

## Who runs it: the Architect
- On 2026-10-25 Horace asked for the Construct to have its own Oracle-style screen, **not** in the
  Wolf Hall app yet, and for a second agent named **the Architect** to be its brain.
- The Architect lives in Watson's server, beside the Oracle:
  - Page: http://localhost:8787/architect.html (or double-click `Architect.cmd`). There's a link
    between the Oracle's page and his.
  - Wake word: "Architect". Voice: a deep male browser voice.
  - He has his own conversation, saved separately from the Oracle's.
  - Tools: `construct` (the tree), `show_on_screen`, `now`, `search_past_conversations`, plus web search and helper agents
    ("programs") for research.
  - Code: `server/architect.js` (persona and tools), `server/construct.js` (the tree store),
    `public/architect.html` + `public/construct.js` (the screen).
- **The tree's data is on the PC**, in `data/construct.json` (never pushed).
  - It was seeded from `server/construct-seed.json`, a copy of the Notion database "The Tree" as of 2026-10-25.
  - The Notion copy (page "The Construct", under Wolf Hall Budget 2026) is now just a snapshot. It isn't kept in sync.
  - Each strategy has setup steps (a checklist), notes and logged payouts. Earned totals come only from payouts.
- **The screen:**
  - Earned all-time, this month and the last 7 days, plus "N of 1,000 ways".
  - "Today's moves" shows the next open step on everything in progress.
  - Branches fold open, with "Grow" buttons. Each card has "Work on this with the Architect", "Research it",
    a status menu, a step checklist, "It paid me" and notes.
  - Anything Horace changes on the screen is passed to the Architect with his next message.
- **His workshop folder:** `C:\Users\Owner\Documents\construct`, for listings, templates and research notes.
- **Parked:** a Wolf Hall app version (worker routes plus a /construct/ page, v203) is on the Wolf Hall repo branch
  `construct-v203`. It is not on main and was never deployed. Horace said not on the app yet.

## Branches
1 Passive devices · 2 Cashback & receipts · 3 Rewards & points · 4 Paid opinions & testing ·
5 AI training work · 6 Found money · 7 Sell your stuff · 8 Digital products · 9 Services with AI ·
10 Content & affiliate. The Architect can add more.

## Rules
- Legit and inside each site's terms: no bots where banned, one account per person, no fake reviews.
- **No gambling or sweepstakes casinos as an earning branch.** The Bonus Run stays the Oracle's.
- Track real payouts, not estimates. Keep tax records.
- Agents can research, write listings, build products and find claims. Work that a site requires a human
  to do (surveys, AI-training tasks, Microsoft Rewards) stays Horace's. Horace makes his own accounts
  and does his own identity checks.
- The Construct never touches the Wolf Hall Pool or budget.

## First seeds (10/25)
- 23 strategies.
- Priority 1: unclaimed property search, class action settlements, Fetch receipts, Microsoft Rewards, Prolific,
  Respondent, and a Notion budget template to sell.
- Dropped: the EcoSport insurance refund. Allstate only covered the truck.
