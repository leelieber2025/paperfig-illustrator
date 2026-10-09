#!/usr/bin/env bash
# Remove only the PaperFig CEP folder. PlayerDebugMode is left unchanged.
set -euo pipefail

zh_en() {
  printf '\n%s\n%s\n' "$1" "$2"
}

zh_en \
  '=== PaperFig for Illustrator — macOS 卸载 ===' \
  '=== PaperFig for Illustrator — macOS uninstall ==='

DEST_ROOT="${HOME}/Library/Application Support/Adobe/CEP/extensions"
DEST="${DEST_ROOT}/paperfig"
BUNDLE='ExtensionBundleId="com.zhaoli.paperfig"'

if [[ ! -d "${DEST}" ]]; then
  zh_en \
    '未安装 PaperFig。CEP 目录里没有 paperfig。' \
    'PaperFig is not installed. No paperfig folder in the CEP extensions directory.'
  exit 0
fi

resolved="$(cd "${DEST}" && pwd -P)"
root_resolved="$(cd "${DEST_ROOT}" && pwd -P)"
case "${resolved}" in
  "${root_resolved}/paperfig") ;;
  *)
    zh_en \
      '错误：安装路径不是 CEP extensions 下的 paperfig。未删除任何文件。' \
      'ERROR: The install path is not paperfig under CEP extensions. Nothing was removed.'
    exit 1
    ;;
esac

if [[ ! -f "${DEST}/CSXS/manifest.xml" ]] || ! grep -q "${BUNDLE}" "${DEST}/CSXS/manifest.xml"; then
  zh_en \
    '错误：该目录不是 PaperFig（清单里没有 com.zhaoli.paperfig）。未删除任何文件。' \
    'ERROR: That folder is not PaperFig (manifest has no com.zhaoli.paperfig). Nothing was removed.'
  exit 1
fi

if ! rm -rf "${DEST}"; then
  zh_en \
    '错误：无法删除安装目录。请先完全退出 Illustrator，再重新运行。' \
    'ERROR: Could not remove the install folder. Quit Illustrator completely, then run this again.'
  exit 1
fi

zh_en \
  '已卸载。PlayerDebugMode 未改。请完全退出并重新打开 Adobe Illustrator。' \
  'Removed. PlayerDebugMode was left unchanged. Quit Adobe Illustrator completely and reopen it.'

echo ""
echo "Removed: ${DEST}"
if [[ -t 0 ]]; then
  echo "Press Enter to close / 按回车关闭…"
  read -r _ || true
fi
exit 0
