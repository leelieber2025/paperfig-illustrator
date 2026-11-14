#!/bin/bash
# Thin wrapper — canonical installer is ../install.command / ../install.sh
cd "$(dirname "$0")/.."
exec bash "./install.sh"
