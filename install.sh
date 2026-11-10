#!/usr/bin/env bash
# Install hermes-powerline by symlinking this checkout into place, so a later
# `git pull` is all an update needs (the next launch rebuilds by itself).
#
#   ./install.sh            install
#   ./install.sh --copy     copy files instead of symlinking
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HH="${HERMES_HOME:-$HOME/.hermes}"
PL="${HERMES_POWERLINE_DIR:-$HH/powerline}"
BIN="${HERMES_POWERLINE_BIN:-$HOME/.local/bin}"
MODE="link"
[ "${1:-}" = "--copy" ] && MODE="copy"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required" >&2; exit 1; }; }
need node; need python3; need rsync; need git
[ -d "$HH/hermes-agent/ui-tui/src" ] || [ -n "${HERMES_AGENT_DIR:-}" ] || {
  echo "error: Hermes Agent not found in $HH/hermes-agent (set HERMES_AGENT_DIR)" >&2; exit 1; }

put() { # src dst
  if [ -e "$2" ] && [ ! -L "$2" ] && ! cmp -s "$1" "$2"; then
    mv "$2" "$2.bak.$(date +%Y%m%d%H%M%S)"
    echo "  kept your old $(basename "$2") as a .bak file"
  fi
  rm -f "$2"
  if [ "$MODE" = "link" ]; then ln -s "$1" "$2"; else cp "$1" "$2"; fi
}

mkdir -p "$PL" "$BIN"
for f in powerline.tsx prompt.ts promptPrefix.tsx; do put "$HERE/src/$f" "$PL/$f"; done
put "$HERE/bin/hermes-powerline" "$BIN/hermes-powerline"
chmod +x "$HERE/bin/hermes-powerline"

# powerline-net: Hermes plugin feeding real per-call t/s, time-to-first-token and API errors.
NET="$HH/plugins/powerline-net"
mkdir -p "$HH/plugins"
# A backup must NOT stay in the plugins dir: Hermes would load it (same manifest name, and the
# later directory in sort order wins) instead of the fresh copy. Old copies go to $PL.
if [ -e "$NET" ] && [ ! -L "$NET" ]; then mv "$NET" "$PL/powerline-net.plugin.bak.$(date +%Y%m%d%H%M%S)"; fi
rm -f "$NET"
if [ "$MODE" = "link" ]; then
  ln -s "$HERE/plugin/powerline-net" "$NET"
else
  mkdir -p "$NET" && cp "$HERE/plugin/powerline-net/__init__.py" "$HERE/plugin/powerline-net/plugin.yaml" "$NET/"
fi
if command -v hermes >/dev/null 2>&1; then
  hermes plugins enable powerline-net >/dev/null 2>&1 && echo "enabled Hermes plugin powerline-net" ||
    echo "note: enable it with: hermes plugins enable powerline-net"
fi

echo "installed ($MODE) → $PL and $BIN/hermes-powerline"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "note: $BIN is not in your PATH" ;; esac

echo "checking against your Hermes version…"
if "$BIN/hermes-powerline" doctor; then
  cat <<'EOF'

Start Hermes with:   hermes-powerline run
Handy alias:         alias hy='hermes-powerline run'
Icons need a Nerd Font in your terminal (https://www.nerdfonts.com).
EOF
else
  echo "hermes-powerline does not fit this Hermes version yet — Hermes will keep its stock bar." >&2
  exit 1
fi
