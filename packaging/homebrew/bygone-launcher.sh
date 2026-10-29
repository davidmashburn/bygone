#!/usr/bin/env bash
set -euo pipefail

# Electron resolves its macOS helper apps relative to argv[0]. Homebrew's
# `binary` artifact is a symlink, which breaks that lookup on some Apple
# Silicon macOS versions. Resolve the app bundle before starting Electron.
SCRIPT_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT_PATH" ]]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  [[ "$SCRIPT_PATH" = /* ]] || SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_PATH"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
APP_EXECUTABLE="$(cd "$SCRIPT_DIR/../MacOS" && pwd)/Bygone"

exec "$APP_EXECUTABLE" "$@"
