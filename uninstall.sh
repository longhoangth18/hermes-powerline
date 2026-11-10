#!/usr/bin/env bash
# Remove hermes-powerline. Hermes itself is never modified, so nothing to undo there.
set -euo pipefail

HH="${HERMES_HOME:-$HOME/.hermes}"
PL="${HERMES_POWERLINE_DIR:-$HH/powerline}"
BIN="${HERMES_POWERLINE_BIN:-$HOME/.local/bin}"

rm -f "$BIN/hermes-powerline"
case "$PL" in
  */powerline) rm -rf "$PL" ;;
  *) echo "refusing to delete unexpected dir: $PL" >&2; exit 1 ;;
esac
echo "removed. Run plain 'hermes' — and drop any alias that calls hermes-powerline."
