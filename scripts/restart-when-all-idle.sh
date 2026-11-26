#!/usr/bin/env bash
# Waits (up to 3 hours) until every agent has been idle for two checks in a row, then restarts the server
# by killing node; run.sh starts it again in 5 seconds. Usage (in WSL): bash scripts/restart-when-all-idle.sh

# True only when busy-all ran and every agent it named said idle. Its whole output is read first: before
# 2026-11-26 this piped into `grep -q`, which closed the pipe at the first busy line, so busy-all crashed
# with EPIPE on its next line (stack traces in data/server.log). A check that fails or says nothing counts
# as busy, so a broken check never restarts the server in the middle of someone's work.
all_idle() {
  local out
  out=$(node scripts/busy-all.mjs) || return 1
  [ -n "$out" ] && ! grep -qv ': idle$' <<<"$out"
}

# server_pid: only the server running from this folder, never another checkout's (scripts/server-pid.sh).
. "$(dirname "${BASH_SOURCE[0]}")/server-pid.sh"

# Sourced (tests/restart-idle.test.js): only the helpers above.
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

cd "$(dirname "$0")/.." || exit 1
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
idle=0
for _ in $(seq 180); do
  if all_idle; then idle=$((idle + 1)); else idle=0; fi
  if [ "$idle" -ge 2 ]; then
    pid=$(server_pid)
    [ -n "$pid" ] || { echo "$(date '+%H:%M') all idle, but no server is running from $(pwd -P); nothing to restart."; exit 1; }
    echo "$(date '+%H:%M') all idle; restarting (pid $pid)"
    kill -9 $pid; sleep 15; node scripts/status.mjs | head -1; exit 0
  fi
  sleep 60
done
echo "Still busy after 3 hours; not restarting."
