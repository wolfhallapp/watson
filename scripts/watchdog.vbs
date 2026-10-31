' Runs scripts\watchdog.ps1 with no window at all (a scheduled PowerShell task would flash one every run).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\watchdog.ps1""", 0, True
