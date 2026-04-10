#!/usr/bin/env bash
set -euo pipefail

echo "Warning: melden-difftool.sh is deprecated. Use bygone-difftool.sh instead." >&2
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/bygone-difftool.sh" "$@"
