#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: bygone-standalone-difftool.sh <left-path> <right-path>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCHER="$REPO_DIR/bin/bygone.js"

if command -v bygone >/dev/null 2>&1; then
  exec bygone "$1" "$2"
elif [ -f "$LAUNCHER" ]; then
  exec node "$LAUNCHER" "$1" "$2"
else
  echo "Bygone standalone launcher not found." >&2
  echo "Run 'npm install -g .' from $REPO_DIR or ensure bin/bygone.js exists." >&2
  exit 1
fi
