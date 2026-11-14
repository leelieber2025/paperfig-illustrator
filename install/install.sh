#!/bin/bash
# Thin wrapper — canonical installer is ../install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/install.sh" "$@"
