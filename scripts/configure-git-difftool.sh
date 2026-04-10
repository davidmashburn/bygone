#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_PATH="$SCRIPT_DIR/bygone-difftool.sh"

git config --global diff.tool bygone-vscode
git config --global difftool.bygone-vscode.cmd "\"$TOOL_PATH\" \"\$LOCAL\" \"\$REMOTE\""
git config --global difftool.prompt false

echo "Configured git difftool 'bygone-vscode'."
echo "Run: git difftool -t bygone-vscode"
