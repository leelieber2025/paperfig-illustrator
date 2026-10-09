#!/bin/bash
# Thin wrapper — canonical uninstaller is ../uninstall.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/uninstall.sh" "$@"
