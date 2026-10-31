#!/usr/bin/env bash
# Gives Watson a temporary https address so you can use it from your phone.
# Run inside WSL while Watson is running:   bash scripts/phone.sh
#
# This uses a Cloudflare "quick tunnel": free, no domain or login needed, but the
# address changes every time and anyone who has it can reach the login screen
# (they still need your WATSON_TOKEN). For a permanent address protected by
# Cloudflare Access, see "Phone access" in README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=$(grep -E '^WATSON_PORT=' .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-8787}
export PATH="$HOME/.local/bin:$PATH" # where scripts/install-cloudflared.sh puts it

if ! command -v cloudflared >/dev/null; then
  cat <<'EOF'
cloudflared isn't installed in WSL yet. Install it once (no sudo needed) with:

  bash scripts/install-cloudflared.sh

Then run this script again.
EOF
  exit 1
fi

if ! curl -fs "http://127.0.0.1:$PORT/" >/dev/null; then
  echo "The Oracle isn't running on port $PORT. Start it first (double-click Watson.cmd)."
  exit 1
fi

echo "Opening a tunnel to the Oracle. On your PC, open the Oracle's Settings > Pair a phone to get"
echo "the phone address and a 6-digit code. Close this window (or Ctrl+C) to stop the tunnel."
echo
# Watson reads the address from data/tunnel.log to show it on the pairing screen.
mkdir -p data
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" 2>&1 | tee data/tunnel.log
