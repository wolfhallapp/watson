# Keeps the Oracle running: a scheduled task checks every 3 minutes and starts Watson if it's down
# (or restarts it if it's frozen). See scripts\watchdog.ps1.
#   Install:  powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1
#   Remove:   powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1 -Remove
#   Pause:    create data\watchdog-off (delete it to resume)
param([switch]$Remove)

$name = 'Watson watchdog'
if ($Remove) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host 'The Watson watchdog is removed.'
  } else { Write-Host 'The Watson watchdog was not installed.' }
  exit 0
}
$vbs = Join-Path $PSScriptRoot 'watchdog.vbs'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "`"$vbs`""
# Every 3 minutes, forever, starting a minute from now; also once at login.
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 3)
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
# Runs as you, only while you're logged in, so Watson's window and browser profile are yours.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger @($every, $logon) -Settings $settings -Principal $principal `
  -Description 'Checks every 3 minutes that Watson (the Oracle) is running and starts it if not. Log: data\watchdog.log' -Force | Out-Null
Write-Host "The Watson watchdog is installed: it checks every 3 minutes."
