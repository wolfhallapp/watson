@echo off
rem Double-click to open the Keymaster (market research).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-watson.ps1" -Keymaster %*
