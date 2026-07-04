@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-cpamanager.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Publish failed with exit code %EXIT_CODE%.
) else (
  echo Publish finished.
)
pause
exit /b %EXIT_CODE%
