@echo off
REM Thin wrapper - canonical installer is ..\install.bat (uses %%~dp0; no rename needed)
cd /d "%~dp0.."
call "%~dp0..\install.bat" %*
exit /b %ERRORLEVEL%
