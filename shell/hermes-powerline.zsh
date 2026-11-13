# hermes-powerline · one look everywhere (zsh)
#
# Source this from ~/.zshrc (./install.sh --shell does it for you). It makes the
# plain `hermes` command launch every INTERACTIVE surface through
# `hermes-powerline run`, so all of them share one build — powerline bar, code
# view, hy sidebar/tabs, hy-jade skin:
#
#   hermes                    hermes --yolo           hermes -p coder
#   hermes --resume <id>      hermes chat             hermes dashboard  (its web chat
#                                                     spawns the same TUI via HERMES_TUI_DIR)
#
# Admin subcommands (config, gateway, plugins, sessions, …), one-shot runs (-z)
# and --help/--version go straight to the real binary: no rebuild check, no
# overhead. Scripts never see this function (it only exists in interactive zsh),
# so cron jobs, hermes-sync-profiles etc. keep calling the binary.
#
# Escape hatches: `command hermes …` (bypass once) · HERMES_POWERLINE=0 (classic bar).

typeset -ga _hpl_direct=(
  model moa fallback worktree browser secrets egress migrate codex-runtime gateway proxy lsp
  setup whatsapp whatsapp-cloud slack send logout auth status pause resume cron webhook peer
  portal kanban project hooks doctor verify security approvals dump debug backup checkpoints
  import config skin console pairing skills bundles plugins curator pets journey memory tools
  computer-use mcp connectors sessions insights usage monitoring vault update uninstall profile
  completion logs prompt-size acp inbox record
)

hermes() {
  # hermes-powerline missing (uninstalled, PATH changed) → behave exactly like before.
  if ! (( $+commands[hermes-powerline] )); then
    command hermes "$@"
    return
  fi

  local a sub= skip=0
  for a in "$@"; do
    if (( skip )); then
      skip=0
      continue
    fi
    case "$a" in
      # Answer-and-exit forms never open the TUI: straight to the binary (no build check).
      -z|--oneshot|-h|--help|--version|-V|-q|--query|--query-file|-Q|--status|--stop) command hermes "$@"; return ;;
      -m|--model|--provider|--reasoning|-t|--toolsets|-r|--resume|--in|-s|--skills|-p|--profile|--usage-file|--cpu-profile) skip=1 ;;
      -*) ;;
      *) sub=$a; break ;;
    esac
  done

  # `hermes chat -q …` / `-Q` answers and exits like -z: no TUI, no build check.
  if [[ $sub == chat ]] && (( ${@[(Ie)-q]} || ${@[(Ie)--query]} || ${@[(Ie)-Q]} || ${@[(Ie)--query-file]} )); then
    command hermes "$@"
    return
  fi

  if [[ -n $sub ]] && (( ${_hpl_direct[(Ie)$sub]} )); then
    command hermes "$@"
  else
    hermes-powerline run "$@"
  fi
}

# hy = Hermes in YOLO mode through the same build.
hy() {
  if (( $+commands[hermes-powerline] )); then hermes-powerline run --yolo "$@"; else command hermes --yolo "$@"; fi
}
