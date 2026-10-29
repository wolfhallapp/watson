@echo off
rem Double-click to open Morpheus, your guide and running journal.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-watson.ps1" -Morpheus %*
