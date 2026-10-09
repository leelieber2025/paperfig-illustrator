#!/bin/bash
cd "$(dirname "$0")"
if [[ -f "./uninstall.sh" ]]; then
  exec bash "./uninstall.sh"
elif [[ -f "./install/uninstall.sh" ]]; then
  exec bash "./install/uninstall.sh"
else
  echo "找不到 uninstall.sh / uninstall.sh not found next to this .command file."
  echo "Press Enter to close / 按回车关闭…"
  read -r _
  exit 1
fi
