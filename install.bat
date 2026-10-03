@echo off
chcp 65001 >nul
setlocal
title PaperFig CEP Installer
REM Always run from this .bat's folder (%~dp0) so the zip's paperfig/ name is enough —
REM users need not rename the folder; install.ps1 finds CSXS\manifest.xml beside this script.
cd /d "%~dp0"

echo.
echo PaperFig for Illustrator - Windows installer
echo PaperFig for Illustrator - Windows 一键安装
echo.

REM HKCU registry + %%APPDATA%% - run as current user (do NOT force admin elevate).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo Install failed / 安装失败. Exit code: %ERR%
  pause
)
exit /b %ERR%
