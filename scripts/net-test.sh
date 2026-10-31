#!/usr/bin/env bash
# Network test for long/large transfers (the kind that deploys and long Claude requests need).
# Sends and fetches 25 MB of throwaway bytes via Cloudflare's public speed test, 3 times each.
# Usage: bash scripts/net-test.sh   (run in WSL, and in Git Bash on Windows, to compare)
up() { head -c 25000000 /dev/zero | curl -s -o /dev/null -w "%{http_code} %{time_total}s" --max-time 120 -X POST --data-binary @- https://speed.cloudflare.com/__up || echo "FAILED (curl exit $?)"; }
down() { curl -s -o /dev/null -w "%{http_code} %{time_total}s" --max-time 120 "https://speed.cloudflare.com/__down?bytes=25000000" || echo "FAILED (curl exit $?)"; }
for i in 1 2 3; do echo "upload $i: $(up)   download $i: $(down)"; done
