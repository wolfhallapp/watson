# Starts Watson (inside WSL) if it isn't already running, then opens it in the browser.
# Usage: double-click Watson.cmd (or Architect.cmd), or run:  powershell -ExecutionPolicy Bypass -File scripts\start-watson.ps1 [-NoBrowser] [-AtLogin] [-Architect]
# -AtLogin (used by the Windows Startup shortcut) waits longer, since WSL is slow right after login.
# -Architect opens the Architect's page (the Construct) instead of the Oracle's, with the mic left as he last had it.
param([switch]$NoBrowser, [switch]$AtLogin, [switch]$Architect)

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$port = 8787
if (Test-Path $envFile) {
  $p = Select-String -Path $envFile -Pattern '^WATSON_PORT=(\d+)' | Select-Object -First 1
  if ($p) { $port = [int]$p.Matches[0].Groups[1].Value }
}
$url = "http://localhost:$port/"

function Test-Watson {
  # 127.0.0.1, not localhost: PowerShell tries IPv6 first and takes ~2s to fall back.
  try { (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/" -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

if (-not (Test-Watson)) {
  Start-Process wsl.exe -ArgumentList "--cd `"$root`" -e bash ./scripts/run.sh" -WindowStyle Minimized
  Write-Host 'Starting Watson...'
  $deadline = (Get-Date).AddSeconds($(if ($AtLogin) { 180 } else { 40 }))
  while (-not (Test-Watson)) {
    if ((Get-Date) -gt $deadline) { Write-Host 'Watson did not start. Open the minimized "wsl" window to see why.'; exit 1 }
    Start-Sleep -Milliseconds 500
  }
}

if (-not $NoBrowser) {
  # The token goes in the #fragment, which the browser never sends over the network.
  $token = (Select-String -Path $envFile -Pattern '^WATSON_TOKEN=(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim()
  $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  # Speech recognition needs Chrome or Edge, so prefer those over another default browser.
  $browser = @($chrome, $edge) | Where-Object { Test-Path $_ } | Select-Object -First 1
  # listen=1 turns the microphone on so Watson is always waiting for its name.
  $page = if ($Architect) { "${url}architect.html#token=$token" } else { "$url#token=$token&listen=1" }
  if ($browser) {
    # Watson gets its own browser profile so these settings apply even when your normal browser is open:
    # play speech without a click, and keep listening while the window is minimized or covered.
    $watsonProfile = Join-Path $env:LOCALAPPDATA 'Watson\browser'
    $flags = @(
      "--app=$page", "--user-data-dir=`"$watsonProfile`"", '--no-first-run', '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'
    )
    Start-Process $browser -ArgumentList $flags
  } else { Start-Process $page }
}
