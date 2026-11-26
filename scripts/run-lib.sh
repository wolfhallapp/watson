# Helpers for scripts/run.sh (sourced; kept apart so tests/run-sh.test.js can run them).

# The port the server listens on: WATSON_PORT from the environment, then .env, then 8787 (as server/config.js).
oracle_port() {
  local p="${WATSON_PORT:-}"
  [ -z "$p" ] && [ -f .env ] && p=$(sed -n 's/^WATSON_PORT=\([0-9][0-9]*\).*/\1/p' .env | head -n 1)
  echo "${p:-8787}"
}

# True when an Oracle already answers on the port (the same check as scripts/watchdog.ps1).
oracle_answers() {
  [ "$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$1/" 2>/dev/null)" = 200 ]
}

# After the server exits with $1: restart it? Not after a clean stop or Ctrl+C, and not when another
# Oracle already holds the port (this window is a duplicate: before 2026-11-26 it crashed with
# EADDRINUSE and restarted every 5 seconds forever, 54,165 times in data/server.log).
oracle_should_restart() {
  [ "$1" = 0 ] || [ "$1" = 130 ] && return 1
  oracle_answers "$(oracle_port)" && return 1
  return 0
}
