# Sourced by the restart scripts. server_pid prints the pid of the Oracle server running from THIS
# checkout's folder (the current directory) and nothing else. Before 2026-11-26 they used
# `pgrep -f '^node server/index.js'` alone, which matches every Oracle on the PC, so a run from a test
# copy or the Night Shift's ~/night/watson could kill -9 the live Oracle (three exit 137 kills in
# data/server.log at 5:42-5:49 AM 11/26, while restart-when-all-idle.sh was being tested).
server_pid() {
  local root p
  root=$(pwd -P)
  for p in $(pgrep -f '^node server/index.js'); do
    [ "$(readlink -f "/proc/$p/cwd" 2>/dev/null)" = "$root" ] && echo "$p"
  done
  return 0
}
