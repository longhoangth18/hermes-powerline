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
# hy widgets + skin, default home and every profile. Only our own file names.
homes=("$HH")
if [ -d "$HH/profiles" ]; then
  for d in "$HH"/profiles/*/; do [ -d "$d" ] && homes+=("${d%/}"); done
fi
for home in "${homes[@]}"; do
  rm -f "$home/tui-widgets/hy-sidebar.mjs" "$home/tui-widgets/hy-tabs.mjs" "$home/skins/hy-jade.yaml"
  rmdir "$home/tui-widgets" 2>/dev/null || true
  if command -v hermes >/dev/null 2>&1; then
    if [ "$home" = "$HH" ]; then p=(); else p=(-p "$(basename "$home")"); fi
    if [ "$(hermes ${p[@]+"${p[@]}"} config get display.skin 2>/dev/null | tail -1)" = "hy-jade" ]; then
      hermes ${p[@]+"${p[@]}"} config set display.skin default >/dev/null 2>&1 || true
    fi
  fi
done
rm -f "$HH/dashboard-themes/hy-jade.yaml"
if command -v hermes >/dev/null 2>&1 && [ "$(hermes config get dashboard.theme 2>/dev/null | tail -1)" = "hy-jade" ]; then
  hermes config set dashboard.theme default >/dev/null 2>&1 || true
fi
RC="${ZDOTDIR:-$HOME}/.zshrc"
if grep -Fq "shell/hermes-powerline.zsh" "$RC" 2>/dev/null; then
  echo "note: remove the hermes-powerline line from $RC (plain hermes keeps working without it)"
fi
rm -rf "$PL"
echo "removed. Run plain 'hermes' — and drop any alias that calls hermes-powerline."
