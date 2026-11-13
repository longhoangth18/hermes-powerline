#!/usr/bin/env bash
# Install hermes-powerline by symlinking this checkout into place, so a later
# `git pull` is all an update needs (the next launch rebuilds by itself).
#
#   ./install.sh                install (and switch Hermes to the hy-dracula skin + dashboard theme)
#   ./install.sh --copy         copy files instead of symlinking
#   ./install.sh --keep-skin    leave display.skin / dashboard.theme alone
#   ./install.sh --shell        also make plain `hermes` (zsh) use the same build:
#                               adds one `source …/shell/hermes-powerline.zsh` line to ~/.zshrc
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HH="${HERMES_HOME:-$HOME/.hermes}"
PL="${HERMES_POWERLINE_DIR:-$HH/powerline}"
BIN="${HERMES_POWERLINE_BIN:-$HOME/.local/bin}"
MODE="link"
SKIN=1
SHELL_HOOK=0
for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --keep-skin) SKIN=0 ;;
    --shell) SHELL_HOOK=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

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
for f in powerline.tsx prompt.ts promptPrefix.tsx codeview.tsx bridge.ts dock.tsx; do put "$HERE/src/$f" "$PL/$f"; done
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

# plan-auto: opt-in companion of the plan-mode plugin — plan mode ON by default for every
# interactive turn. Linked here but never enabled by the installer: it changes how the agent works.
AUTO="$HH/plugins/plan-auto"
if [ -e "$AUTO" ] && [ ! -L "$AUTO" ]; then mv "$AUTO" "$PL/plan-auto.plugin.bak.$(date +%Y%m%d%H%M%S)"; fi
rm -f "$AUTO"
if [ "$MODE" = "link" ]; then
  ln -s "$HERE/plugin/plan-auto" "$AUTO"
else
  mkdir -p "$AUTO" && cp "$HERE/plugin/plan-auto/__init__.py" "$HERE/plugin/plan-auto/plugin.yaml" "$AUTO/"
fi
echo "plan-auto linked (opt-in, needs the plan-mode plugin): hermes plugins enable plan-auto"

# hy widgets (sidebar + session tabs) and the hy-jade skin go into Hermes' own
# user slots — $HERMES_HOME/tui-widgets and $HERMES_HOME/skins — for the default
# profile and every named profile, so `hy -p <profile>` looks the same.
# `hermes update` never touches these directories.
homes=("$HH")
if [ -d "$HH/profiles" ]; then
  for d in "$HH"/profiles/*/; do [ -d "$d" ] && homes+=("${d%/}"); done
fi
for home in "${homes[@]}"; do
  mkdir -p "$home/tui-widgets" "$home/skins"
  for w in "$HERE"/widgets/*.mjs; do put "$w" "$home/tui-widgets/$(basename "$w")"; done
  for k in "$HERE"/skins/*.yaml; do put "$k" "$home/skins/$(basename "$k")"; done
done
# Web dashboard theme (the dashboard reads themes from the home it was launched with).
mkdir -p "$HH/dashboard-themes"
for k in "$HERE"/dashboard-themes/*.yaml; do put "$k" "$HH/dashboard-themes/$(basename "$k")"; done
echo "installed widgets (hy-sidebar, hy-tabs), skins + dashboard themes (hy-dracula, hy-jade) into ${#homes[@]} Hermes home(s)"
if [ "$SKIN" = 1 ] && command -v hermes >/dev/null 2>&1; then
  for home in "${homes[@]}"; do
    if [ "$home" = "$HH" ]; then hermes config set display.skin hy-dracula >/dev/null 2>&1 || true
    else hermes -p "$(basename "$home")" config set display.skin hy-dracula >/dev/null 2>&1 || true; fi
  done
  hermes config set dashboard.theme hy-dracula >/dev/null 2>&1 || true
  echo "display.skin + dashboard.theme → hy-dracula (keep yours with ./install.sh --keep-skin)"
fi

if [ "$SHELL_HOOK" = 1 ]; then
  RC="${ZDOTDIR:-$HOME}/.zshrc"
  LINE="[ -r \"$HERE/shell/hermes-powerline.zsh\" ] && source \"$HERE/shell/hermes-powerline.zsh\""
  if grep -Fq "shell/hermes-powerline.zsh" "$RC" 2>/dev/null; then
    echo "zsh hook already in $RC"
  else
    printf '\n# hermes-powerline: one look for every Hermes launch (hermes, --yolo, -p, chat, dashboard, hy)\n%s\n' "$LINE" >>"$RC"
    echo "added the zsh hook to $RC — open a new terminal (or: source $RC)"
  fi
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
