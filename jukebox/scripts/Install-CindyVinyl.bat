@echo off
title Install Cindy Vinyl
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-CindyVinyl.ps1"
if errorlevel 1 (
  echo.
  echo Install failed. Make sure Edge or Chrome is installed.
  pause
  exit /b 1
)
echo.
echo Done — look for "Cindy Vinyl" on the Desktop and Start Menu.
pause
