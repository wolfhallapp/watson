#!/usr/bin/env bash
# Shows every process Watson's agents have started (deploys, tests, curls...) with how long each has run.
for p in $(pgrep -f "claude-agent-sdk-linux-x64/claude"); do
  echo "=== agent $p ($(ps -o etime= -p "$p" | tr -d ' ')): $(tr '\0' ' ' < /proc/$p/cmdline | grep -o -- '--resume=[^ ]*\|--model=[^ ]*' | tr '\n' ' ')"
  pstree -ap "$p" 2>/dev/null | sed 1d | cut -c1-200 || ps --ppid "$p" -o pid,etime,args | cut -c1-200
done
