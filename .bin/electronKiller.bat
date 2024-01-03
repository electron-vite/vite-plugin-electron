@echo off
setlocal enabledelayedexpansion

set "targetProcess=electron.exe"

taskkill /F /IM  %targetProcess%
echo Closed process: !targetProcess!

endlocal