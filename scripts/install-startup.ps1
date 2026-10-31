# Makes Watson start when you log in to Windows and wait for "Watson".
#   Install:  powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
#   Remove:   powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 -Remove
param([switch]$Remove)

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'Watson.lnk'
if ($Remove) {
  if (Test-Path $link) { Remove-Item $link; Write-Host 'The Oracle will no longer start at login.' } else { Write-Host 'The Oracle was not set to start at login.' }
  exit 0
}
$root = Split-Path -Parent $PSScriptRoot
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($link)
$s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\start-watson.ps1`" -AtLogin"
$s.WorkingDirectory = $root
$s.WindowStyle = 7  # minimized
$s.Description = 'Start Watson and listen for its name'
$s.Save()
Write-Host "The Oracle will start at login ($link)."
