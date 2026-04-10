#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
HOOK_DIR="$(git -C "$REPO_ROOT" rev-parse --git-dir)/hooks"
SOURCE_DIR="$REPO_ROOT/scripts/git-hooks"

mkdir -p "$HOOK_DIR"

install_hook() {
  local name="$1"
  cp "$SOURCE_DIR/$name" "$HOOK_DIR/$name"
  chmod +x "$HOOK_DIR/$name"
  echo "✅ Installed $name hook"
}

install_hook pre-commit
install_hook pre-push

echo "✅ Git hooks installed in $HOOK_DIR"
