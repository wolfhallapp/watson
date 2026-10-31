#!/usr/bin/env bash
# Lists the API errors (with details) recorded in Claude Code transcripts from the last N hours.
# Usage (in WSL): bash scripts/api-errors.sh [hours]
h=${1:-6}
find ~/.claude/projects -name '*.jsonl' -mmin -$((h * 60)) -print0 | xargs -0 grep -h '"api_error"' 2>/dev/null | node -e '
const lines = require("fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
const rows = [];
for (const l of lines) {
  let e; try { e = JSON.parse(l); } catch { continue; }
  const err = e.error || e.content || e;
  rows.push([e.timestamp || "", JSON.stringify({ status: err.status ?? e.status, type: err.type ?? err.error?.type, msg: err.message ?? err.error?.message ?? err.cause?.message ?? err.cause?.code, retryInMs: e.retryInMs, attempt: e.retryAttempt, maxRetries: e.maxRetries }).slice(0, 300)]);
}
rows.sort().slice(-40).forEach(([t, s]) => console.log(t.slice(5, 19).replace("T", " "), s));
console.log(`${rows.length} API errors in the last '"$h"' hours`);
'
