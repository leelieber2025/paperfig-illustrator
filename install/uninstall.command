#!/bin/bash
# Thin wrapper — canonical uninstaller is ../uninstall.command / ../uninstall.sh
cd "$(dirname "$0")/.."
exec bash "./uninstall.sh"
