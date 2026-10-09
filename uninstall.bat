@echo off
chcp 65001 >nul
setlocal
title PaperFig CEP Uninstaller
cd /d "%~dp0"

echo.
echo PaperFig for Illustrator - Windows uninstall
echo PaperFig for Illustrator - Windows 卸载
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo Uninstall failed / 卸载失败. Exit code: %ERR%
  pause
)
exit /b %ERR%
