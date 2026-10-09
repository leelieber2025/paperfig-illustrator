#Requires -Version 5.0
<#
.SYNOPSIS
  One-click Windows installer for PaperFig CEP extension (Illustrator).
.DESCRIPTION
  Copies the extension into %APPDATA%\Adobe\CEP\extensions\paperfig and sets
  PlayerDebugMode=1 for common CSXS versions (unsigned CEP). Idempotent.
#>
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

function Write-Bi {
  param([string]$Zh, [string]$En, [string]$Color = 'Cyan')
  Write-Host ""
  Write-Host $Zh -ForegroundColor $Color
  Write-Host $En -ForegroundColor $Color
}

function Resolve-ExtensionSource {
  param([string]$ScriptDir)
  $candidates = @(
    $ScriptDir,
    (Join-Path $ScriptDir 'paperfig'),
    (Split-Path -Parent $ScriptDir),
    (Join-Path (Split-Path -Parent $ScriptDir) 'paperfig')
  )
  foreach ($c in $candidates) {
    if (-not $c) { continue }
    $manifest = Join-Path $c 'CSXS\manifest.xml'
    if (Test-Path -LiteralPath $manifest) {
      return (Resolve-Path -LiteralPath $c).Path
    }
  }
  return $null
}

Write-Bi `
  '=== PaperFig for Illustrator — Windows 安装 ===' `
  '=== PaperFig for Illustrator — Windows installer ===' `
  'Green'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$source = Resolve-ExtensionSource -ScriptDir $scriptDir
if (-not $source) {
  Write-Bi `
    '错误：找不到扩展源（需要含 CSXS\manifest.xml 的文件夹）。请把本脚本放在仓库根目录，或与 paperfig 包并列。' `
    'ERROR: Extension source not found (need a folder with CSXS\manifest.xml). Place this script at the repo root, or next to a packaged paperfig folder.' `
    'Red'
  exit 1
}

$destRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$dest = Join-Path $destRoot 'paperfig'

Write-Bi ("源目录: $source") ("Source: $source") 'Gray'
Write-Bi ("目标: $dest") ("Dest: $dest") 'Gray'

# Ensure extensions root exists; only touch paperfig under it.
if (-not (Test-Path -LiteralPath $destRoot)) {
  New-Item -ItemType Directory -Path $destRoot -Force | Out-Null
}

# 0.8.1: running the installer from inside the installed folder must not delete itself.
$sameDir = $false
if (Test-Path -LiteralPath $dest) {
  $srcFull = [System.IO.Path]::GetFullPath($source).TrimEnd('\','/')
  $dstFull = [System.IO.Path]::GetFullPath($dest).TrimEnd('\','/')
  if ([string]::Equals($srcFull, $dstFull, [System.StringComparison]::OrdinalIgnoreCase)) { $sameDir = $true }
}
if ($sameDir) {
  Write-Bi `
    '扩展已在目标位置，跳过复制，仅设置 PlayerDebugMode。' `
    'Already running from the install location - skipping copy, only setting PlayerDebugMode.' `
    'Yellow'
}

# Idempotent overwrite of paperfig only (do not delete sibling extensions).
if ((-not $sameDir) -and (Test-Path -LiteralPath $dest)) {
  Write-Bi `
    '已存在旧安装，正在覆盖更新（不影响其他扩展）…' `
    'Existing install found — overwriting PaperFig only (other extensions untouched)…' `
    'Yellow'
  try {
    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Bi `
      "错误：无法覆盖旧安装。请先完全退出 Illustrator，再重新运行。`n$($_.Exception.Message)" `
      "ERROR: Could not replace the existing install. Quit Illustrator completely, then run this again.`n$($_.Exception.Message)" `
      'Red'
    exit 1
  }
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null

# Copy extension payload; skip VCS / installer noise / fat release zip.
$excludeDirNames = @('.git', '.github', '.tools', 'node_modules', '__pycache__', 'dist', 'install')
$excludeFileNames = @('install.ps1', 'install.bat', 'install.sh', 'install.command', 'uninstall.ps1', 'uninstall.bat', 'uninstall.sh', 'uninstall.command')

if (-not $sameDir) {
  try {
    Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
      $name = $_.Name
      if ($excludeDirNames -contains $name) { return }
      if ($excludeFileNames -contains $name) { return }
      $target = Join-Path $dest $name
      Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force -ErrorAction Stop
    }
  } catch {
    Write-Bi `
      "错误：复制扩展失败。请先完全退出 Illustrator，再重新运行。`n$($_.Exception.Message)" `
      "ERROR: Could not copy the extension. Quit Illustrator completely, then run this again.`n$($_.Exception.Message)" `
      'Red'
    exit 1
  }
}

$copiedManifest = Join-Path $dest 'CSXS\manifest.xml'
if (-not (Test-Path -LiteralPath $copiedManifest)) {
  Write-Bi `
    '错误：复制后未找到 CSXS\manifest.xml。' `
    'ERROR: CSXS\manifest.xml missing after copy.' `
    'Red'
  exit 1
}

# PlayerDebugMode for unsigned CEP (HKCU — no admin required).
$csxsVersions = 9..15
Write-Bi `
  '正在设置 PlayerDebugMode=1（CSXS.9–15）…' `
  'Setting PlayerDebugMode=1 for CSXS.9–15…' `
  'Cyan'

foreach ($v in $csxsVersions) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path -LiteralPath $key)) {
    New-Item -Path $key -Force | Out-Null
  }
  New-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
  Write-Host ("  CSXS.$v PlayerDebugMode=1 OK") -ForegroundColor DarkGray
}

Write-Bi `
  '安装完成。请完全退出并重新打开 Adobe Illustrator，然后：窗口 → 扩展／扩展（旧版）→ PaperFig for Illustrator' `
  'Done. Quit Adobe Illustrator completely and reopen it, then: Window → Extensions / Extensions (Legacy) → PaperFig for Illustrator' `
  'Green'

Write-Host ""
Write-Host "Installed to: $dest" -ForegroundColor Gray
# Pause only when interactive (double-click / console); skip under pipes/CI.
$interactive = $true
try {
  if ([Console]::IsInputRedirected) { $interactive = $false }
} catch {}
if ($interactive -and $Host.Name -eq 'ConsoleHost') {
  Write-Host "Press Enter to close / 按回车关闭…" -ForegroundColor DarkGray
  try { [void][Console]::ReadLine() } catch {}
}
exit 0
