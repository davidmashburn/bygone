#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: melden-standalone-difftool.sh <left-file> <right-file>" >&2
  exit 2
fi

if ! command -v melden >/dev/null 2>&1; then
  echo "Melden standalone launcher ('melden') is required." >&2
  exit 1
fi

exec melden --diff "$1" "$2"
