#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_PATH="$SCRIPT_DIR/melden-difftool.sh"

git config --global diff.tool melden-vscode
git config --global difftool.melden-vscode.cmd "\"$TOOL_PATH\" \"\$LOCAL\" \"\$REMOTE\""
git config --global difftool.prompt false

echo "Configured git difftool 'melden-vscode'."
echo "Run: git difftool -t melden-vscode"
