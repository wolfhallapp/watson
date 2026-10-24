# Sets up (or with -Remove, removes) the daily "Watson Roku wake-up" task that runs roku-wake.ps1.
# The task wakes the PC from sleep to run, and runs late if the PC was off at the time.
#   powershell -ExecutionPolicy Bypass -File scripts\install-roku-wake.ps1 -At 7:00am
#   powershell -ExecutionPolicy Bypass -File scripts\install-roku-wake.ps1 -Remove
param([string]$At = '7:00am', [switch]$Remove)

$taskName = 'Watson Roku wake-up'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed '$taskName'."
  exit 0
}

$script = Join-Path $PSScriptRoot 'roku-wake.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Turns on Big Daddy''s TV and plays the wake-up video (Watson).' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $taskName
Write-Host "Scheduled '$taskName' daily at $At. Next run: $((Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime)"
