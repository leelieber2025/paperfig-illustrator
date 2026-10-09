# Thin wrapper - canonical uninstaller is ../uninstall.ps1
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot '..\uninstall.ps1') @args
