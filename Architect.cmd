@echo off
rem Double-click to start Watson and open the Architect (the Construct).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-watson.ps1" -Architect %*
