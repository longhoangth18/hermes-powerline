
// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline — injected by ~/.local/bin/hermes-powerline at build time.
// Source of truth: ~/.hermes/powerline/powerline.tsx (outside the git repo, so
// `hermes update` never touches it). Appended to components/appChrome.tsx so it
// can reuse that module's private helpers (FaceTicker, SessionDuration, …).
// ═══════════════════════════════════════════════════════════════════════
import { execFile as __plExecFile } from 'node:child_process'
import { readFileSync as __plReadFileSync, statSync as __plStatSync } from 'node:fs'
import { Component as __PlComponent } from 'react'
import { $uiState as __plUiState } from '../app/uiStore.js'
import { homedir as __plHomedir } from 'node:os'
import { join as __plJoin } from 'node:path'

import {
  PL_LOOK as __PL_LOOK,
  plGray as __plGray,
  plInk as __plInk,
  plIsLight as __plIsLight,
  plEdgeGray as __plEdgeGray,
  plLeftGray as __plLeftGray,
  plRightWidth as __plRightWidth,
  plTone as __plTone,
  type PlTone as __PlTone
} from '../lib/prompt.js'

type PlStyle = 'arrow' | 'flame' | 'round' | 'slant'

interface PlConf {
  enabled: boolean
  icons: boolean
  /** Poll `hermes inbox --json` and pin a badge when something needs attention. */
  inbox: boolean
  palette: 'dracula' | 'mono' | 'skin'
  style: PlStyle
}

const PL_SEPS: Record<PlStyle, { capL: string; capR: string; l: string; lt: string; r: string; rt: string }> = {
  arrow: { capL: '', capR: '', l: '', lt: '', r: '', rt: '' },
  flame: { capL: '', capR: '', l: '', lt: '', r: '', rt: '' },
  round: { capL: '', capR: '', l: '', lt: '', r: '', rt: '' },
  slant: { capL: '', capR: '', l: '', lt: '', r: '', rt: '' }
}

function plLoadConf(): PlConf {
  const conf: PlConf = { enabled: true, icons: true, inbox: true, palette: 'mono', style: 'arrow' }

  try {
    // The launcher passes the path explicitly: `hermes -p <profile>` rewrites
    // HERMES_HOME, which would otherwise hide the default-home config.
    const home = process.env.HERMES_HOME?.trim() || __plJoin(__plHomedir(), '.hermes')
    const path = process.env.HERMES_POWERLINE_CONF?.trim() || __plJoin(home, 'powerline', 'config.json')
    const raw = JSON.parse(__plReadFileSync(path, 'utf8')) as Partial<PlConf>

    if (typeof raw.enabled === 'boolean') {
      conf.enabled = raw.enabled
    }

    if (typeof raw.icons === 'boolean') {
      conf.icons = raw.icons
    }

    if (typeof raw.inbox === 'boolean') {
      conf.inbox = raw.inbox
    }

    if (raw.palette === 'skin' || raw.palette === 'dracula' || raw.palette === 'mono') {
      conf.palette = raw.palette
    }

    if (typeof raw.style === 'string' && raw.style in PL_SEPS) {
      conf.style = raw.style as PlStyle
    }
  } catch {
    // No / broken config → defaults. Never take the TUI down over a status bar.
  }

  const envStyle = process.env.HERMES_POWERLINE_STYLE?.trim()

  if (envStyle && envStyle in PL_SEPS) {
    conf.style = envStyle as PlStyle
  }

  if (process.env.HERMES_POWERLINE === '0') {
    conf.enabled = false
  }

  return conf
}

const PL_CONF = plLoadConf()
// Shared with the restyled dock (src/dock.tsx, another file of the build): same icon choice as the bar.
;(globalThis as { __plIcons?: boolean }).__plIcons = PL_CONF.icons
// Glyphs whose width Ink and terminals agree on (1 cell). U+26A0 ⚠ / U+26D3 ⛓
// measure 2 in Ink but draw as 1 in Terminal.app/tmux, which shifts every cell
// after them and garbles Ink's incremental repaints.
const PL_WARN = PL_CONF.icons ? '\u{f0026}' : '!' // nf-md-alert
const PL_WARN_YOLO = PL_CONF.icons ? `${PL_WARN}${__PL_LOOK.gap}YOLO` : '! YOLO'
const PL_LINK = PL_CONF.icons ? '\uf0c1' : '+'
const PL_YOLO = /^(1|true|yes|on)$/i.test(process.env.HERMES_YOLO_MODE ?? '')

interface PlSeg {
  bg: string
  bold?: boolean
  fg: string
  key: string
  node: ReactNode
  onClick?: () => void
  /** Grey palette only: rebuild the node once the segment's grey is known. */
  render?: (bg: string) => ReactNode
  /** Grey palette only: alarm / accent text instead of plain ink. */
  tone?: __PlTone
  /** Accent cell: its own colours on colour palettes; on the grey ramp it takes the ramp grey and its colour becomes the bold text colour (alarms stay red, as text). */
  fixed?: boolean
  /** Idle/secondary cell: dim text, also under the mono palette. */
  muted?: boolean
  /** Long pinned text (model, inbox, context) that may be shortened — or dropped — to fit the row. */
  trunc?: boolean
  w: number
}

// ── per-request speed + API errors (fed by the powerline-net Hermes plugin) ──
// Hermes' own avg_tps is sum(out)/sum(latency) over the last 10 calls, latency
// including the wait for the first token, so it is a blend, not the speed the
// model generates at. The plugin records each call's exact timings instead.
interface PlNetErr {
  after_s?: number
  at: number
  code: null | number
  max?: null | number
  msg?: string
  n: number
  ok_at?: number
  reason?: null | string
  retry?: null | number
  retryable?: boolean | null
  type?: null | string
}

interface PlNet {
  calls: number
  err: null | PlNetErr
  errors: number
  last: null | {
    at: number
    gen: null | number
    out: number
    streamed: boolean
    tps: null | number
    tps_streamed?: boolean | null
    ttft: null | number
  }
  recovered: null | PlNetErr
}

const PL_NET_DIR =
  process.env.HERMES_POWERLINE_NET_DIR?.trim() || __plJoin(__plHomedir(), '.cache', 'hermes-powerline', 'net')

/** How long a recovered error stays on the bar (dimmed) after the retry succeeded. */
const PL_RECOVERED_MS = 60_000
/** An unrecovered error from an idle session older than this is history, not news. */
const PL_ERR_STALE_MS = 15 * 60_000

const plNetFile = (id: string) => __plJoin(PL_NET_DIR, `${id.replace(/[^\w.-]/g, '').slice(0, 120)}.json`)

function usePlNet(): null | PlNet {
  const [net, setNet] = useState<null | PlNet>(null)
  const [, setTick] = useState(0)
  const isOccluded = useStore($isStatusRuleOccluded)
  const seen = useRef('')
  const shown = useRef('')

  useEffect(() => {
    if (isOccluded) {
      return
    }

    // Fresh mount (e.g. after an overlay hid the bar): re-read even if the file is unchanged,
    // or `cur` stays null and the expiry re-render below never fires.
    let cur: null | PlNet = null
    let dirSeen = ''
    seen.current = ''

    const poll = () => {
      const ui = __plUiState.get()
      const ids = [...new Set([ui.sid, ui.storedSid, ui.info?.stored_session_id])].filter((x): x is string => !!x)
      // One stat of the directory per tick: the plugin writes by rename, which bumps the
      // directory's mtime, so the per-file stats only run when something actually changed.
      let dirKey = ids.join('|')

      try {
        dirKey += `:${__plStatSync(PL_NET_DIR).mtimeMs}`
      } catch {
        dirKey += ':none'
      }

      const changed = dirKey !== dirSeen
      dirSeen = dirKey
      let best: null | { m: number; p: string } = null

      for (const id of changed ? ids : []) {
        const p = plNetFile(id)

        try {
          const m = __plStatSync(p).mtimeMs

          if (!best || m > best.m) {
            best = { m, p }
          }
        } catch {
          // no data for this id yet
        }
      }

      const key = best ? `${best.p}:${best.m}` : ''

      if (changed && key !== seen.current) {
        seen.current = key

        if (!best) {
          cur = null
          setNet(null)
        } else {
          try {
            cur = JSON.parse(__plReadFileSync(best.p, 'utf8')) as PlNet
            setNet(cur)
          } catch {
            seen.current = '' // unreadable: retry next tick
            dirSeen = ''
          }
        }
      }

      // Re-render when a recovered badge expires or an idle error goes stale.
      const now = Date.now()
      const vis = `${cur?.recovered && now - (cur.recovered.ok_at ?? 0) * 1000 < PL_RECOVERED_MS}:${cur?.err && now - cur.err.at * 1000 < PL_ERR_STALE_MS}`

      if (vis !== shown.current) {
        shown.current = vis
        setTick(n => n + 1)
      }
    }

    poll()
    const id = setInterval(poll, 500)

    return () => clearInterval(id)
  }, [isOccluded])

  return net
}

// ── inbox badge (fed by the `inbox` Hermes plugin's read-only CLI) ──
// `hermes inbox --json` lists what needs the operator: stalled/dropped delegations, failed
// cron runs, orphaned background processes, blocked kanban tasks, plus finished delegation
// results nobody collected. ~1 s of CPU per run, so it is polled once a minute, async, and
// never blocks a render. Any failure (plugin missing, CLI error, bad JSON) keeps the bar as is.
interface PlInbox {
  attention: number
  kinds: string
  undelivered: number
}

const PL_INBOX_MS = 60_000
const PL_INBOX_KIND: Record<string, string> = { cron: 'cron', delegation: 'deleg', kanban: 'kanban', process: 'proc' }

// ── todo progress ───────────────────────────────────────────────────────
// The agent's todo_list, read from the TUI turn store through the widget bridge
// (bridge.ts → globalThis.__hy.turn). Going through the OPTIONAL bridge instead
// of importing turnStore keeps the REQUIRED bar build independent of it: if a
// Hermes update moves the store, only this cell goes dark.
// Hermes archives the list into the transcript when a turn ends; the cell then
// lingers, dimmed, for PL_TODO_LINGER_MS and disappears.
interface PlTodoItem {
  content: string
  status: string
}

interface PlTodos {
  items: PlTodoItem[]
  live: boolean
}

const PL_TODO_LINGER_MS = 60_000

type __PlTurnStore = {
  get?: () => { todos?: PlTodoItem[] } | undefined
  listen?: (cb: (s: { todos?: PlTodoItem[] } | undefined) => void) => () => void
}

const __plTurnStore = (): __PlTurnStore | undefined => {
  try {
    return (globalThis as { __hy?: { turn?: __PlTurnStore } }).__hy?.turn
  } catch {
    return undefined
  }
}

function usePlTodos(): null | PlTodos {
  const [todos, setTodos] = useState<null | PlTodos>(null)

  useEffect(() => {
    if (process.env.HERMES_POWERLINE_TODO === '0') {
      return
    }

    const store = __plTurnStore()
    const ui = (globalThis as { __hy?: { ui?: { get?: () => { busy?: boolean; sid?: null | string }; listen?: (cb: () => void) => () => void } } })
      .__hy?.ui

    if (!store?.get || !store.listen) {
      return
    }

    let linger: ReturnType<typeof setTimeout> | undefined
    let shown: null | PlTodoItem[] = null
    let shownLive = false
    // A list Hermes left behind (interrupt, API error) that already lingered and went away: it stays
    // gone — also when the next turn starts — until Hermes posts a different list.
    let dismissed: null | PlTodoItem[] = null
    let sid = ui?.get?.()?.sid ?? null

    const stopLinger = () => {
      if (linger) {
        clearTimeout(linger)
        linger = undefined
      }
    }

    const apply = () => {
      const u = ui?.get?.()
      const nowSid = u?.sid ?? null

      // Another session (tab switch, /new): its list is not ours — drop it at once.
      if (nowSid !== sid) {
        sid = nowSid
        stopLinger()
        shown = null
        dismissed = null
        setTodos(null)
      }

      const raw = store.get?.()?.todos
      const list = Array.isArray(raw) && raw !== dismissed ? raw : []
      // Live while the session works. After an interrupt Hermes does not archive the list, so an
      // idle session with a list left over counts as finished (dim, then gone).
      const live = list.length > 0 && (u ? !!u.busy : true)

      if (live) {
        stopLinger()

        // Same array + same state → no re-render (the store fires on every streamed token).
        if (list !== shown || !shownLive) {
          shown = list
          shownLive = true
          setTodos({ items: list, live: true })
        }

        return
      }

      const last = list.length ? list : shown

      if (last?.length && !linger && (shownLive || last !== shown)) {
        shown = last
        shownLive = false
        setTodos({ items: last, live: false })
        linger = setTimeout(() => {
          linger = undefined
          // Still the same list sitting in the store (not archived)? Then it is done for.
          const left = store.get?.()?.todos

          if (Array.isArray(left) && left === shown) {
            dismissed = left
          }

          shown = null
          setTodos(null)
        }, PL_TODO_LINGER_MS)
      }
    }

    try {
      apply()
    } catch {
      return
    }

    const safe = () => {
      try {
        apply()
      } catch {
        // a malformed store value never breaks the bar
      }
    }

    const offs = [store.listen(safe), ui?.listen?.(safe)]

    return () => {
      offs.forEach(off => off?.())
      stopLinger()
    }
  }, [])

  return todos
}

// ── tasks (subagents) ───────────────────────────────────────────────────
// Delegated work in flight: in-turn subagents AND background (async) delegations
// that outlive the turn — bridge.roster() merges both the way Hermes' live-agents
// dock does. Count of in-flight ones + the goal of the first running one.
interface PlTasks {
  goal: string
  /** true when bridge.roster() (in-turn + background) is the source; false = in-turn only. */
  merged: boolean
  n: number
}

type __PlSub = { goal?: string; status?: string }

type __PlStore = { listen?: (cb: () => void) => () => void }

const PL_TASK_IN_FLIGHT = new Set(['dispatched', 'finalizing', 'queued', 'running'])

// ── claude-sub + provider cells ──
// Claude Code (the coder route's hand, run by the claude-sub MCP server) at work: lit while a job runs
// (pulsing orange, spinner, time, ✗N for scope-gate denials) with a running-text line of what it does
// right now (tool → file / command, turn, its last words) when the row has room; a 4 s green/red flash
// when a job ends; hidden when idle. Next to it, a cell per other provider (Coarena) while one of its
// routes works, with the model read from the configs. Shown with or without the hy sidebar: the bar is
// the one place always on screen. State comes from the sidebar widget's poller and config read
// (globalThis.__hyClaudeState, __hyProviderLines) — one reader, so bar and rail never disagree; no
// widget, no cells. HERMES_POWERLINE_CLAUDE=0 hides them.
interface PlClaudeJob {
  denials: number
  effort?: string
  id: string
  model?: string
  say?: string
  startedAt: number
  status: string
  target?: string
  tool: string
  turns: number
}

/** A provider other than main's that route profiles run on (Coarena today), from the sidebar's config read. */
interface PlProvider {
  label: string
  models: string[]
  provider: string
  routes: string[]
  state: string
}

interface PlClaude {
  denials: number
  flash: null | string
  live: PlClaudeJob[]
  prov: PlProvider[]
}

const PL_CLAUDE_LIVE = new Set(['cancelling', 'running', 'starting'])
const PL_CLAUDE_SPIN = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f']

function usePlClaude(): null | PlClaude {
  const [state, setState] = useState<null | PlClaude>(null)

  useEffect(() => {
    if (process.env.HERMES_POWERLINE_CLAUDE === '0') {
      return
    }

    let rev = -1
    let shown = false

    const tick = () => {
      try {
        const g = (globalThis as {
          __hyClaudeState?: { flash: null | { id: string; until: number }; jobs: PlClaudeJob[]; rev: number }
        }).__hyClaudeState

        if (!g) {
          return
        }

        const live = g.jobs.filter(j => PL_CLAUDE_LIVE.has(j.status))
        const flashJob = g.flash && Date.now() < g.flash.until ? g.jobs.find(j => j.id === g.flash!.id) : undefined
        const lines = (globalThis as { __hyProviderLines?: () => PlProvider[] }).__hyProviderLines
        const prov = (lines?.() ?? []).filter(x => x.state === 'active')
        const on = live.length > 0 || !!flashJob || prov.length > 0

        // While something runs, every tick repaints (spinner, clock, running text); otherwise only real changes do.
        if (on || shown || g.rev !== rev) {
          rev = g.rev
          shown = on
          setState(on ? { denials: live.reduce((n, j) => n + (j.denials || 0), 0), flash: flashJob?.status ?? null, live, prov } : null)
        }
      } catch {
        // a widget mid-reload: keep the last state
      }
    }

    const timer = setInterval(tick, 300) // the running text steps one cell per tick

    timer.unref?.()
    tick()

    return () => clearInterval(timer)
  }, [])

  return state
}

function usePlTasks(): null | PlTasks {
  const [tasks, setTasks] = useState<null | PlTasks>(null)

  useEffect(() => {
    if (process.env.HERMES_POWERLINE_TODO === '0') {
      return
    }

    const hy = (globalThis as { __hy?: { agents?: __PlStore; roster?: () => __PlSub[]; turn?: __PlStore; ui?: __PlStore } }).__hy

    if (!hy?.turn?.listen) {
      return
    }

    // Older bridge (no roster): in-turn subagents only.
    const read = (): __PlSub[] =>
      hy.roster ? hy.roster() : ((hy.turn as { get?: () => { subagents?: __PlSub[] } }).get?.()?.subagents ?? [])

    let sig = ''

    const apply = () => {
      try {
        const list = read()
        const active = (Array.isArray(list) ? list : []).filter(s => PL_TASK_IN_FLIGHT.has(String(s?.status)))
        const goal = String(active.find(s => s?.status === 'running')?.goal ?? active[0]?.goal ?? '')
          .replace(/\s+/g, ' ')
          .trim()
        const next = `${active.length}\u0000${goal}`

        // The turn store fires on every streamed token; re-render only on a real change.
        if (next !== sig) {
          sig = next
          setTasks({ goal, merged: !!hy.roster, n: active.length })
        }
      } catch {
        // a malformed store value never breaks the bar
      }
    }

    apply()
    // turn: in-turn subagents · agents: background snapshot · ui: switching session (tab)
    const offs = [hy.turn.listen(apply), hy.agents?.listen?.(apply), hy.ui?.listen?.(apply)]

    return () => offs.forEach(off => off?.())
  }, [])

  return tasks
}

function usePlInbox(): null | PlInbox {
  const [inbox, setInbox] = useState<null | PlInbox>(null)
  const last = useRef('')

  useEffect(() => {
    if (!PL_CONF.inbox) {
      return
    }

    let alive = true
    let running = false

    const run = () => {
      if (running) {
        return
      }

      running = true
      __plExecFile(
        process.env.HERMES_POWERLINE_HERMES_BIN?.trim() || 'hermes',
        ['inbox', '--json'],
        { env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 4 << 20, timeout: 30_000 },
        (err, stdout) => {
          running = false

          if (!alive || err) {
            return
          }

          try {
            const j = JSON.parse(String(stdout)) as { attention?: { kind?: string }[]; finished_undelivered?: unknown[] }
            const att = Array.isArray(j.attention) ? j.attention : []
            const counts = new Map<string, number>()

            for (const a of att) {
              const k = PL_INBOX_KIND[String(a?.kind)] ?? String(a?.kind ?? '?')
              counts.set(k, (counts.get(k) ?? 0) + 1)
            }

            const next: PlInbox = {
              attention: att.length,
              kinds: [...counts].map(([k, n]) => `${n} ${k}`).join('·'),
              undelivered: Array.isArray(j.finished_undelivered) ? j.finished_undelivered.length : 0
            }

            const key = JSON.stringify(next)

            if (key !== last.current) {
              last.current = key
              setInbox(next.attention || next.undelivered ? next : null)
            }
          } catch {
            // unparsable output: keep the previous badge
          }
        }
      )
    }

    const first = setTimeout(run, 5_000)
    const id = setInterval(run, PL_INBOX_MS)

    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  return inbox
}

// ── git working-tree cell ──
// Not shown anywhere else (the sidebar has cwd/branch, not the tree state): changed files,
// untracked, conflicts, ahead/behind the upstream. `git status --porcelain=v2 --branch`
// async every 8 s (20 s outside a repo); no repo or any error → the cell hides.
interface PlGit {
  ahead: number
  behind: number
  changed: number
  conflicts: number
  untracked: number
}

const plGitParse = (out: string): PlGit => {
  const g: PlGit = { ahead: 0, behind: 0, changed: 0, conflicts: 0, untracked: 0 }

  for (const line of out.split('\n')) {
    const ab = line.match(/^# branch\.ab \+(\d+) -(\d+)/)

    if (ab) {
      g.ahead = Number(ab[1])
      g.behind = Number(ab[2])
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      g.changed++
    } else if (line.startsWith('u ')) {
      g.conflicts++
    } else if (line.startsWith('? ')) {
      g.untracked++
    }
  }

  return g
}

function usePlGit(): null | PlGit {
  const [git, setGit] = useState<null | PlGit>(null)
  const last = useRef('')

  useEffect(() => {
    if (process.env.HERMES_POWERLINE_GIT === '0') {
      return
    }

    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = () => {
      // The TUI process runs inside its own build dir; the session's working dir comes from
      // the session info, else the launch dir Hermes passes down (HERMES_TUI_CWD / HERMES_CWD).
      const cwd =
        (globalThis as { __hy?: { ui?: { get?: () => { info?: { cwd?: string } } } } }).__hy?.ui?.get?.()?.info?.cwd ||
        process.env.HERMES_TUI_CWD ||
        process.env.HERMES_CWD ||
        process.env.PWD ||
        process.cwd()

      __plExecFile(
        'git',
        ['-C', cwd, 'status', '--porcelain=v2', '--branch', '--untracked-files=normal'],
        { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, maxBuffer: 2 << 20, timeout: 4_000 },
        (err, stdout) => {
          if (!alive) {
            return
          }

          const next = err ? null : plGitParse(String(stdout))
          const key = JSON.stringify(next)

          if (key !== last.current) {
            last.current = key
            setGit(next)
          }

          timer = setTimeout(run, err ? 20_000 : 8_000)
        }
      )
    }

    timer = setTimeout(run, 1_500)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  return git
}

const PL_ERR_SHORT: Record<string, string> = {
  auth: 'auth',
  auth_permanent: 'auth',
  billing: 'billing',
  content_policy_blocked: 'policy',
  context_overflow: 'ctx full',
  format_error: 'bad req',
  model_not_found: 'no model',
  overloaded: 'overload',
  payload_too_large: 'too big',
  rate_limit: 'rate limit',
  server_error: 'server',
  timeout: 'timeout',
  upstream_blocked: 'blocked',
  upstream_rate_limit: 'upstream 429'
}

type PlErrKind = 'client' | 'net' | 'rate' | 'server'

/** Timeouts and dropped connections: no HTTP status, the transport failed. */
const plIsNet = (e: PlNetErr) =>
  e.code == null && (e.reason === 'timeout' || /connect|network|timeout|remoteprotocol|readerror/i.test(e.type ?? ''))

function plErrKind(e: PlNetErr): PlErrKind {
  const r = e.reason ?? ''

  if (e.code === 429 || r === 'rate_limit' || r === 'upstream_rate_limit') {
    return 'rate'
  }

  if ((e.code != null && e.code >= 500) || r === 'overloaded' || r === 'server_error') {
    return 'server'
  }

  // Everything else — 4xx, and status-less refusals such as a content-policy block or an
  // invalid response — is "the request was rejected", not a network problem.
  return plIsNet(e) ? 'net' : 'client'
}

/** Short reason: the known table, else Hermes' own reason name, else ''. */
const plWhy = (e: PlNetErr) => {
  const r = e.reason ?? ''

  return PL_ERR_SHORT[r] ?? (r && r !== 'unknown' ? r.replace(/_/g, ' ').slice(0, 16) : '')
}

// xterm-256 exact colours (tmux / Termius here are 256-colour): 160 red, 208 orange, 134 purple, 166 rust.
const PL_ERR_BG: Record<PlErrKind, { bg: string; fg: string }> = {
  client: { bg: '#AF5FD7', fg: '#FFFFFF' },
  net: { bg: '#D75F00', fg: '#FFFFFF' },
  rate: { bg: '#FF8700', fg: '#000000' },
  server: { bg: '#D70000', fg: '#FFFFFF' }
}

/** "503 overload ↻2/3 ×2"; `short` drops everything but the code. */
function plErrText(e: PlNetErr, short: boolean): string {
  const net = plIsNet(e)
  const head =
    e.code != null
      ? String(e.code)
      : net
        ? e.reason === 'timeout' || /timeout/i.test(e.type ?? '') ? 'timeout' : 'conn'
        : plWhy(e) || 'error'

  if (short) {
    return head
  }

  // With a status code the reason follows it; without one the head already is the reason.
  const why = e.code != null ? plWhy(e) : ''
  const attempt = e.retry != null && e.max && e.retryable !== false ? ` ↻${e.retry + 1}/${e.max}` : ''
  // Consecutive failures — only when the retry counter does not already say it.
  const streak = !attempt && e.n > 1 ? ` ×${e.n}` : ''

  return `${head}${why ? ` ${why}` : ''}${attempt}${streak}`
}

const plRate = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)))

const plBar = (pct: number, w: number) => {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w)

  return ['█'.repeat(filled), '░'.repeat(w - filled)] as const
}

// "~/proj (main)" → path + branch, so the branch gets the  glyph.
const plSplitCwd = (label: string): { branch: string; path: string } => {
  const m = /^(.*\S)\s+\(([^()]+)\)\s*$/.exec(label.trim())

  return m ? { branch: m[2]!, path: m[1]! } : { branch: '', path: label.trim() }
}

// Dracula — https://draculatheme.com/contribute
const PL_DRACULA = {
  bg: '#282A36',
  comment: '#6272A4',
  current: '#44475A',
  cyan: '#8BE9FD',
  darker: '#21222C',
  fg: '#F8F8F2',
  green: '#50FA7B',
  orange: '#FFB86C',
  pink: '#FF79C6',
  purple: '#BD93F9',
  red: '#FF5555',
  yellow: '#F1FA8C'
}

interface PlPalette {
  branch: string
  busy: string
  cacheBg: (pct: number) => string
  ctxBg: string
  ctxColor: (pct: number | undefined) => string
  cwdBg: string
  cwdFg: string
  dark: string
  deep: string
  dim: string
  durBg: string
  idleBg: string
  idleFg: string
  latencyBg: string
  light: string
  mid: string
  model: string
  ok: (statusColor: string | undefined) => string
  titleBg: string
  tpsBg: string
  warn: string
  yolo: string
  yoloFg: string
}

function plPalette(t: StatusRuleProps['t']): PlPalette {
  const D = PL_DRACULA

  if (PL_CONF.palette !== 'skin') {
    return {
      branch: D.green,
      busy: D.pink,
      cacheBg: pct => (pct >= 70 ? D.green : pct >= 40 ? D.yellow : D.orange),
      ctxBg: D.current,
      ctxColor: pct => (pct == null ? D.fg : pct >= 90 ? D.red : pct >= 75 ? D.orange : pct >= 50 ? D.yellow : D.green),
      cwdBg: D.comment,
      cwdFg: D.fg,
      dark: D.bg,
      deep: D.comment,
      dim: D.bg,
      durBg: D.orange,
      idleBg: D.current,
      idleFg: D.green,
      latencyBg: D.orange,
      light: D.fg,
      mid: D.current,
      model: D.purple,
      // Keep the stock error/warn meaning of the status colour, Dracula-ised.
      ok: c => (c && c === t.color.error ? D.red : c && c === t.color.warn ? D.orange : D.green),
      titleBg: D.pink,
      tpsBg: D.cyan,
      warn: D.yellow,
      yolo: D.red,
      yoloFg: D.fg
    }
  }

  const dark = t.color.completionBg || D.bg
  const mid = t.color.selectionBg || D.current

  return {
    branch: t.color.label,
    busy: t.color.accent,
    cacheBg: () => mid,
    ctxBg: mid,
    ctxColor: pct => ctxBarColor(pct, t),
    cwdBg: mid,
    cwdFg: t.color.label,
    dark,
    deep: t.color.statusBg || D.darker,
    dim: t.color.border || D.comment,
    durBg: t.color.border || D.comment,
    idleBg: t.color.border || D.comment,
    idleFg: t.color.text,
    latencyBg: mid,
    light: t.color.text,
    mid,
    model: t.color.prompt,
    ok: c => c || t.color.ok,
    titleBg: t.color.accent,
    tpsBg: mid,
    warn: t.color.warn,
    yolo: t.color.error,
    yoloFg: dark
  }
}

// Session clock padded to a fixed width, so the shared right block never jitters.
function PlDuration({ bg, fg, icon, startedAt }: { bg: string; fg: string; icon: string; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  const isOccluded = useStore($isStatusRuleOccluded)

  useEffect(() => {
    if (isOccluded) {
      return
    }

    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(id)
  }, [isOccluded, startedAt])

  const txt = fmtDuration(Math.max(0, now - startedAt))
  const gap = Math.max(0, MAX_DURATION_WIDTH - stringWidth(txt))
  const pad = (n: number) => ' '.repeat(n)

  return (
    <Text backgroundColor={bg} bold color={fg}>
      {` ${icon}${pad(Math.floor(gap / 2))}${txt}${pad(gap - Math.floor(gap / 2))} `}
    </Text>
  )
}

// Keep the head of `s` within `w` cells ("Add rate limit to…").
/** A window of `width` cells sliding along `s` (wraps with a gap), for text longer than its room. */
const plMarquee = (s: string, width: number): string => {
  const chars = [...`${s}   \u00b7   `]
  const off = Math.floor(Date.now() / 300) % chars.length
  const loop = [...chars.slice(off), ...chars.slice(0, off)]
  let out = ''
  let w = 0

  for (const ch of loop) {
    const cw = stringWidth(ch)

    if (w + cw > width) {
      break
    }

    out += ch
    w += cw
  }

  // Always exactly `width` cells (a wide glyph at the edge leaves a gap), so the bar never jitters.
  return out + ' '.repeat(Math.max(0, width - w))
}

function plTruncEnd(s: string, w: number): string {
  if (stringWidth(s) <= w) {
    return s
  }

  let chars = [...s]

  while (chars.length && stringWidth(chars.join('')) > w - 1) {
    chars = chars.slice(0, -1)
  }

  return `${chars.join('').trimEnd()}\u2026`
}

// Keep the tail of `s` within `w` cells ("…/long/path").
function plTruncStart(s: string, w: number): string {
  if (stringWidth(s) <= w) {
    return s
  }

  let chars = [...s]

  while (chars.length && stringWidth(chars.join('')) > w - 1) {
    chars = chars.slice(1)
  }

  return `\u2026${chars.join('')}`
}

const PL_SIDEBAR_DUPES = new Set(['model', 'context_detail', 'context_pct', 'cache_hit', 'title', 'compressions', 'bg_subagents'])

/** Is the hy sidebar widget open in the right rail? (bridge published by bridge.ts) */
const __plSidebarOpen = (): boolean => {
  try {
    const ov = (globalThis as { __hy?: { overlay?: { get?: () => { ambient?: { appId: string }[] } } } }).__hy?.overlay?.get?.()

    return Boolean(ov?.ambient?.some(a => a.appId === 'hy-sidebar'))
  } catch {
    return false
  }
}

/** Sidebar open/closed as React state: the status row is memoised and listens to $uiState only, so
 *  reading the overlay during render went stale after /hy-sidebar or the auto-open on resize. */
function usePlSidebarOpen(): boolean {
  const [open, setOpen] = useState(__plSidebarOpen)

  useEffect(() => {
    const ov = (globalThis as { __hy?: { overlay?: { listen?: (cb: () => void) => () => void } } }).__hy?.overlay
    const sync = () => setOpen(__plSidebarOpen())

    sync()

    return ov?.listen?.(sync)
  }, [])

  return open
}

function PowerlineRule(p: StatusRuleProps) {
  const { busy, cols, t, usage } = p
  const net = usePlNet()
  const inbox = usePlInbox()
  const todos = usePlTodos()
  const tasks = usePlTasks()
  const claudeSt = usePlClaude()
  const git = usePlGit()
  const T = messages()
  const sep = PL_SEPS[PL_CONF.style] ?? PL_SEPS.arrow
  // Icon + gap (2 cells by default, so full-size Nerd Font glyphs have room).
  const ic = (glyph: string) => (PL_CONF.icons ? glyph.trimEnd() + __PL_LOOK.gap : '')
  const mono = __PL_LOOK.mono
  const edge = __PL_LOOK.edge
  // With the hy sidebar open, cells it already shows (model, context, cache, title/folder/
  // branch, compressions, subagents) leave the bar — no duplicated information. The sidebar
  // hides itself on narrow terminals, and then the bar shows everything again.
  const sideOpen = usePlSidebarOpen()
  const ok = (name: string) =>
    (p.statusBarFields == null || p.statusBarFields.has(name)) && !(sideOpen && PL_SIDEBAR_DUPES.has(name))

  // Palette — Dracula by default; `palette: "skin"` follows /skin instead.
  const C = plPalette(t)
  const { dark, deep, light, mid } = C
  const dim = C.dim

  // The status row sits inside a `paddingX={1}` box (appLayout), so the real
  // room is cols - 2 — the same allowance GoalBar/LoopBar use. The stock rule
  // passes full cols and silently clips its tail; we'd lose our end arrow.
  const width = Math.max(1, Math.floor(cols || 1) - 2)
  const segW = (contentW: number) => contentW + 2 + __PL_LOOK.sepW // ' x ' padding + one separator

  // ── pinned (always shown) ────────────────────────────────────────────
  const pinned: PlSeg[] = []

  if (PL_YOLO && ok('yolo')) {
    pinned.push({ bg: C.yolo, bold: true, fg: C.yoloFg, key: 'yolo', node: PL_WARN_YOLO, tone: 'err', w: stringWidth(PL_WARN_YOLO) })
  }

  if (p.battery && p.battery.available && p.battery.percent != null && ok('battery')) {
    const txt = batteryLabel(p.battery)

    pinned.push({ bg: mid, fg: batteryColor(p.battery, t), key: 'battery', node: txt, w: stringWidth(txt) })
  }

  const style = p.indicatorStyle ?? 'kaomoji'
  const showNotice = !busy && !!p.notice?.text

  if (busy) {
    const face = (color: string) => (
      <FaceTicker
        color={color}
        startedAt={p.turnStartedAt}
        style={style}
        verbOverride={p.compacting ? T.status.compacting : undefined}
      />
    )

    // While compacting, FaceTicker shows the override verb even for verb-less styles (padded to
    // VERB_PAD_LEN); busyIndicatorWidth does not count it. Over-estimate rather than overflow.
    const faceW =
      busyIndicatorWidth(style, p.turnStartedAt != null) +
      (p.compacting ? 1 + Math.max(VERB_PAD_LEN, stringWidth(`${T.status.compacting}…`)) : 0)

    pinned.push({
      bg: C.busy,
      bold: true,
      fg: dark,
      key: 'status',
      node: face(dark),
      render: bg => face(__plInk(bg)),
      w: faceW
    })
  } else if (showNotice) {
    const raw = p.notice!.text
    const txt = stringWidth(raw) > 32 ? `${raw.slice(0, 31)}…` : raw

    pinned.push({ bg: noticeColor(p.notice!.level, t), bold: true, fg: dark, key: 'status', node: txt, tone: 'warn', w: stringWidth(txt) })
  } else {
    const bg = C.ok(p.statusColor)
    const bad = PL_CONF.palette !== 'skin' && bg !== PL_DRACULA.green
    const tone = bg === PL_DRACULA.red ? 'err' : bg === PL_DRACULA.orange ? 'warn' : undefined
    const txt = `${ic(bad ? '\u{f0026}' : '\u{f05e0}')}${displayStatus(p.status)}`

    pinned.push({ bg, bold: true, fg: dark, key: 'status', node: txt, tone, w: stringWidth(txt) })
  }

  let errShort = ''
  // API error (HTTP 4xx/5xx, timeout, connection): pinned right after the
  // status so it is never budgeted away. Live = solid alarm colour; after the
  // retry succeeds it stays for a minute, dimmed, so a quick blip is still seen.
  const nowMs = Date.now()
  // Live while recent, or while the turn that raised it is still running (a long turn can
  // outlast the stale window). An old error is NOT revived just because a new turn started.
  const liveErr =
    net?.err &&
    (nowMs - net.err.at * 1000 < PL_ERR_STALE_MS || (busy && p.turnStartedAt != null && net.err.at * 1000 >= p.turnStartedAt))
      ? net.err
      : null
  const pastErr = !liveErr && net?.recovered && nowMs - (net.recovered.ok_at ?? 0) * 1000 < PL_RECOVERED_MS ? net.recovered : null

  if (liveErr || pastErr) {
    const e = (liveErr ?? pastErr)!
    const kind = plErrKind(e)
    const colors = liveErr ? PL_ERR_BG[kind] : { bg: '#3A3A3A', fg: PL_ERR_BG[kind].bg }
    const icon = PL_CONF.icons ? ic(liveErr ? '\u{f0026}' : '↺') : liveErr ? '! ' : '~ '
    // Recovered: the retry counter is history — code + reason is the news.
    const txt = `${icon}${plErrText(liveErr ? e : { ...e, retry: null }, false)}`

    pinned.push({ bg: colors.bg, bold: !!liveErr, fg: colors.fg, fixed: true, key: 'apierr', node: txt, w: stringWidth(txt) })
    errShort = `${icon}${plErrText(e, true)}`
  }

  // Todo progress and running tasks (subagents) — always on the bar (HERMES_POWERLINE_TODO=0 hides
  // them). Todo: done/total and the step in progress; orange while working, green when every item is
  // done, dimmed after the turn ends, a dim "—" when there is no list. Tasks: subagents running or
  // queued and the first one's goal; dim "0 task" when idle. With the hy sidebar open (it lists
  // items and goals) only the counts stay. Narrow terminals drop the text, then the idle cells.
  const todoOn = process.env.HERMES_POWERLINE_TODO !== '0'
  const shrink: { seg: PlSeg; short: string; idle: boolean }[] = []
  // Text that rides on a pinned cell only when the row has room for it (claimed after the right
  // block is reserved, before the metrics): the todo step, then the task goal.
  const grow: { marquee?: boolean; seg: PlSeg; text: string }[] = []

  if (todoOn) {
    const items = (todos?.items ?? []).filter(x => x.status !== 'cancelled')
    const total = items.length
    const done = items.filter(x => x.status === 'completed').length
    const all = total > 0 && done === total
    const live = !!todos?.live && total > 0
    const cur = items.find(x => x.status === 'in_progress')?.content?.replace(/\s+/g, ' ').trim() ?? ''
    const icon = PL_CONF.icons ? ic(all ? '\u{f0135}' : '\u{f0756}') : all ? '\u2713 ' : '\u2261 '
    const count = total > 0 ? `${icon}${done}/${total}` : `${icon}\u2014`
    const txt = count
    const seg: PlSeg = {
      bg: mid,
      bold: live,
      fg: !live ? dim : all ? '#50FA7B' : '#FFB86C',
      key: 'todo',
      muted: !live,
      node: txt,
      tone: live ? (all ? 'accent' : 'warn') : undefined,
      w: stringWidth(txt)
    }

    pinned.push(seg)
    shrink.push({ idle: total === 0, seg, short: count })

    if (cur && live && !sideOpen) {
      grow.push({ seg, text: cur })
    }
  }

  if (todoOn && tasks) {
    const n = tasks.n
    const icon = PL_CONF.icons ? ic('\u{f000e}') : '\u00bb '
    const count = `${icon}${n} ${n === 1 ? 'task' : 'tasks'}`
    const txt = count
    const seg: PlSeg = {
      bg: mid,
      bold: n > 0,
      fg: n > 0 ? '#FFB86C' : dim,
      key: 'tasks',
      muted: n === 0,
      node: txt,
      tone: n > 0 ? 'warn' : undefined,
      w: stringWidth(txt)
    }

    pinned.push(seg)
    shrink.push({ idle: n === 0, seg, short: `${icon}${n}` })

    if (n > 0 && tasks.goal && !sideOpen) {
      grow.push({ seg, text: tasks.goal })
    }
  }

  if (claudeSt) {
    const icon = PL_CONF.icons ? ic('\u273b') : '* '
    const spin = PL_CLAUDE_SPIN[Math.floor(Date.now() / 100) % PL_CLAUDE_SPIN.length]

    if (claudeSt.live.length) {
      const j = claudeSt.live[0]
      const secs = j.startedAt ? Math.max(0, Math.round(Date.now() / 1000 - j.startedAt)) : 0
      const clock = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}`
      const more = claudeSt.live.length > 1 ? ` \u00d7${claudeSt.live.length}` : ''
      const denied = claudeSt.denials ? ` \u2717${claudeSt.denials}` : ''
      const txt = `${icon}claude ${spin} ${clock}${more}${denied}`
      const seg: PlSeg = {
        bg: Math.floor(Date.now() / 600) % 2 ? '#FFB86C' : '#F1FA8C',
        bold: true,
        fg: dark,
        fixed: true,
        key: 'claude',
        node: txt,
        w: stringWidth(txt)
      }

      pinned.push(seg)
      shrink.push({ idle: false, seg, short: `${icon}${spin}${denied}` })

      const doing = j.tool ? `${j.tool}${j.target ? ` ${j.target}` : ''}` : j.status === 'starting' ? 'starting' : 'thinking'
      const detail = [doing, j.turns ? `turn ${j.turns}` : '', j.say ? `\u201c${j.say}\u201d` : ''].filter(Boolean).join(' \u00b7 ')

      grow.push({ marquee: true, seg, text: detail })
    } else if (claudeSt.flash) {
      const good = claudeSt.flash === 'done'
      const word = good ? 'done' : claudeSt.flash === 'rate_limited' ? 'limit' : claudeSt.flash
      const txt = `${good ? '\u2713 ' : '\u00d7 '}claude ${word}`

      pinned.push({ bg: good ? '#50FA7B' : '#FF5555', bold: true, fg: dark, fixed: true, key: 'claude', node: txt, w: stringWidth(txt) })
    }

    for (const pv of claudeSt.prov) {
      const pIcon = PL_CONF.icons ? ic('\u25c7') : '<> '
      const txt = `${pIcon}${pv.label} ${spin} ${pv.models.join(', ')}`
      const seg: PlSeg = {
        bg: Math.floor(Date.now() / 600) % 2 ? '#BD93F9' : '#8BE9FD',
        bold: true,
        fg: dark,
        fixed: true,
        key: `prov-${pv.provider}`,
        node: txt,
        w: stringWidth(txt)
      }

      pinned.push(seg)
      shrink.push({ idle: false, seg, short: `${pIcon}${spin}` })
    }
  }

  // Inbox: work that needs the operator (orange, alarm-fixed) or only uncollected
  // delegation results (calm blue). Pinned so it is never budgeted away; hidden when clear.
  if (inbox) {
    const attn = inbox.attention > 0
    const icon = PL_CONF.icons ? ic(attn ? '\u{f1295}' : '\u{f02fb}') : attn ? '! ' : '> '
    const txt = attn
      ? `${icon}${inbox.kinds}${inbox.undelivered ? `·${inbox.undelivered} result` : ''}`
      : `${icon}${inbox.undelivered} result`

    pinned.push({ bg: attn ? '#FF8700' : '#5F87D7', bold: attn, fg: dark, fixed: true, key: 'inbox', node: txt, trunc: true, w: stringWidth(txt) })
  }

  if (DEV_CREDITS_MODE) {
    pinned.push({ bg: C.warn, fg: dark, key: 'devmode', node: T.status.devCredits, w: stringWidth(T.status.devCredits) })
  }

  const modelText = `${ic('\u{f0674}')}${modelLabel(p.model, p.modelReasoningEffort, p.modelFast, p.modelReasoningEffortWire)}`

  if (ok('model')) {
    pinned.push({ bg: C.model, bold: true, fg: dark, key: 'model', node: modelText, trunc: true, w: stringWidth(modelText) })
  }

  // Context: token count always; the meter + % is optional (budgeted below).
  const pct = usage.context_percent ?? undefined
  const mark = usage.context_estimated ? '~' : ''
  const ctxColor = C.ctxColor(pct)

  const narrow = width < 72

  const ctxLabel =
    ok('context_detail') || ok('context_pct')
      ? usage.context_max
        ? narrow
          ? `${mark}${compactNumber(usage.context_used ?? 0)} tok`
          : `${mark}${compactNumber(usage.context_used ?? 0)}/${compactNumber(usage.context_max ?? 0)}`
        : (usage.total ?? 0) > 0
          ? `${compactNumber(usage.total)} tok`
          : ''
      : ''

  if (p.focusView) {
    pinned.push({ bg: C.warn, bold: true, fg: dark, key: 'focus', node: '◉ focus', w: stringWidth('◉ focus') })
  }

  const capW = stringWidth(sep.capL) + stringWidth(sep.capR)
  const pinnedW = () => pinned.reduce((sum, s) => sum + segW(s.w), 0) + capW

  // Narrow terminal: degrade whole segments instead of clipping mid-text.
  if (pinnedW() > width) {
    const yolo = pinned.find(s => s.key === 'yolo')

    if (yolo) {
      yolo.node = PL_WARN
      yolo.w = stringWidth(PL_WARN)
    }

    const apiErr = pinned.find(s => s.key === 'apierr')

    if (apiErr && errShort) {
      apiErr.node = errShort
      apiErr.w = stringWidth(errShort)
    }

    for (const x of shrink) {
      x.seg.node = x.short
      x.seg.w = stringWidth(x.short)
    }

    // Still too wide: idle todo/task cells go first.
    for (const x of shrink) {
      if (x.idle && pinnedW() > width) {
        pinned.splice(pinned.indexOf(x.seg), 1)
      }
    }
  }

  // Context is the first optional-ish thing: added only when it fits whole.
  let ctxSeg: null | PlSeg = null

  if (ctxLabel) {
    const txt = `${ic('\u{f01bc}')}${ctxLabel}` // nf-md-database

    ctxSeg = { bg: C.ctxBg, fg: light, key: 'ctx', node: txt, trunc: true, w: stringWidth(txt) }

    if (pinnedW() + segW(ctxSeg.w) <= width) {
      const modelAt = pinned.findIndex(s => s.key === 'model')

      pinned.splice(modelAt >= 0 ? modelAt + 1 : pinned.length, 0, ctxSeg)
    } else {
      ctxSeg = null
    }
  }

  // ── right side (session title or cwd  branch) ───────────────────────
  const title = p.sessionTitle && ok('title') ? p.sessionTitle : ''
  const cwd = plSplitCwd(p.cwdLabel || '')

  const rightText = title
    ? `${ic('󰆍 ')}${title}`
    : `${ic('\uf07c ')}${cwd.path}${cwd.branch ? `  ${ic('\ue0a0 ')}${cwd.branch}` : ''}`

  const rightBg = mono ? __plGray(6) : title ? C.titleBg : C.cwdBg
  const rightFg = mono ? __plInk(rightBg) : title ? dark : C.cwdFg
  const branchFg = mono ? rightFg : C.branch
  let durBg = mono ? __plGray(9) : C.durBg
  let durFg = mono ? __plInk(durBg) : PL_CONF.palette !== 'skin' ? dark : light
  let budget = width - pinnedW()
  // Balanced layout: the prompt row below ends in a CPU/GPU/RAM/temp block of
  // exactly this width; ours (folder · branch · clock) mirrors it.
  const sharedW = __plRightWidth(cols)
  const durOn = ok('duration') && !!p.sessionStartedAt
  const durIcon = ic('\u{f051b} ')
  const durW = durOn ? stringWidth(durIcon) + MAX_DURATION_WIDTH + 2 : 0
  const sepW = __PL_LOOK.sepW
  const durPart = durOn ? sepW + durW : 0

  // Top-right block: folder › branch › clock, each its own grey step. It is
  // only as wide as its content, and never takes more than 45% of the row.
  const rCells: { bg: string; bold?: boolean; fg: string; text: string; trunc?: boolean }[] = []

  if (sharedW > 0 && !sideOpen) {
    const room = Math.max(0, Math.floor(width * 0.45) - durPart)

    if (title) {
      const bg = mono ? __plGray(6) : C.titleBg

      if (room - sepW >= 8) {
        rCells.push({ bg, bold: true, fg: mono ? __plInk(bg) : dark, text: plTruncStart(` ${ic('\u{f0b79}')}${title} `, room - sepW), trunc: true })
      }
    } else {
      const br = cwd.branch ? ` ${ic('\u{f062c}')}${cwd.branch} ` : ''
      const brW = stringWidth(br)
      const keepBranch = brW > 0 && brW + 2 * sepW + 10 <= room
      const pathRoom = room - sepW - (keepBranch ? brW + sepW : 0)

      if (pathRoom >= 6) {
        const pbg = mono ? __plGray(5) : C.cwdBg

        rCells.push({ bg: pbg, fg: mono ? __plInk(pbg) : C.cwdFg, text: plTruncStart(` ${ic('\u{f0770}')}${cwd.path} `, pathRoom), trunc: true })

        if (keepBranch) {
          const bbg = mono ? __plGray(7) : C.mid

          rCells.push({ bg: bbg, bold: true, fg: mono ? __plInk(bbg) : C.branch, text: br })
        }
      }
    }
  }

  // git tree state, right before the clock: ±changed ?untracked !conflicts ↑ahead ↓behind, or ✓.
  if (git && sharedW > 0) {
    const bits = [
      git.conflicts ? `!${git.conflicts}` : '',
      git.changed ? `±${git.changed}` : '',
      git.untracked ? `?${git.untracked}` : '',
      git.ahead ? `↑${git.ahead}` : '',
      git.behind ? `↓${git.behind}` : ''
    ].filter(Boolean)
    const txt = ` ${ic('\u{f02a2}')}${bits.length ? bits.join(' ') : '✓'} `

    rCells.push({ bg: C.mid, bold: bits.length > 0, fg: mono ? __plInk(C.mid) : C.branch, text: txt })
  }

  // The left bar and this block must share one row. When they do not fit (a long busy face,
  // the todo/task cells, a long title), give way in order: idle todo/task cells leave the bar,
  // then the block's first cell (title or folder) is shortened, then dropped.
  const blockWidth = () => (sharedW > 0 ? rCells.reduce((n, c) => n + stringWidth(c.text) + sepW, 0) + durPart : 0)
  const overBy = () => pinnedW() + blockWidth() + 1 - width

  // Give way in this order, re-checking after each step: (1) todo/task cells drop their words
  // ("0 tasks" → "0"), (2) the title/folder cell is shortened, (3) idle todo/task cells leave,
  // (4) block cells leave from the left (never the clock), (5) long pinned cells shorten (below).
  if (overBy() > 0) {
    for (const x of shrink) {
      x.seg.node = x.short
      x.seg.w = stringWidth(x.short)
    }
  }

  const first = rCells[0]

  if (overBy() > 0 && first?.trunc) {
    const keep = stringWidth(first.text) - overBy()

    if (keep >= 8) {
      first.text = `${plTruncEnd(first.text.trimEnd(), keep - 1)} `
    }
  }

  for (const x of shrink) {
    if (x.idle && overBy() > 0 && pinned.includes(x.seg)) {
      pinned.splice(pinned.indexOf(x.seg), 1)
    }
  }

  while (overBy() > 0 && rCells.length) {
    const cell = rCells[0]!
    const keep = stringWidth(cell.text) - overBy()

    if (cell.trunc && keep >= 8) {
      cell.text = `${plTruncEnd(cell.text.trimEnd(), keep - 1)} `
    } else {
      rCells.shift()
    }
  }

  // Last resort: the long pinned cells (model name, inbox detail, context) shorten — longest first —
  // or leave, so row 1 never overflows into a clipped, half-drawn row.
  for (const seg of pinned.filter(x => x.trunc).sort((a, b) => b.w - a.w)) {
    const over = overBy()

    if (over <= 0) {
      break
    }

    const keep = seg.w - over

    if (keep >= 6 && typeof seg.node === 'string') {
      const cut = plTruncEnd(seg.node, keep)

      seg.node = cut
      seg.w = stringWidth(cut)
    } else {
      pinned.splice(pinned.indexOf(seg), 1)
    }
  }

  // Still too wide (very narrow terminal + busy face + API error): working todo/task cells go too.
  for (const x of shrink) {
    if (overBy() > 0 && pinned.includes(x.seg)) {
      pinned.splice(pinned.indexOf(x.seg), 1)
    }
  }

  // Cells may have left the bar since the budget was taken: hand their room back.
  budget = width - pinnedW()

  // Mono: the top-right block mirrors the left bar — darkest cell at the right
  // screen edge (the clock), lighter toward the middle.
  if (mono) {
    const m = rCells.length + (durOn ? 1 : 0)

    rCells.forEach((c, j) => {
      c.bg = __plEdgeGray(m - 1 - j, m)
      // keep alarm colours (red/orange); everything else takes the ramp's ink
      c.fg = c.fg === '#FF5F5F' || c.fg === '#FFAF5F' ? c.fg : __plInk(c.bg)
    })
    durBg = __plEdgeGray(0, m)
    durFg = __plInk(durBg)
  }

  const blockW = blockWidth()

  const sepR = (prev: string | undefined, bg: string) =>
    edge && __PL_LOOK.thin ? (
      prev ? (
        <Text backgroundColor={prev} color={edge}>
          {__PL_LOOK.thinOf(sep.r)}
        </Text>
      ) : (
        <Text color={bg}>{sep.r}</Text>
      )
    ) : edge ? (
      <>
        <Text backgroundColor={prev} color={edge}>
          {sep.r}
        </Text>
        <Text backgroundColor={edge} color={bg}>
          {sep.r}
        </Text>
      </>
    ) : (
      <Text backgroundColor={prev} color={bg}>
        {sep.r}
      </Text>
    )

  // Right segment: reserve a short stub now (path/title tail stays visible),
  // let the metrics tail claim space first, then hand the leftovers back.
  const rightWanted = rightText.trim() ? stringWidth(rightText) + 3 + 1 : 0
  const RIGHT_STUB = 16
  let rightW = sharedW > 0 ? 0 : Math.min(rightWanted, RIGHT_STUB, Math.max(0, budget - 1))

  if (rightW < 10) {
    rightW = 0
  }

  if (blockW > 0) {
    budget -= blockW + 1
  }

  budget -= rightW

  const fits = (w: number) => {
    if (budget >= w) {
      budget -= w

      return true
    }

    return false
  }

  // ── optional tail, evaluated in priority order ─────────────────────────
  const tail: PlSeg[] = []
  const add = (seg: PlSeg) => (fits(segW(seg.w)) ? (tail.push(seg), true) : false)

  // Todo step / task goal: as much as the row has left, at most 28 cells each, at least 8 or nothing.
  for (const g of grow) {
    if (!pinned.includes(g.seg)) {
      continue
    }

    const room = Math.min(g.marquee ? 40 : 28, budget - 3) // ' · ' joiner

    if (room >= 8) {
      // Running text: a line longer than the room scrolls through it (≈3 cells/s) instead of being cut.
      const tw = stringWidth(g.text)
      const text = g.marquee && tw > room ? plMarquee(g.text, room) : plTruncEnd(g.text, room)
      const extra = ` \u00b7 ${text}`
      const w = stringWidth(extra)

      g.seg.node = `${g.seg.node as string}${extra}`
      g.seg.w += w
      budget -= w
    }
  }

  // Hand leftover budget to the right segment (title / cwd).
  const growRight = () => {
    if (rightWanted > rightW && budget > 0) {
      const grown = rightW + Math.min(rightWanted - rightW, budget)

      if (grown >= 10 && sharedW === 0) {
        budget -= grown - rightW
        rightW = grown
      }
    }
  }

  // Metrics first: tokens/s is the reason this bar exists. With the plugin it
  // is the LAST call's generation speed (output tokens / time after the first
  // chunk); without it, Hermes' blended 10-call average, marked with ≈.
  // A non-streamed call has no first-chunk time, so its rate is end-to-end: marked ≈ too.
  const lastTps = net?.last?.tps
  const tps =
    typeof lastTps === 'number' && lastTps > 0
      ? `${ic('\u{f04c5}')}${net?.last?.tps_streamed === false ? '\u2248' : ''}${plRate(lastTps)} t/s`
      : typeof usage.avg_tps === 'number'
        ? `${ic('\u{f04c5}')}≈${plRate(usage.avg_tps)} t/s`
        : ''

  if (tps && ok('tps')) {
    add({ bg: C.tpsBg, bold: true, fg: PL_CONF.palette !== 'skin' ? dark : t.color.label, key: 'tps', node: tps, w: stringWidth(tps) })
  }

  if (typeof usage.cache_hit_pct === 'number' && ok('cache_hit')) {
    const txt = `${ic('\u{f00e8}') || '◎ '}${usage.cache_hit_pct}%` // nf-md-cached
    const c = usage.cache_hit_pct >= 70 ? t.color.statusGood : usage.cache_hit_pct >= 40 ? t.color.statusWarn : light
    const dracula = PL_CONF.palette !== 'skin'

    add({ bg: C.cacheBg(usage.cache_hit_pct), fg: dracula ? dark : c, key: 'cache', node: txt, w: stringWidth(txt) })
  }

  // Latency: the last call's time to first token (prefill + queue) — the part
  // the t/s figure above deliberately leaves out. Fallback: Hermes' average.
  const ttft = net?.last?.ttft
  const lat = typeof ttft === 'number' ? ttft : typeof usage.avg_latency_s === 'number' ? usage.avg_latency_s : null

  if (lat != null && ok('latency')) {
    const txt = `${ic('\u{f051f}') || '◷ '}${typeof ttft === 'number' ? '' : '≈'}${lat.toFixed(1)}s` // nf-md-timer_sand

    add({ bg: C.latencyBg, fg: PL_CONF.palette !== 'skin' ? dark : light, key: 'latency', node: txt, w: stringWidth(txt) })
  }

  // Context meter folds into the ctx segment when there is room.
  if (ctxSeg && !narrow && usage.context_max && pct != null && ok('context_pct')) {
    const [full, empty] = plBar(pct, 8)
    const extra = stringWidth(` ${full}${empty} ${mark}${pct}%`)

    if (fits(extra)) {
      const seg = ctxSeg
      const base = seg.node

      const meter = (on: string, off: string) => (
        <>
          {base}{' '}
          <Text color={on}>{full}</Text>
          <Text color={off}>{empty}</Text>
          <Text color={on}>{` ${mark}${pct}%`}</Text>
        </>
      )

      seg.node = meter(ctxColor, dim)
      seg.render = bg =>
        meter(
          pct >= 90 ? __plTone('err', bg) : pct >= 75 ? __plTone('warn', bg) : __plTone('accent', bg),
          __plIsLight(bg) ? '#4E4E4E' : '#8A8A8A'
        )
      seg.w += extra
    }
  }

  if (sharedW === 0 && ok('duration') && p.sessionStartedAt) {
    add({
      bg: C.durBg,
      fg: light,
      key: 'duration',
      node: (
        <>
          {ic('\uf017 ')}
          <SessionDuration startedAt={p.sessionStartedAt} />
        </>
      ),
      w: stringWidth(ic('\uf017 ')) + MAX_DURATION_WIDTH
    })
  }

  // Idle-since (✓ Xs) dropped on request: the session duration next to it is enough.

  const compressions = typeof usage.compressions === 'number' ? usage.compressions : 0

  if (compressions > 0 && ok('compressions')) {
    const txt = T.status.compressions(compressions)
    const c = compressions >= 10 ? t.color.error : compressions >= 5 ? t.color.warn : light
    const tone = compressions >= 10 ? 'err' : compressions >= 5 ? 'warn' : undefined

    add({ bg: deep, fg: c, key: 'compressions', node: txt, tone, w: stringWidth(txt) })
  }

  // Title/cwd beats the low-priority chatter below (voice, session count, …).
  growRight()

  // "voice off" is noise — only show voice when it's on / recording / transcribing.
  const voiceOff = (T as { session?: { main?: { voiceOff?: string } } }).session?.main?.voiceOff || 'voice off'

  if (p.voiceLabel && !p.voiceLabel.startsWith(voiceOff) && ok('voice')) {
    const c = p.voiceLabel.startsWith('●') ? t.color.error : p.voiceLabel.startsWith('◉') ? t.color.warn : light

    add({ bg: deep, fg: c, key: 'voice', node: p.voiceLabel, w: stringWidth(p.voiceLabel) })
  }

  if (p.liveSessionCount > 0) {
    const txt = PL_CONF.icons ? `${ic('\u{f0f58}')}${p.liveSessionCount}` : statusSessionCountLabel(p.liveSessionCount)

    add({ bg: deep, fg: PL_CONF.palette !== 'skin' ? light : t.color.accent, key: 'sessions', node: txt, onClick: p.onSessionCountClick, w: stringWidth(txt) })
  }

  if (p.bgCount > 0 && ok('bg_tasks')) {
    const txt = T.status.bgTasks(p.bgCount)

    add({ bg: deep, fg: light, key: 'bg', node: txt, w: stringWidth(txt) })
  }

  const subagents = typeof usage.active_subagents === 'number' ? usage.active_subagents : 0

  // Our task cell (pinned above) counts in-turn + background subagents when the bridge has the
  // merged roster; without it (older bridge) the stock count stays, since it sees background work.
  const ownTasks = todoOn && !!tasks?.merged

  if (subagents > 0 && ok('bg_subagents') && !ownTasks) {
    add({ bg: deep, fg: t.color.label, key: 'subagents', node: `${PL_LINK} ${subagents}`, w: stringWidth(`${PL_LINK} ${subagents}`) })
  }

  // Idle while delegated work runs: say the session resumes when it finishes — with the same count
  // the task cell shows (Hermes' own figure also counts the delegation record). The sidebar has no
  // such line, so it stays when the sidebar is open; only the user's field list can hide it.
  const fieldOn = p.statusBarFields == null || p.statusBarFields.has('bg_subagents')

  {
    const waiting = ownTasks ? tasks!.n : subagents

    if (fieldOn && !busy && waiting > 0) {
      const hint = waiting === 1 ? T.status.resumesWhenSubagentFinishes : T.status.resumesWhenSubagentsFinish(waiting)

      add({ bg: deep, fg: t.color.muted, key: 'resume', node: hint, w: stringWidth(hint) })
    }
  }

  if (typeof usage.dev_credits_spent_micros === 'number') {
    const txt = `Δ ${(usage.dev_credits_spent_micros / 10000).toFixed(1)}¢`

    add({ bg: deep, fg: t.color.accent, key: 'credits', node: txt, w: stringWidth(txt) })
  }

  growRight()

  // Display order: pinned essentials, then the tail in budget order.
  const left = [...pinned, ...tail]

  // Grey palette: walk the ramp dark → light, left to right. Accent cells (fixed: inbox, claude,
  // provider, API error) take their place on the ramp too, so the chevron chain never breaks into a
  // coloured rectangle; their colour becomes the (bold) text colour instead of the background.
  if (mono) {
    left.forEach((seg, i) => {
      if (seg.fixed) {
        const accent = seg.bg

        seg.bg = __plLeftGray(i, left.length)
        seg.fg = accent && !__plIsLight(seg.bg) ? accent : dark
        seg.bold = true

        return
      }

      seg.bg = __plLeftGray(i, left.length)
      seg.fg = seg.tone ? __plTone(seg.tone, seg.bg) : seg.muted ? (__plIsLight(seg.bg) ? '#4E4E4E' : '#B2B2B2') : __plInk(seg.bg)

      if (seg.render) {
        seg.node = seg.render(seg.bg)
      }
    })
  }

  const renderLeft = left.map((seg, i) => {
    const next = left[i + 1]
    const same = next && next.bg === seg.bg

    const body = (
      <Text backgroundColor={seg.bg} bold={seg.bold} color={seg.fg}>
        {' '}
        {seg.node}{' '}
      </Text>
    )

    // With an edge colour the separator is a 2-cell band: the segment's arrow
    // on the edge colour, then the edge's arrow on the next segment — a ">"
    // outline between the two greys.
    const arrow = edge && __PL_LOOK.thin ? (
      next ? (
        <Text backgroundColor={next.bg} color={edge}>
          {__PL_LOOK.thinOf(sep.l)}
        </Text>
      ) : (
        <Text color={seg.bg}>{sep.capR || sep.l}</Text>
      )
    ) : edge ? (
      <>
        <Text backgroundColor={edge} color={seg.bg}>
          {sep.l}
        </Text>
        <Text backgroundColor={next?.bg} color={edge}>
          {next ? sep.l : sep.capR || sep.l}
        </Text>
      </>
    ) : same ? (
      <Text backgroundColor={seg.bg} color={dark}>
        {sep.lt}
      </Text>
    ) : next ? (
      <Text backgroundColor={next.bg} color={seg.bg}>
        {sep.l}
      </Text>
    ) : (
      <Text color={seg.bg}>{sep.capR || sep.l}</Text>
    )

    return (
      <Box flexDirection="row" flexShrink={0} key={seg.key} onClick={seg.onClick}>
        {body}
        {arrow}
      </Box>
    )
  })

  return (
    <Box flexDirection="row" height={1} width={width}>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
        {sep.capL && left[0] ? <Text color={left[0].bg}>{sep.capL}</Text> : null}
        {renderLeft}
        <SpawnHud t={t} />
      </Box>
      {blockW > 0 ? (
        <Box flexDirection="row" flexShrink={0} marginLeft={1} width={blockW}>
          {rCells.map((c, i) => (
            <Text key={i}>
              {sepR(i ? rCells[i - 1]!.bg : undefined, c.bg)}
              <Text backgroundColor={c.bg} bold={c.bold} color={c.fg}>
                {c.text}
              </Text>
            </Text>
          ))}
          {durOn ? (
            <>
              {sepR(rCells[rCells.length - 1]?.bg, durBg)}
              <PlDuration bg={durBg} fg={durFg} icon={durIcon} startedAt={p.sessionStartedAt!} />
            </>
          ) : null}
        </Box>
      ) : null}
      {rightW > 0 ? (
        <Box flexDirection="row" flexShrink={0} width={rightW}>
          <Text color={rightBg}>{sep.r}</Text>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text backgroundColor={rightBg} bold={!!title} color={rightFg} wrap="truncate-start">
              {!title && cwd.branch ? (
                <>
                  {` ${ic('\uf07c ')}${cwd.path}  `}
                  <Text bold color={branchFg}>{`${ic('\ue0a0 ')}${cwd.branch} `}</Text>
                </>
              ) : (
                ` ${rightText} `
              )}
            </Text>
          </Box>
          {sep.capR ? <Text color={rightBg}>{sep.capR}</Text> : null}
        </Box>
      ) : null}
    </Box>
  )
}

// Safety net for Hermes updates: if anything in the powerline bar throws while
// rendering (a helper changed shape upstream), show the stock bar instead of
// taking the TUI down.
class PlBoundary extends __PlComponent<{ children: ReactNode; fallback: () => ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // swallowed on purpose — the fallback is the report
  }

  render() {
    return this.state.failed ? this.props.fallback() : this.props.children
  }
}

function StatusRuleStock(props: StatusRuleProps) {
  return StatusRuleClassic(props)
}

export function StatusRule(props: StatusRuleProps) {
  if (!PL_CONF.enabled) {
    return <StatusRuleStock {...props} />
  }

  return (
    <PlBoundary fallback={() => <StatusRuleStock {...props} />}>
      <PowerlineRule {...props} />
    </PlBoundary>
  )
}
