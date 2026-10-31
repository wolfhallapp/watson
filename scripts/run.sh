#!/usr/bin/env bash
# Runs Watson in the foreground (inside WSL). The Windows launcher calls this.
# If Watson crashes it starts again; Ctrl+C or closing the window stops it.
cd "$(dirname "$0")/.." || exit 1
# Load nvm so `node` is the version Claude Code uses.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
mkdir -p data
# Pick up anything added on GitHub (knowledge files, fixes). Never blocks startup.
if git remote get-url origin >/dev/null 2>&1; then
  timeout 20 git pull --ff-only --quiet 2>&1 | tee -a data/server.log || echo "  (git pull skipped)" | tee -a data/server.log
fi
stopping=0
trap 'stopping=1' INT TERM
while true; do
  node server/index.js 2>&1 | tee -a data/server.log
  code=${PIPESTATUS[0]}
  [ "$stopping" = 1 ] || [ "$code" = 0 ] || [ "$code" = 130 ] && break
  echo "  The Oracle stopped unexpectedly (exit $code). Restarting in 5 seconds..." | tee -a data/server.log
  sleep 5
done
echo
read -r -t 600 -p "Watson stopped. Press Enter to close this window."
