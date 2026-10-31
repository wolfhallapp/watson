#!/usr/bin/env bash
# Prints what you need to know when Watson / the Oracle misbehaves.
# Run inside WSL:  bash scripts/diagnose.sh
cd "$(dirname "$0")/.." || exit 1
echo "--- processes"; ps -eo pid,lstart,etime,args | grep -E "[n]ode server|[c]loudflared|claude-agent-sdk-linux" | cut -c1-170
echo "--- page"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 4 http://127.0.0.1:8787/
echo "--- disk"; df -h / | tail -1
echo "--- memory"; free -m | head -2
echo "--- data files"; ls -la data | head -40
echo "--- last log lines"; tail -80 data/server.log | cut -c1-240
