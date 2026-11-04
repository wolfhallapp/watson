#!/usr/bin/env bash
# Waits (up to 3 hours) until every agent has been idle for two checks in a row, then restarts the server
# by killing node; run.sh starts it again in 5 seconds. Usage (in WSL): bash scripts/restart-when-all-idle.sh
cd "$(dirname "$0")/.." || exit 1
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
idle=0
for _ in $(seq 180); do
  if node scripts/busy-all.mjs | grep -qv ': idle'; then idle=0; else idle=$((idle + 1)); fi
  if [ "$idle" -ge 2 ]; then
    pid=$(pgrep -f '^node server/index.js'); echo "$(date '+%H:%M') all idle; restarting (pid $pid)"
    kill -9 $pid; sleep 15; node scripts/status.mjs | head -1; exit 0
  fi
  sleep 60
done
echo "Still busy after 3 hours; not restarting."
