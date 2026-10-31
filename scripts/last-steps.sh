#!/usr/bin/env bash
# Shows the last steps the Oracle's Claude session took (tool calls, errors, sizes), from its transcript.
# Usage (in WSL): bash scripts/last-steps.sh [session-id] [count]
sid=${1:-$(grep -o '"sessionId": *"[^"]*"' "$(dirname "$0")/../data/state.json" | head -1 | cut -d'"' -f4)}
n=${2:-40}
f=$(ls -t ~/.claude/projects/*/"$sid".jsonl 2>/dev/null | head -1)
[ -z "$f" ] && { echo "No transcript for session $sid"; exit 1; }
echo "Transcript: $f ($(du -h "$f" | cut -f1), $(wc -l < "$f") entries)"
tail -n "$n" "$f" | node -e '
const lines = require("fs").readFileSync(0, "utf8").trim().split("\n");
for (const l of lines) {
  let e; try { e = JSON.parse(l); } catch { continue; }
  const t = (e.timestamp || "").slice(11, 19);
  const c = e.message?.content;
  const parts = [];
  if (typeof c === "string") parts.push("text: " + c.slice(0, 140));
  else for (const b of c || []) {
    if (b.type === "text") parts.push("text: " + b.text.slice(0, 140));
    else if (b.type === "tool_use") parts.push("TOOL " + b.name + " " + JSON.stringify(b.input).slice(0, 160));
    else if (b.type === "tool_result") parts.push("result" + (b.is_error ? " ERROR" : "") + ": " + JSON.stringify(b.content).slice(0, 160));
  }
  const u = e.message?.usage;
  const usage = u ? ` [in ${u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)} out ${u.output_tokens}]` : "";
  if (parts.length || e.type === "system") console.log(t, e.type, usage, parts.join(" | ") || (e.subtype || e.content || "").toString().slice(0, 160));
}'
