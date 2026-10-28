@echo off
rem Double-click to open Trinity in Edge (soft natural voices).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-watson.ps1" -Trinity %*
