#!/usr/bin/env bash
# One-click macOS installer for PaperFig CEP extension (Illustrator).
# A new tree is copied and checked before the old install is moved aside.
# If the new tree is bad, the previous install stays in place.
set -euo pipefail

zh_en() {
  printf '\n%s\n%s\n' "$1" "$2"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_source() {
  local candidates=(
    "$SCRIPT_DIR"
    "$SCRIPT_DIR/paperfig"
    "$(dirname "$SCRIPT_DIR")"
    "$(dirname "$SCRIPT_DIR")/paperfig"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -f "$c/CSXS/manifest.xml" ]]; then
      (cd "$c" && pwd)
      return 0
    fi
  done
  return 1
}

# Copy payload; skip VCS / installer noise / dist zip.
copy_payload() {
  local src="$1"
  local dst="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude '.git' \
      --exclude '.github' \
      --exclude '.tools' \
      --exclude 'node_modules' \
      --exclude '__pycache__' \
      --exclude 'dist' \
      --exclude 'install' \
      --exclude 'install.ps1' \
      --exclude 'install.bat' \
      --exclude 'install.sh' \
      --exclude 'install.command' \
      "${src}/" "${dst}/"
  else
    tar -C "${src}" \
      --exclude='.git' \
      --exclude='.github' \
      --exclude='.tools' \
      --exclude='node_modules' \
      --exclude='__pycache__' \
      --exclude='dist' \
      --exclude='install' \
      --exclude='install.ps1' \
      --exclude='install.bat' \
      --exclude='install.sh' \
      --exclude='install.command' \
      -cf - . | tar -C "${dst}" -xf -
  fi
}

# CEP loads these paths. A staged tree without them is not installed.
stage_is_valid() {
  local dir="$1"
  [[ -f "${dir}/CSXS/manifest.xml" && -f "${dir}/client/index.html" && -f "${dir}/jsx/bitmap.jsx" ]]
}

discard_stage() {
  if [[ -n "${STAGE:-}" && -d "${STAGE}" ]]; then
    rm -rf "${STAGE}"
    STAGE=""
  fi
}

# Put the previous install back when the new directory never became DEST.
restore_previous() {
  discard_stage
  if [[ -n "${BACKUP:-}" && -d "${BACKUP}" && ! -d "${DEST}" ]]; then
    mv "${BACKUP}" "${DEST}"
    BACKUP=""
  fi
}

fail_keep_old() {
  restore_previous
  zh_en "$1" "$2"
  exit 1
}

zh_en \
  '=== PaperFig for Illustrator — macOS 安装 ===' \
  '=== PaperFig for Illustrator — macOS installer ==='

SOURCE="$(resolve_source || true)"
if [[ -z "${SOURCE}" ]]; then
  zh_en \
    '错误：找不到扩展源（需要含 CSXS/manifest.xml 的文件夹）。请把本脚本放在仓库根目录，或与 paperfig 包并列。' \
    'ERROR: Extension source not found (need a folder with CSXS/manifest.xml). Place this script at the repo root, or next to a packaged paperfig folder.'
  exit 1
fi

DEST_ROOT="${HOME}/Library/Application Support/Adobe/CEP/extensions"
DEST="${DEST_ROOT}/paperfig"
STAGE=""
BACKUP=""

zh_en "源目录: ${SOURCE}" "Source: ${SOURCE}"
zh_en "目标: ${DEST}" "Dest: ${DEST}"

mkdir -p "${DEST_ROOT}"

# 0.8.1: running the installer from inside the installed folder must not delete itself.
SAME_DIR=0
if [[ -d "${DEST}" ]] && [[ "$(cd "${DEST}" && pwd -P)" == "$(cd "${SOURCE}" && pwd -P)" ]]; then
  SAME_DIR=1
  zh_en \
    '扩展已在目标位置，跳过复制，仅设置 PlayerDebugMode。' \
    'Already running from the install location — skipping copy, only setting PlayerDebugMode.'
fi

if [[ "${SAME_DIR}" == 0 ]]; then
  STAGE="$(mktemp -d "${DEST_ROOT}/.paperfig-new.XXXXXX")"
  zh_en \
    '正在准备新目录并校验，旧安装先保留。' \
    'Preparing and checking the new folder. The current install stays until that succeeds.'
  if ! copy_payload "${SOURCE}" "${STAGE}"; then
    fail_keep_old \
      '错误：复制扩展失败。旧安装未改动。请先完全退出 Illustrator，再重新运行。' \
      'ERROR: Could not copy the extension. The previous install was left in place. Quit Illustrator completely, then run this again.'
  fi
  if ! stage_is_valid "${STAGE}"; then
    fail_keep_old \
      '错误：新目录缺少 CSXS/manifest.xml、client/index.html 或 jsx/bitmap.jsx。旧安装未改动。' \
      'ERROR: The new folder is missing CSXS/manifest.xml, client/index.html, or jsx/bitmap.jsx. The previous install was left in place.'
  fi
  if [[ -d "${DEST}" ]]; then
    BACKUP="${DEST_ROOT}/.paperfig-prev.$$"
    if ! mv "${DEST}" "${BACKUP}"; then
      fail_keep_old \
        '错误：无法暂时移开旧安装。旧安装未改动。请先完全退出 Illustrator，再重新运行。' \
        'ERROR: Could not move the existing install aside. It was left in place. Quit Illustrator completely, then run this again.'
    fi
  fi
  if ! mv "${STAGE}" "${DEST}"; then
    fail_keep_old \
      '错误：无法把新目录换到安装位置。已尝试恢复旧安装。' \
      'ERROR: Could not move the new folder into place. The previous install was restored when possible.'
  fi
  STAGE=""
  if [[ -n "${BACKUP}" && -d "${BACKUP}" ]]; then
    rm -rf "${BACKUP}"
    BACKUP=""
  fi
fi

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "${DEST}" 2>/dev/null || true
fi

if ! stage_is_valid "${DEST}"; then
  zh_en \
    '错误：安装目录缺少 CSXS/manifest.xml、client/index.html 或 jsx/bitmap.jsx。' \
    'ERROR: Installed folder is missing CSXS/manifest.xml, client/index.html, or jsx/bitmap.jsx.'
  exit 1
fi

if ! command -v defaults >/dev/null 2>&1; then
  zh_en \
    '错误：未找到 defaults。此脚本只适用于 macOS。' \
    'ERROR: defaults was not found. This installer is for macOS only.'
  exit 1
fi

zh_en \
  '正在设置 PlayerDebugMode=1（CSXS.9–15）…' \
  'Setting PlayerDebugMode=1 for CSXS.9–15…'

for v in 9 10 11 12 13 14 15; do
  defaults write "com.adobe.CSXS.${v}" PlayerDebugMode 1
  echo "  CSXS.${v} PlayerDebugMode=1 OK"
done

# Prefer readable prefs for Adobe hosts (optional; ignore failure).
killall -u "$(whoami)" cfprefsd 2>/dev/null || true

zh_en \
  '安装完成。请完全退出并重新打开 Adobe Illustrator，然后：窗口 → 扩展／扩展（旧版）→ PaperFig for Illustrator' \
  'Done. Quit Adobe Illustrator completely and reopen it, then: Window → Extensions / Extensions (Legacy) → PaperFig for Illustrator'

echo ""
echo "Installed to: ${DEST}"
if [[ -t 0 ]]; then
  echo "Press Enter to close / 按回车关闭…"
  read -r _ || true
fi
exit 0
