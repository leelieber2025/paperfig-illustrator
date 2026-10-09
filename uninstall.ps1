#Requires -Version 5.0
<#
.SYNOPSIS
  Remove the PaperFig CEP folder. PlayerDebugMode is left unchanged.
#>
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Write-Bi {
  param([string]$Zh, [string]$En, [string]$Color = 'Cyan')
  Write-Host ""
  Write-Host $Zh -ForegroundColor $Color
  Write-Host $En -ForegroundColor $Color
}

Write-Bi `
  '=== PaperFig for Illustrator — Windows 卸载 ===' `
  '=== PaperFig for Illustrator — Windows uninstall ===' `
  'Green'

$destRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$dest = Join-Path $destRoot 'paperfig'
$bundle = 'ExtensionBundleId="com.zhaoli.paperfig"'

if (-not (Test-Path -LiteralPath $dest)) {
  Write-Bi `
    '未安装 PaperFig。CEP 目录里没有 paperfig。' `
    'PaperFig is not installed. No paperfig folder in the CEP extensions directory.' `
    'Yellow'
  exit 0
}

$resolved = [System.IO.Path]::GetFullPath($dest).TrimEnd('\')
$rootResolved = [System.IO.Path]::GetFullPath($destRoot).TrimEnd('\')
$expected = Join-Path $rootResolved 'paperfig'
if (-not [string]::Equals($resolved, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Bi `
    '错误：安装路径不是 CEP extensions 下的 paperfig。未删除任何文件。' `
    'ERROR: The install path is not paperfig under CEP extensions. Nothing was removed.' `
    'Red'
  exit 1
}

$manifest = Join-Path $dest 'CSXS\manifest.xml'
if (-not (Test-Path -LiteralPath $manifest) -or -not (Select-String -LiteralPath $manifest -Pattern $bundle -SimpleMatch -Quiet)) {
  Write-Bi `
    '错误：该目录不是 PaperFig（清单里没有 com.zhaoli.paperfig）。未删除任何文件。' `
    'ERROR: That folder is not PaperFig (manifest has no com.zhaoli.paperfig). Nothing was removed.' `
    'Red'
  exit 1
}

try {
  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction Stop
} catch {
  Write-Bi `
    "错误：无法删除安装目录。请先完全退出 Illustrator，再重新运行。`n$($_.Exception.Message)" `
    "ERROR: Could not remove the install folder. Quit Illustrator completely, then run this again.`n$($_.Exception.Message)" `
    'Red'
  exit 1
}

Write-Bi `
  '已卸载。PlayerDebugMode 未改。请完全退出并重新打开 Adobe Illustrator。' `
  'Removed. PlayerDebugMode was left unchanged. Quit Adobe Illustrator completely and reopen it.' `
  'Green'
Write-Host ""
Write-Host "Removed: $dest" -ForegroundColor Gray
$interactive = $true
try { if ([Console]::IsInputRedirected) { $interactive = $false } } catch {}
if ($interactive -and $Host.Name -eq 'ConsoleHost') {
  Write-Host "Press Enter to close / 按回车关闭…" -ForegroundColor DarkGray
  try { [void][Console]::ReadLine() } catch {}
}
exit 0
