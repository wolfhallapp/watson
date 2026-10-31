#!/usr/bin/env bash
# Waits until the Oracle isn't busy (up to 30 minutes), then restarts Watson so code changes take effect.
# Usage (in WSL): bash scripts/restart-when-idle.sh
cd "$(dirname "$0")/.." || exit 1
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
for _ in $(seq 120); do
  node scripts/status.mjs 2>/dev/null | grep -q '"busy":false' && break
  sleep 15
done
if ! node scripts/status.mjs 2>/dev/null | grep -q '"busy":false'; then echo "Still busy after 30 minutes; not restarting."; exit 1; fi
pid=$(pgrep -f '^node server/index.js')
echo "$(date '+%H:%M:%S') idle; restarting the Oracle (pid $pid)"
[ -n "$pid" ] && kill "$pid"
for _ in $(seq 20); do pgrep -f '^node server/index.js' >/dev/null || break; sleep 1; done
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w scripts/start-watson.ps1)" -NoBrowser
sleep 3
node scripts/status.mjs | head -1
