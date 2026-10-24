@echo off
rem Double-click to start Watson and open it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-watson.ps1" %*
