#!/usr/bin/env bash
# Remove hermes-powerline. Hermes itself is never modified, so nothing to undo there.
set -euo pipefail

HH="${HERMES_HOME:-$HOME/.hermes}"
PL="${HERMES_POWERLINE_DIR:-$HH/powerline}"
BIN="${HERMES_POWERLINE_BIN:-$HOME/.local/bin}"

case "$PL" in
  */powerline) ;;
  *) echo "refusing to delete unexpected dir: $PL" >&2; exit 1 ;;
esac

rm -f "$BIN/hermes-powerline"
if command -v hermes >/dev/null 2>&1; then hermes plugins disable powerline-net >/dev/null 2>&1 || true; fi
NET="$HH/plugins/powerline-net"
if [ -L "$NET" ]; then rm -f "$NET"; elif [ -d "$NET" ]; then rm -rf "$NET"; fi
NETDIR="${HERMES_POWERLINE_NET_DIR:-$HOME/.cache/hermes-powerline/net}"
# Only ever the plugin's own JSON files, wherever that directory was pointed.
if [ -d "$NETDIR" ]; then find "$NETDIR" -maxdepth 1 \( -name '*.json' -o -name '.tmp-*' \) -type f -delete; rmdir "$NETDIR" 2>/dev/null || true; fi
rm -rf "$PL"
echo "removed. Run plain 'hermes' — and drop any alias that calls hermes-powerline."
