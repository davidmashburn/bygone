#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: bygone-standalone-difftool.sh <left-file> <right-file>" >&2
  exit 2
fi

if ! command -v bygone >/dev/null 2>&1; then
  echo "Bygone standalone launcher ('bygone') is required." >&2
  exit 1
fi

exec bygone --diff "$1" "$2"
