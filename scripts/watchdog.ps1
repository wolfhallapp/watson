# Watson watchdog (2026-10-30): run every few minutes by a Windows scheduled task (scripts\install-watchdog.ps1).
# - Oracle answering: does nothing.
# - Oracle not answering and not running (its window was closed): starts it, the same way Watson.cmd does.
# - Oracle running but not answering for a minute (frozen): kills the frozen server so run.sh restarts it.
# Pause it by creating data\watchdog-off (delete the file to resume). Actions are logged to data\watchdog.log.
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root 'data'
$log = Join-Path $data 'watchdog.log'
if (Test-Path (Join-Path $data 'watchdog-off')) { exit 0 }

$port = 8787
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $p = Select-String -Path $envFile -Pattern '^WATSON_PORT=(\d+)' | Select-Object -First 1
  if ($p) { $port = [int]$p.Matches[0].Groups[1].Value }
}
function Test-Watson {
  try { (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/" -TimeoutSec 8).StatusCode -eq 200 } catch { $false }
}
function Write-Log($msg) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg) }

if (Test-Watson) { exit 0 }
# Give a crash restart (run.sh waits 5 s) or a slow start a chance before acting.
Start-Sleep -Seconds 30
if (Test-Watson) { exit 0 }

$running = (wsl.exe -e pgrep -f '^node server/index.js') -join ' '
if ($running.Trim()) {
  Start-Sleep -Seconds 30
  if (Test-Watson) { exit 0 }
  Write-Log "Oracle running (pid $running) but not answering for a minute; killing it so it restarts."
  wsl.exe -e kill -9 $running.Trim().Split(' ') | Out-Null
  exit 0
}
if ((wsl.exe -e pgrep -f 'scripts/run.sh') -and -not (wsl.exe -e pgrep -f '^node server/index.js')) {
  # run.sh is between restarts (it waits 5 s after a crash); leave it to restart on its own next check.
  Start-Sleep -Seconds 10
  if (Test-Watson) { exit 0 }
}
Write-Log 'Oracle was down (no server running); starting it.'
& (Join-Path $PSScriptRoot 'start-watson.ps1') -NoBrowser -AtLogin | Out-Null
if (Test-Watson) { Write-Log 'Oracle is back up.' } else { Write-Log 'Start attempted, but the Oracle is still not answering.' }
