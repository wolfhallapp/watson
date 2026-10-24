# Morning wake-up: turns on a Roku TV and plays a YouTube video.
# Run by the "Watson Roku wake-up" scheduled task (see install-roku-wake.ps1), or by hand to test:
#   powershell -ExecutionPolicy Bypass -File scripts\roku-wake.ps1
# The TV's "Control by mobile apps" setting is Limited, which blocks the power button command,
# so the TV is woken with a Wi-Fi wake-up packet (Wake-on-LAN) and then told to launch YouTube,
# which Limited mode allows.
param(
  [string]$Name = "Big Daddy's TV",
  [string]$Ip = '192.168.1.164',
  [string]$Mac = 'd4:f9:21:c9:79:23',
  [string]$VideoId = 'X4nGU4DZUwE',
  [string]$Log = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data\roku-wake.log')
)

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $Log -Value $line
  Write-Host $line
}

function Get-RokuInfo($ip) {
  try { [xml](Invoke-WebRequest -UseBasicParsing "http://${ip}:8060/query/device-info" -TimeoutSec 2).Content } catch { $null }
}

# Find the TV by name: the saved address first, then anything else the PC has seen on the network
# (the router can hand the TV a new address).
function Find-Roku {
  $info = Get-RokuInfo $Ip
  if ($info -and $info.'device-info'.'friendly-device-name' -eq $Name) { return $Ip }
  $candidates = Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.State -ne 'Unreachable' -and $_.IPAddress -match '^(192\.168|10\.|172\.)' } |
    Select-Object -ExpandProperty IPAddress -Unique
  foreach ($c in $candidates) {
    $i = Get-RokuInfo $c
    if ($i -and $i.'device-info'.'friendly-device-name' -eq $Name) { return $c }
  }
  return $null
}

function Send-WakePacket {
  $macBytes = $Mac -split '[:-]' | ForEach-Object { [Convert]::ToByte($_, 16) }
  $packet = [byte[]](@(0xFF) * 6 + ($macBytes * 16))
  $udp = New-Object System.Net.Sockets.UdpClient
  $udp.EnableBroadcast = $true
  foreach ($target in @('255.255.255.255', '192.168.1.255')) {
    foreach ($port in 9, 7) { [void]$udp.Send($packet, $packet.Length, $target, $port) }
  }
  $udp.Close()
}

try {
  Write-Log "Waking $Name"
  for ($n = 0; $n -lt 3; $n++) { Send-WakePacket; Start-Sleep -Milliseconds 500 }

  # Wait up to 90 seconds for the TV to answer. In standby ("Ready") it still answers, and the
  # launch below turns it on (tested 2026-10-24), so there's no need to wait for "PowerOn".
  $ip = $null; $mode = ''
  for ($t = 0; $t -lt 45; $t++) {
    if (-not $ip) { $ip = Find-Roku }
    if ($ip) {
      $info = Get-RokuInfo $ip
      if ($info) { $mode = $info.'device-info'.'power-mode'; break }
    }
    if ($t % 5 -eq 4) { Send-WakePacket }
    Start-Sleep -Seconds 2
  }
  if (-not $ip) { Write-Log "Couldn't find $Name on the network. Is it plugged in and on Wi-Fi?"; exit 1 }
  Write-Log "Found $Name at $ip (power: $mode)"

  # Launching YouTube also turns the TV on if it's still in standby.
  $r = Invoke-WebRequest -UseBasicParsing -Method Post "http://${ip}:8060/launch/837?contentId=$VideoId&mediaType=live" -TimeoutSec 10
  Write-Log "Asked YouTube to play $VideoId (HTTP $($r.StatusCode))"
  Start-Sleep -Seconds 20
  $after = Get-RokuInfo $ip
  Write-Log ("Power after launch: " + $after.'device-info'.'power-mode')
  exit 0
} catch {
  Write-Log "Failed: $($_.Exception.Message)"
  exit 1
}
