@echo off
rem Double-click to open a phone tunnel to Watson in its own window (Watson must be running).
rem Then on the PC: Watson Settings > Pair a phone.
start "Watson phone tunnel" /min wsl.exe --cd "%~dp0." -e bash ./scripts/phone.sh
