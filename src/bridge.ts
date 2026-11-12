// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline · hy widget bridge — appended to app/overlayStore.ts at
// build time (an OPTIONAL injection: if Hermes moves these stores, the build
// skips this file and only the hy widgets go dark; the status bar survives).
//
// User widgets ($HERMES_HOME/tui-widgets/*.mjs) receive only the widget SDK —
// no import path into the bundle. The hy sidebar/tabs read live state through
// this handle: the nanostores (get/listen) and the overlay patcher. Getters
// keep every binding lazy, so module-evaluation order can never bite.
// ═══════════════════════════════════════════════════════════════════════
import { HY as __hyTheme } from '../lib/prompt.js'
import { $turnState as __hyTurnState } from './turnStore.js'
import { $agentSnapshot as __hyAgentSnapshot, mergeAgentRoster as __hyMergeAgentRoster } from './agentRoster.js'

;(globalThis as { __hy?: unknown }).__hy = {
  get overlay() {
    return $overlayState
  },
  patchOverlay: (patch: Partial<OverlayState>) => patchOverlayState(patch),
  /** Shared Dracula palette (colour-depth aware) — widgets use it so every surface matches. */
  get theme() {
    return __hyTheme
  },
  get turn() {
    return __hyTurnState
  },
  get ui() {
    return $uiState
  },
  /** Background-delegation snapshot store (listen to it together with `turn`). */
  get agents() {
    return __hyAgentSnapshot
  },
  /** Every subagent of this session — in-turn ones AND background (async) delegations that outlive
   *  the turn — merged exactly like Hermes' live-agents dock does. */
  roster: () => {
    const snap = __hyAgentSnapshot.get()
    const data = snap.sid === $uiState.get().sid ? snap.data : { delegations: [], subagents: [] }

    return __hyMergeAgentRoster(__hyTurnState.get().subagents ?? [], data)
  },
  version: 3
}
