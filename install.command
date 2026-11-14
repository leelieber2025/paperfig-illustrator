#!/bin/bash
cd "$(dirname "$0")"
if [[ -f "./install.sh" ]]; then
  exec bash "./install.sh"
elif [[ -f "./install/install.sh" ]]; then
  exec bash "./install/install.sh"
else
  echo "找不到 install.sh / install.sh not found next to this .command file."
  read -r _
  exit 1
fi
