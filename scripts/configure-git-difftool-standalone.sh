#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_PATH="$SCRIPT_DIR/melden-standalone-difftool.sh"

git config --global diff.tool melden
git config --global difftool.melden.cmd "\"$TOOL_PATH\" \"\$LOCAL\" \"\$REMOTE\""
git config --global difftool.prompt false

echo "Configured standalone git difftool 'melden'."
echo "Run: git difftool -t melden"
