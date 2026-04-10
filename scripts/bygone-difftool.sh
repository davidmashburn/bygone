#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: bygone-difftool.sh <left-file> <right-file>" >&2
  exit 2
fi

if ! command -v code >/dev/null 2>&1; then
  echo "VS Code CLI ('code') is required for Bygone difftool integration." >&2
  exit 1
fi

LEFT_PATH="$1"
RIGHT_PATH="$2"

URL="$(python3 - "$LEFT_PATH" "$RIGHT_PATH" <<'PY'
import sys
from urllib.parse import quote

left = quote(sys.argv[1], safe="")
right = quote(sys.argv[2], safe="")
print(f"vscode://davidmashburn.bygone/diff?left={left}&right={right}")
PY
)"

code --reuse-window --open-url "$URL" >/dev/null 2>&1 || code --open-url "$URL"
