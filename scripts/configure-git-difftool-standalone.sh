#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_PATH="$SCRIPT_DIR/bygone-standalone-difftool.sh"

git config --global diff.tool bygone
git config --global difftool.bygone.cmd "\"$TOOL_PATH\" \"\$LOCAL\" \"\$REMOTE\""
git config --global difftool.prompt false

echo "Configured standalone git difftool 'bygone'."
echo "Run: git difftool -t bygone"
