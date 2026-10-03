# Thin wrapper - canonical installer is ../install.ps1
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot '..\install.ps1') @args
exit $LASTEXITCODE
