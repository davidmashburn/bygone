#!/usr/bin/env bash
set -euo pipefail

echo "Warning: melden-standalone-difftool.sh is deprecated. Use bygone-standalone-difftool.sh instead." >&2
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/bygone-standalone-difftool.sh" "$@"
