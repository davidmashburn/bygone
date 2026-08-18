#!/usr/bin/env bash
set -euo pipefail

# Electron resolves its macOS helper apps relative to argv[0]. Homebrew's
# `binary` artifact is a symlink, which breaks that lookup on some Apple
# Silicon macOS versions. Resolve the app bundle before starting Electron.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_EXECUTABLE="$(cd "$SCRIPT_DIR/../MacOS" && pwd)/Bygone"

exec "$APP_EXECUTABLE" "$@"
