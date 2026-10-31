#!/usr/bin/env bash
# Lists running cloudflared quick tunnels: process, start time, and the public address each one serves.
# Usage (in WSL): bash scripts/tunnels.sh
cd "$(dirname "$0")/.." || exit 1
for pid in $(pgrep -x cloudflared); do
  started=$(ps -o lstart= -p "$pid")
  host=""
  # Each quick tunnel serves its own metrics port on localhost; /quicktunnel names its address.
  for port in $(ss -ltnp 2>/dev/null | grep "pid=$pid," | grep -oE '127\.0\.0\.1:[0-9]+' | cut -d: -f2); do
    host=$(curl -s --max-time 3 "http://127.0.0.1:$port/quicktunnel" | grep -oE '[a-z0-9-]+\.trycloudflare\.com')
    [ -n "$host" ] && break
  done
  echo "pid $pid  started $started  https://${host:-<unknown>}"
done
echo "Address the Oracle shows for pairing: $(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' data/tunnel.log 2>/dev/null | tail -1)"
