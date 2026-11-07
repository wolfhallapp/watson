@echo off
rem Double-click to open Persephone (the casino).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-watson.ps1" -Persephone %*
