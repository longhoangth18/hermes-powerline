// hy-sidebar — the live session panel of the hy TUI (part of hermes-powerline).
//
// An official Hermes user widget ($HERMES_HOME/tui-widgets/), ambient, right rail,
// auto-open on terminals ≥ 112 columns, /hy-sidebar toggles. Layout follows the
// OpenCode / Crush sidebars (design notes in docs/GUIDE.md):
//
//   title · model · context gauge (tokens · % · cost)
//   SUBAGENTS  route chips lit while active · live tasks · finished tasks
//   TODO       progress bar · items (▶ in progress, ✓ done, ○ pending)
//   RUNNING    tools in flight with timers
//   SKILLS     used this session + a wall of every skill (loading pulses, used glows)
//   MCP        every server: health dot + word · in use (spinner) · calls this session
//   FILES      written / patched files
//   …pinned:   cwd · branch
//
// Data: live TUI stores via globalThis.__hy (bridge.ts); history from state.db
// (read-only, node:sqlite): skills, delegations (task → route), subagent
// sessions, MCP calls, files. The loader publishes globalThis.__hyData so the
// tabs widget shows the same subagent/route state.
//
// Safety: no bridge → never opens, renders nothing. Every read is guarded; the
// SDK's widget error boundary catches render throws. Idle = no repaint; a clock
// runs only while something animates. HY_SIDEBAR=0 keeps it closed at start.

const ID = 'hy-sidebar'
const WIDTH = 42 // rail columns (paddingX 1 → 40 content), OpenCode's sidebar width
const MIN_COLS = 112
const DB_IDLE_MS = 15_000
const DB_BUSY_MS = 2_500
const ANIM_MS = 120
const FLASH_MS = 4_000
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// Dracula fallback (the bridge normally hands us the colour-depth-aware palette).
const FALLBACK = {
  bg: '#282A36', comment: '#6272A4', cyan: '#8BE9FD', deep: '#21222C', deeper: '#191A21', dim: '#9AA5CE',
  fg: '#F8F8F2', green: '#50FA7B', line: '#44475A', orange: '#FFB86C', pink: '#FF79C6', purple: '#BD93F9',
  raised: '#4D5066', red: '#FF5555', surface: '#343746', truecolor: true, yellow: '#F1FA8C', accent: '#50FA7B', idle: '#8A95C0'
}

const IC = {
  branch: '\u{f062c}', file: '\u{f0dc8}', folder: '\u{f0770}', mcp: '\u{f048d}', model: '\u{f06a9}',
  puzzle: '\u{f0431}', run: '\u{f140b}', team: '\u{f000e}', todo: '\u{f0756}'
}

const bridge = () => {
  const b = globalThis.__hy

  return b && b.ui?.get && b.turn?.get && b.overlay?.get && b.patchOverlay ? b : null
}

const theme = () => {
  try {
    return { ...FALLBACK, ...(globalThis.__hy?.theme ?? {}) }
  } catch {
    return FALLBACK
  }
}

const skillKey = n => String(n ?? '').split(':').pop().trim().toLowerCase()
const mcpServer = n => /^mcp__([^_].*?)__/.exec(String(n ?? ''))?.[1] ?? null

// ── shared data loader (state.db) ───────────────────────────────────────
// One poller per TUI process; both hy widgets read globalThis.__hyData.
const loader = (globalThis.__hyLoader ??= { db: null, failed: false, started: false, timer: null })

async function openDb() {
  if (loader.db || loader.failed) {
    return loader.db
  }

  try {
    const { DatabaseSync } = await import('node:sqlite')
    const home = process.env.HERMES_HOME?.trim() || `${process.env.HOME}/.hermes`

    loader.db = new DatabaseSync(`${home}/state.db`, { readOnly: true })
  } catch {
    loader.failed = true
  }

  return loader.db
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') {
    return raw
  }

  try {
    return JSON.parse(raw || '{}') ?? {}
  } catch {
    return {}
  }
}

async function readSession(sid) {
  const db = await openDb()

  if (!db || !sid) {
    return null
  }

  try {
    const msgs = db
      .prepare(
        `SELECT session_id AS sid, tool_calls AS tc, timestamp AS ts FROM messages
          WHERE role = 'assistant' AND tool_calls IS NOT NULL
            AND (session_id = ? OR session_id IN (SELECT id FROM sessions WHERE parent_session_id = ?))
          ORDER BY id`
      )
      .all(sid, sid)

    const skills = new Map()
    const files = new Map()
    const mcp = new Map() // server → { n, last, at }
    const delegations = [] // { goal, profile }

    const onCall = (fn, args, rowSid, ts) => {
      if (fn === 'skill_view' && typeof args.name === 'string') {
        const s = skills.get(args.name) ?? { n: 0, sub: false }

        s.n++
        s.sub ||= rowSid !== sid
        skills.set(args.name, s)
      } else if (fn === 'write_file' || fn === 'patch') {
        const p = args.path || args.file_path || args.filename

        if (typeof p === 'string' && p) {
          const f = files.get(p) ?? { created: fn === 'write_file', n: 0, sub: false }

          f.n++
          f.sub ||= rowSid !== sid
          files.delete(p)
          files.set(p, f)
        }
      } else if (fn === 'delegate_task') {
        for (const t of Array.isArray(args.tasks) ? args.tasks : [args]) {
          if (t && typeof t.goal === 'string') {
            delegations.push({ goal: t.goal, profile: typeof t.profile === 'string' && t.profile ? t.profile : 'default' })
          }
        }
      }

      const server = mcpServer(fn)

      if (server) {
        const m = mcp.get(server) ?? { at: 0, last: '', n: 0 }

        m.n++
        m.last = String(fn).split('__').slice(2).join('__')
        m.at = Math.max(m.at, Number(ts) || 0)
        mcp.set(server, m)
      }
    }

    for (const { sid: rowSid, tc, ts } of msgs) {
      let calls

      try {
        calls = JSON.parse(tc)
      } catch {
        continue
      }

      for (const c of Array.isArray(calls) ? calls : []) {
        const fn = c?.function?.name
        const args = parseArgs(c?.function?.arguments)

        onCall(fn, args, rowSid, ts)

        // Deferred tools run through tool_call: { name, arguments } or { calls: [...] }.
        if (fn === 'tool_call') {
          for (const ic of Array.isArray(args.calls) ? args.calls : [args]) {
            if (ic && typeof ic.name === 'string') {
              onCall(ic.name, parseArgs(ic.arguments), rowSid, ts)
            }
          }
        }
      }
    }

    // Subagent sessions of this session (finished or running), routed by goal.
    const kids = db
      .prepare(
        `SELECT id, model, end_reason AS endReason, started_at AS st, ended_at AS en, tool_call_count AS tools, title
           FROM sessions WHERE parent_session_id = ? ORDER BY started_at`
      )
      .all(sid)
      .map(k => {
        const goal = String(k.title ?? '').replace(/^Subagent:\s*/, '').replace(/…$/, '')
        const d = delegations.find(x => x.goal.startsWith(goal.slice(0, 40)) || goal.startsWith(x.goal.slice(0, 40)))

        return { ...k, goal, profile: d?.profile ?? 'default' }
      })

    return { delegations, files, kids, mcp, skills }
  } catch {
    return null
  }
}

function routesList() {
  try {
    const fs = process.getBuiltinModule?.('node:fs')
    const home = process.env.HERMES_HOME?.trim() || `${process.env.HOME}/.hermes`
    const dir = /\/profiles\/[^/]+\/?$/.test(home) ? home.replace(/\/profiles\/[^/]+\/?$/, '/profiles') : `${home}/profiles`

    return fs ? fs.readdirSync(dir).filter(n => !n.startsWith('.')).sort() : []
  } catch {
    return []
  }
}

function startLoader() {
  if (loader.started) {
    return
  }

  loader.started = true
  globalThis.__hyData ??= { data: null, routes: routesList(), sid: null }

  const run = async () => {
    const ui = bridge()?.ui.get()
    const sid = ui?.storedSid || ui?.info?.stored_session_id || ui?.sid || null

    if (sid !== globalThis.__hyData.sid) {
      globalThis.__hyData = { data: null, routes: globalThis.__hyData.routes, sid }
    }

    const res = await readSession(sid)

    if (res) {
      globalThis.__hyData = { ...globalThis.__hyData, data: res }
    }

    loader.timer = setTimeout(run, ui?.busy ? DB_BUSY_MS : DB_IDLE_MS)
    loader.timer.unref?.()
  }

  void run()

  // A tool or subagent finishing → refresh soon (skills, delegations, MCP calls, files).
  let n = -1
  const watch = () => {
    const b = bridge()

    if (!b) {
      return void setTimeout(watch, 500)
    }

    // Turn ended (busy → idle): children and tool results just landed in state.db.
    let wasBusy = false

    b.ui.listen(ui => {
      if (wasBusy && !ui?.busy) {
        clearTimeout(loader.timer)
        loader.timer = setTimeout(run, 800)
        loader.timer.unref?.()
      }

      wasBusy = Boolean(ui?.busy)
    })

    b.turn.listen(turn => {
      const k = (turn?.tools ?? []).length * 1000 + (turn?.subagents ?? []).filter(s => s.status === 'running').length

      if (k !== n) {
        clearTimeout(loader.timer)
        loader.timer = setTimeout(run, 500)
        loader.timer.unref?.()
      }

      n = k
    })
  }

  watch()
}

// Live subagent → route: match its goal against the delegate_task calls.
function routeOf(goal, data) {
  const g = String(goal ?? '')
  const list = data?.delegations ?? []

  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i]

    if (x.goal === g || x.goal.startsWith(g.slice(0, 40)) || g.startsWith(x.goal.slice(0, 40))) {
      return x.profile
    }
  }

  return null
}

// Route states for chips (both widgets): active > failed > done > idle.
function routeStates() {
  const hd = globalThis.__hyData ?? {}
  const state = new Map((hd.routes ?? []).map(r => [r, 'idle']))

  for (const k of hd.data?.kids ?? []) {
    if (state.has(k.profile)) {
      // No ended_at yet → running; a child silent for 30 min (crashed owner) counts as done.
      state.set(k.profile, !k.en && Date.now() / 1000 - (k.st ?? 0) < 1800 ? 'active' : 'done')
    }
  }

  for (const s of bridge()?.turn.get()?.subagents ?? []) {
    const r = routeOf(s.goal, hd.data)

    if (r && state.has(r)) {
      if (s.status === 'running' || s.status === 'queued') {
        state.set(r, 'active')
      } else if (state.get(r) !== 'active') {
        state.set(r, s.status === 'failed' || s.status === 'error' ? 'failed' : 'done')
      }
    }
  }

  return state
}

globalThis.__hyRouteStates = routeStates
globalThis.__hyRouteOf = routeOf

// Section folding: key → collapsed? Only a header click folds a section; nothing folds by itself.
const collapsed = new Map()

// Hermes archives the todo list into the transcript when a turn ends; keep the
// last one per session so the sidebar still shows how far the plan got.
const lastTodos = new Map()

// "Just used" flash bookkeeping for skills.
const litAt = new Map()
let litSid = null
let litPrimed = false
let flashUntil = 0

export default function register(sdk) {
  const { Box, Text, React, defineWidgetApp, openWidget } = sdk

  if (!Box || !Text || !React || !defineWidgetApp || !openWidget) {
    return
  }

  const h = sdk.h ?? React.createElement
  const { useEffect, useState } = React
  const W = WIDTH - 2

  // ── helpers ────────────────────────────────────────────────────────────
  const fit = (s, w) => {
    const str = String(s ?? '')

    return str.length > w ? str.slice(0, Math.max(0, w - 1)) + '…' : str
  }

  const short = n => {
    const v = Number(n)

    if (n == null || Number.isNaN(v)) {
      return '–'
    }

    if (v >= 1e6) {
      return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
    }

    return v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(v))
  }

  const dur = ms => {
    const s = Math.max(0, Math.round(ms / 1000))

    if (s < 60) {
      return `${s}s`
    }

    return s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
  }

  const ago = sec => (sec ? dur(Date.now() - sec * 1000) : '')

  const tilde = p => {
    const home = process.env.HOME

    return home && String(p).startsWith(home) ? '~' + String(p).slice(home.length) : String(p)
  }

  const tail = (p, w) => {
    const s = tilde(p)

    if (s.length <= w) {
      return s
    }

    const parts = s.split('/')
    let out = parts.pop() ?? s

    while (parts.length && `…/${parts[parts.length - 1]}/${out}`.length <= w) {
      out = `${parts.pop()}/${out}`
    }

    return fit(`…/${out}`, w)
  }

  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const mixHex = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')

  // A band of light sweeping across text (working labels, live rows).
  const Glow = ({ text, base, glow, now, bold }) => {
    const chars = [...String(text)]
    const head = Math.floor(now / 70) % (chars.length + 8)

    return h(
      Text,
      { bold },
      ...chars.map((ch, i) => {
        const d = Math.abs(i - head + 4)

        return h(Text, { color: d > 3 ? base : mixHex(base, glow, 1 - d / 4), key: i }, ch)
      })
    )
  }

  // Eighth-block bar with a gradient across the filled part.
  const Bar = ({ pct, width, c0, c1, track }) => {
    const p = Math.max(0, Math.min(100, pct ?? 0))
    const cells = (p / 100) * width
    const full = Math.floor(cells)
    const e = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][Math.round((cells - full) * 7)]
    const out = []

    for (let i = 0; i < full; i++) {
      out.push(h(Text, { backgroundColor: track, color: mixHex(c0, c1, width > 1 ? i / (width - 1) : 1), key: i }, '█'))
    }

    if (full < width) {
      if (e) {
        out.push(h(Text, { backgroundColor: track, color: c1, key: 'e' }, e))
      }

      const rest = width - full - (e ? 1 : 0)

      if (rest > 0) {
        out.push(h(Text, { backgroundColor: track, key: 'r' }, ' '.repeat(rest)))
      }
    }

    return h(Text, null, ...out)
  }

  // Section header — Crush style: " ICON TITLE ──────────── right".
  const Head = ({ c, icon, title, right, rightColor, open, onToggle }) => {
    const chev = open == null ? '' : open ? '▾' : '▸'
    const label = `${chev || ' '} ${icon} ${title} `
    const r = right ? ` ${right}` : ''
    const fill = Math.max(2, W - label.length - r.length)
    const line = h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { color: open ? c.accent : c.dim }, `${chev || ' '} `),
      h(Text, { bold: true, color: open === false ? c.dim : c.accent }, `${icon} ${title} `),
      h(Text, { color: c.line }, '─'.repeat(fill)),
      r ? h(Text, { bold: true, color: rightColor ?? c.dim }, r) : null
    )

    return onToggle ? h(Box, { onClick: onToggle }, line) : line
  }

  const Row = ({ c, mark, markColor, text, color, right, rightColor, dim, bold, glowNow, strike }) => {
    const r = right ? ` ${right}` : ''
    const room = Math.max(4, W - 3 - r.length)
    const body = fit(text, room)

    return h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { color: markColor }, ` ${mark} `),
      glowNow != null
        ? h(Glow, { base: color, bold, glow: '#FFFFFF', now: glowNow, text: body })
        : h(Text, { bold, color, dimColor: dim, strikethrough: strike }, body),
      h(Text, null, ' '.repeat(Math.max(0, room - body.length))),
      r ? h(Text, { color: rightColor ?? c.dim }, r) : null
    )
  }

  const Chips = ({ items }) =>
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, null, ' '),
      ...items.flatMap((it, i) => [
        h(Text, { backgroundColor: it.bg, bold: it.bold, color: it.fg, key: `c${i}` }, ` ${it.text} `),
        h(Text, { key: `s${i}` }, ' ')
      ])
    )

  // Wrap chip items into rows of at most W cells.
  const chipRows = (items, keyp, maxRows = 99) => {
    const out = []
    let line = []
    let w = 1

    for (const it of items) {
      const cw = it.text.length + 3

      if (w + cw > W && line.length) {
        out.push(line)
        line = []
        w = 1

        if (out.length >= maxRows) {
          break
        }
      }

      line.push(it)
      w += cw
    }

    if (line.length && out.length < maxRows) {
      out.push(line)
    }

    return out.map((ln, i) => h(Chips, { items: ln, key: `${keyp}${i}` }))
  }

  // ── panel ──────────────────────────────────────────────────────────────
  function Sidebar() {
    const [, force] = useState(0)
    const b = bridge()

    useEffect(() => {
      if (!b) {
        return
      }

      startLoader()

      let pending = null
      const bump = () => {
        pending ??= setTimeout(() => {
          pending = null
          force(n => n + 1)
        }, ANIM_MS)
      }

      const offTurn = b.turn.listen(bump)
      const offUi = b.ui.listen(bump)
      let lastData = null
      const clock = setInterval(() => {
        const ui = b.ui.get()
        const turn = b.turn.get()
        const anim =
          ui.busy || Date.now() < flashUntil || (turn.tools ?? []).length || (turn.subagents ?? []).some(s => s.status === 'running')

        if (anim || globalThis.__hyData?.data !== lastData) {
          lastData = globalThis.__hyData?.data
          force(n => n + 1)
        }
      }, ANIM_MS)

      return () => {
        offTurn()
        offUi()
        clearInterval(clock)
        clearTimeout(pending)
      }
    }, [b])

    if (!b) {
      return null
    }

    let ui
    let turn

    try {
      ui = b.ui.get()
      turn = b.turn.get()
    } catch {
      return null
    }

    const c = theme()
    const info = ui.info ?? {}
    const usage = { ...(info.usage ?? {}), ...(ui.usage ?? {}) }
    const hd = globalThis.__hyData ?? {}
    const data = hd.data
    const now = Date.now()
    const spin = SPIN[Math.floor(now / 90) % SPIN.length]
    // Rail height = terminal rows minus the bottom chrome (2 powerline rows, the
    // prompt row(s), the tabs dock) and a safety line — overflowing the rail makes
    // Ink paint sections over each other, so the budget errs on the short side.
    const rows = Math.max(16, (process.stdout.rows || 40) - 9)
    const nodes = []
    let used = 0
    const push = (node, lines) => {
      nodes.push(node)
      used += lines
    }

    const isOpen = (key, autoCollapsed = false) => !(collapsed.has(key) ? collapsed.get(key) : autoCollapsed)

    // A section: header (click to fold/unfold) + rows. Folded → the header alone, its
    // right-hand summary still says what is inside.
    const section = (key, head, body, autoCollapsed = false) => {
      if (!body.length) {
        return
      }

      const open = isOpen(key, autoCollapsed)
      const hd = React.cloneElement(head, {
        onToggle: () => {
          collapsed.set(key, open)
          force(n => n + 1)
        },
        open
      })

      push(h(Box, { flexDirection: 'column', key, marginTop: 1 }, hd, ...(open ? body : [])), open ? body.length + 2 : 2)
    }

    // ── title block ──
    const title = ui.sessionTitle || info.title || 'new session'
    const pct = usage.context_percent ?? (usage.context_used && usage.context_max ? (usage.context_used / usage.context_max) * 100 : null)
    const end = pct >= 85 ? c.red : pct >= 60 ? c.orange : c.cyan
    const status = ui.busy
      ? h(Text, null, h(Text, { color: c.orange }, `${spin} `), h(Glow, { base: c.orange, bold: true, glow: c.yellow, now, text: 'working' }))
      : h(Text, { color: c.green }, '● idle')
    const stats = [
      usage.calls ? `${usage.calls} calls` : '',
      usage.total ? `${short(usage.total)} tok` : '',
      usage.cache_hit_pct != null ? `cache ${Math.round(usage.cache_hit_pct)}%` : '',
      usage.cost_usd ? `$${Number(usage.cost_usd).toFixed(2)}` : ''
    ].filter(Boolean)

    push(
      h(
        Box,
        { flexDirection: 'column', key: 'title' },
        h(
          Text,
          { wrap: 'truncate-end' },
          h(Text, { backgroundColor: c.accent, bold: true, color: c.deeper }, ' ☤ hermes '),
          h(Text, { backgroundColor: c.line, color: c.fg }, ` ${fit(info.profile_name || 'default', 12)} `),
          h(Text, { color: c.line }, '\u{e0b0} '),
          status
        ),
        h(Text, { bold: true, color: c.fg, wrap: 'wrap' }, fit(title, W * 2)),
        h(
          Text,
          { color: c.dim, wrap: 'truncate-end' },
          `${IC.model} `,
          h(Text, { color: c.cyan }, fit(info.model || '?', 24)),
          info.reasoning_effort ? ` · ${info.reasoning_effort}` : ''
        ),
        // Before the first API call there is no context figure: say so instead of an empty gauge.
        pct == null
          ? h(Text, { color: c.idle ?? c.dim, wrap: 'truncate-end' }, '○ fresh session · no calls yet')
          : h(
              Text,
              { wrap: 'truncate-end' },
              h(Bar, { c0: c.accent, c1: end, pct, track: c.surface, width: W - 17 }),
              h(Text, { bold: true, color: end }, ` ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`),
              h(Text, { color: c.dim }, ` ${short(usage.context_used)}/${short(usage.context_max)}`)
            ),
        stats.length ? h(Text, { color: c.comment, wrap: 'truncate-end' }, stats.join(' · ')) : null
      ),
      4 + Math.min(2, Math.ceil(Math.min(title.length, W * 2) / W)) + (stats.length ? 1 : 0)
    )

    // ── TODO ── (live list, else the last one this session had, dimmed)
    const liveTodos = turn.todos ?? []

    if (liveTodos.length && hd.sid) {
      lastTodos.set(hd.sid, liveTodos)
    }

    const todos = liveTodos.length ? liveTodos : (lastTodos.get(hd.sid) ?? [])
    const todoStale = !liveTodos.length

    if (todos.length) {
      const done = todos.filter(x => x.status === 'completed').length
      const body = [
        h(
          Text,
          { key: 'tb', wrap: 'truncate-end' },
          h(Text, null, ' '),
          h(Bar, { c0: c.cyan, c1: c.accent, pct: (done / todos.length) * 100, track: c.surface, width: W - 9 }),
          h(Text, { bold: true, color: done === todos.length ? c.green : c.orange }, ` ${Math.round((done / todos.length) * 100)}%`)
        )
      ]
      // keep the in-progress item in view
      const at = Math.max(0, todos.findIndex(x => x.status === 'in_progress'))
      const from = Math.max(0, Math.min(at - 3, todos.length - 8))
      const shown = todos.slice(from, from + 8)

      for (const x of shown) {
        const st = x.status

        body.push(
          h(Row, {
            bold: st === 'in_progress',
            c,
            color: st === 'completed' ? c.dim : st === 'cancelled' ? c.comment : c.fg,
            glowNow: st === 'in_progress' && ui.busy ? now : null,
            key: `t${x.id}`,
            mark: st === 'completed' ? '✓' : st === 'in_progress' ? '▶' : st === 'cancelled' ? '×' : '○',
            markColor: st === 'completed' ? c.green : st === 'in_progress' ? c.orange : st === 'cancelled' ? c.comment : c.dim,
            strike: st === 'cancelled',
            text: x.content
          })
        )

        // Task flow: work delegated while this step runs hangs under it.
        if (st === 'in_progress') {
          for (const sa of (turn.subagents ?? []).filter(q => q.status === 'running' || q.status === 'queued').slice(0, 3)) {
            const startMs = sa.startedAt ? (sa.startedAt < 1e12 ? sa.startedAt * 1000 : sa.startedAt) : 0

            body.push(
              h(
                Text,
                { key: `tf${sa.id}`, wrap: 'truncate-end' },
                h(Text, { color: c.comment }, '   ↳ '),
                h(Text, { color: c.orange }, `${spin} `),
                h(Text, { bold: true, color: c.pink }, `${routeOf(sa.goal, data) ?? 'task'} `),
                h(Text, { color: c.dim }, fit(sa.goal, Math.max(6, W - 22))),
                h(Text, { color: c.comment }, startMs ? `  ${dur(now - startMs)}` : '')
              )
            )
          }
        }
      }

      if (todos.length > shown.length) {
        body.push(h(Text, { color: c.comment, key: 'tm' }, ` …and ${todos.length - shown.length} more`))
      }

      section(
        'todo',
        h(Head, {
          c,
          icon: IC.todo,
          right: `${todoStale ? 'last turn · ' : ''}${done}/${todos.length}`,
          rightColor: done === todos.length ? c.green : todoStale ? c.dim : c.orange,
          title: 'TODO'
        }),
        body
      )
    }

    // ── SUBAGENTS: route chips + live tasks + finished tasks ──
    const states = routeStates()
    const subs = turn.subagents ?? []
    const kids = data?.kids ?? []

    if (states.size || subs.length || kids.length) {
      const chip = (r, st) =>
        st === 'active'
          ? { bg: Math.floor(now / 300) % 2 ? c.orange : c.yellow, bold: true, fg: c.deeper, text: `${spin} ${r}` }
          : st === 'done'
            ? { bg: c.line, bold: true, fg: c.green, text: `✓ ${r}` }
            : st === 'failed'
              ? { bg: c.line, bold: true, fg: c.red, text: `× ${r}` }
              : { bg: c.surface, fg: c.idle, text: `· ${r}` }
      const body = chipRows([...states].map(([r, st]) => chip(r, st)), 'rc')
      const live = subs.slice(-5)

      for (const s of live) {
        const r = routeOf(s.goal, data) ?? 'task'
        const running = s.status === 'running' || s.status === 'queued'
        const bad = s.status === 'failed' || s.status === 'error' || s.status === 'interrupted'
        const startMs = s.startedAt ? (s.startedAt < 1e12 ? s.startedAt * 1000 : s.startedAt) : 0
        const right = running
          ? `${s.toolCount ? `${s.toolCount}⚒ ` : ''}${startMs ? dur(now - startMs) : ''}`.trim()
          : s.durationSeconds
            ? dur(s.durationSeconds * 1000)
            : ''

        body.push(
          h(Row, {
            bold: running,
            c,
            color: running ? c.fg : c.dim,
            glowNow: running ? now : null,
            key: `ls${s.id}`,
            mark: running ? spin : s.status === 'completed' ? '✓' : bad ? '×' : '○',
            markColor: running ? c.orange : s.status === 'completed' ? c.green : bad ? c.red : c.dim,
            right,
            rightColor: running ? c.orange : c.comment,
            text: `${r} › ${s.goal}`
          })
        )
      }

      // Finished = the child session has ended and isn't one of the live rows above.
      const liveKey = g => String(g ?? '').slice(0, 24).toLowerCase()
      const liveGoals = new Set(live.map(q => liveKey(q.goal)))
      const finished = kids.filter(k => k.en && !liveGoals.has(liveKey(k.goal))).slice(-3)

      for (const k of finished) {
        const bad = k.endReason && !/close|complete|done|stop|finish/i.test(k.endReason)

        body.push(
          h(Row, {
            c,
            color: c.dim,
            key: `k${k.id}`,
            mark: bad ? '×' : '✓',
            markColor: bad ? c.red : c.green,
            right: k.en && k.st ? dur((k.en - k.st) * 1000) : '',
            rightColor: c.comment,
            text: `${k.profile} › ${k.goal}`
          })
        )
      }

      const activeN = [...states.values()].filter(x => x === 'active').length + subs.filter(s => s.status === 'running' && !routeOf(s.goal, data)).length

      section(
        'subs',
        h(Head, { c, icon: IC.team, right: activeN ? `${activeN} running` : kids.length ? `${kids.length} done` : 'unused', rightColor: activeN ? c.orange : c.dim, title: 'SUBAGENTS' }),
        body
      )
    }

    // ── RUNNING tools ──
    const running = (turn.tools ?? []).filter(x => x?.name && x.name !== 'skill_view')

    if (running.length) {
      section(
        'run',
        h(Head, { c, icon: IC.run, right: `${running.length}`, rightColor: c.cyan, title: 'RUNNING' }),
        running.slice(0, 4).map(tool => {
          const server = mcpServer(tool.name) ?? mcpServer(tool.context)

          return h(Row, {
            c,
            color: c.fg,
            glowNow: now,
            key: tool.id ?? tool.name,
            mark: spin,
            markColor: server ? c.pink : c.cyan,
            right: tool.startedAt ? dur(now - tool.startedAt) : '',
            text: server ? `${server} › ${String(tool.name).split('__').pop()}` : `${tool.name}${tool.context ? `  ${tool.context}` : ''}`
          })
        })
      )
    }

    // ── MCP rows (built first: their height is reserved before the skill wall) ──
    const servers = Array.isArray(info.mcp_servers) ? info.mcp_servers : []
    const mcpUse = data?.mcp ?? new Map()
    const mcpLive = new Set((turn.tools ?? []).map(x => mcpServer(x?.name) ?? mcpServer(x?.context)).filter(Boolean))
    const mcpRows = servers.map(m => {
      const name = String(m.name ?? '?')
      const up = m.connected || m.status === 'connected'
      const lazy = m.status === 'lazy' || m.status === 'configured'
      const inUse = mcpLive.has(name)
      const u = mcpUse.get(name)
      const word = inUse ? 'calling' : up ? 'online' : lazy ? 'standby' : m.status === 'connecting' ? 'connecting' : m.status === 'disabled' ? 'off' : 'error'
      const dot = inUse ? c.orange : up ? c.green : lazy ? c.dim : m.status === 'connecting' ? c.yellow : m.status === 'disabled' ? c.comment : c.red

      return h(Row, {
        bold: inUse,
        c,
        color: up || lazy || inUse ? c.fg : c.dim,
        glowNow: inUse ? now : null,
        key: `m${name}`,
        mark: inUse ? spin : '●',
        markColor: dot,
        right: u ? `${word} · ${u.n}× ${ago(u.at)}` : word,
        rightColor: inUse ? c.orange : u ? c.cyan : dot === c.red ? c.red : c.comment,
        text: name
      })
    })

    // ── SKILLS: used list + wall ──
    const live = new Map()

    for (const tool of turn.tools ?? []) {
      if (tool?.name === 'skill_view') {
        const raw = String(tool.context || tool.verboseArgs || '')
        const name = raw.match(/["']?name["']?\s*[:=]\s*["']([^"']+)/)?.[1] ?? raw.replace(/^[\s"'{]+|[\s"'}]+$/g, '')

        live.set(name || 'skill', tool.startedAt ?? now)
      }
    }

    if (hd.sid !== litSid) {
      litSid = hd.sid
      litAt.clear()
      litPrimed = false
    }

    const usedKeys = new Set([...(data?.skills?.keys() ?? [])].map(skillKey))
    const liveKeys = new Set([...live.keys()].map(skillKey))

    if (data) {
      for (const k of usedKeys) {
        if (!litAt.has(k)) {
          litAt.set(k, litPrimed ? now : 0)

          if (litPrimed) {
            flashUntil = Math.max(flashUntil, now + FLASH_MS)
          }
        }
      }

      litPrimed = true
    }

    const skillBody = []

    const catalog = []
    const seen = new Set()

    for (const names of Object.values(info.skills ?? {})) {
      for (const n of Array.isArray(names) ? names : []) {
        const k = skillKey(n)

        if (k && !seen.has(k)) {
          seen.add(k)
          catalog.push(String(n))
        }
      }
    }

    // Skills used/loading that the catalog doesn't list still get a tile.
    for (const n of [...live.keys(), ...(data?.skills?.keys() ?? [])]) {
      const k = skillKey(n)

      if (k && !seen.has(k)) {
        seen.add(k)
        catalog.push(String(n).split(':').pop())
      }
    }

    // Compact: at most 2 rows of tiles. Loading skills first (pulsing), then the
    // ones used this session (most recent first, lit), then the rest dimmed.
    // Nothing folds by itself — sections stay open until the user clicks a header.
    const mcpOpen = isOpen('mcp')
    const filesN = Math.min(6, data?.files?.size ?? 0)
    const reserve = (mcpRows.length ? (mcpOpen ? mcpRows.length + 2 : 2) : 0) + (filesN ? filesN + 2 : 0) + 3 // + footer
    const room = Math.max(0, Math.min(2, rows - used - 3 - reserve))
    const recent = [...(data?.skills?.keys() ?? [])].map(skillKey).reverse()
    const rank = name => {
      const k = skillKey(name)

      return liveKeys.has(k) ? 0 : usedKeys.has(k) ? 1 + recent.indexOf(k) / 1000 : 2
    }
    const pulse = Math.floor(now / 260) % 2
    const tiles = [...catalog].sort((a, b) => rank(a) - rank(b)).map(name => {
      const k = skillKey(name)
      const label = fit(name.split(':').pop(), W - 6)
      const age = now - (litAt.get(k) ?? 0)

      if (liveKeys.has(k)) {
        return { bg: pulse ? c.orange : c.yellow, bold: true, fg: c.deeper, text: `${spin} ${label}` }
      }

      if (usedKeys.has(k) && (litAt.get(k) ?? 0) > 0 && age < FLASH_MS) {
        const f = age / FLASH_MS

        return f < 0.4
          ? { bg: c.green, bold: true, fg: c.deeper, text: label }
          : f < 0.75
            ? { bg: mixHex(c.green, c.line, 0.6), bold: true, fg: c.deeper, text: label }
            : { bg: c.line, bold: true, fg: c.green, text: label }
      }

      return usedKeys.has(k) ? { bg: c.line, bold: true, fg: c.green, text: `✓ ${label}` } : { bg: c.surface, fg: c.idle, text: label }
    })
    const wall = room > 0 ? chipRows(tiles, 'w', room) : []
    const wallShown = wall.reduce((n, el) => n + (el.props?.items?.length ?? 0), 0)

    skillBody.push(...wall)

    if (catalog.length > wallShown) {
      skillBody.push(h(Text, { color: c.comment, key: 'wm' }, ` +${catalog.length - wallShown} skill · /skills`))
    }

    const usedN = usedKeys.size + [...liveKeys].filter(k => !usedKeys.has(k)).length

    section(
      'skills',
      h(Head, { c, icon: IC.puzzle, right: `${usedN} used · ${catalog.length || '–'}`, rightColor: liveKeys.size ? c.orange : usedN ? c.green : c.dim, title: 'SKILLS' }),
      skillBody
    )

    // ── MCP ──
    const upN = servers.filter(m => m.connected || m.status === 'connected').length
    const callsN = [...mcpUse.values()].reduce((n, u) => n + u.n, 0)

    section(
      'mcp',
      h(Head, {
        c,
        icon: IC.mcp,
        right: mcpLive.size ? `${mcpLive.size} calling` : `${upN}/${servers.length}${callsN ? ` · ${callsN} calls` : ''}`,
        rightColor: mcpLive.size ? c.orange : upN === servers.length ? c.green : c.yellow,
        title: 'MCP'
      }),
      mcpRows
    )

    // ── FILES ──
    if (filesN) {
      section(
        'files',
        h(Head, { c, icon: IC.file, right: `${data.files.size}`, title: 'FILES' }),
        [...data.files]
          .reverse()
          .slice(0, filesN)
          .map(([p, f]) =>
            h(Row, {
              c,
              color: c.fg,
              key: p,
              mark: f.created && f.n === 1 ? '+' : '~',
              markColor: f.created && f.n === 1 ? c.green : c.orange,
              right: f.sub ? 'subagent' : f.n > 1 ? `${f.n}×` : '',
              rightColor: c.comment,
              text: tail(p, W - 14)
            })
          )
      )
    }

    // ── pinned footer: cwd · branch ──
    nodes.push(
      h(
        Box,
        { flexDirection: 'column', key: 'foot', marginTop: 1 },
        info.cwd
          ? h(
              Text,
              { color: c.dim, wrap: 'truncate-end' },
              `${IC.folder} ${tail(info.cwd, W - (info.branch ? 18 : 4))}`,
              info.branch ? h(Text, { color: c.accent }, `  ${IC.branch} ${fit(info.branch, 12)}`) : null
            )
          : null,
        h(Text, { color: c.comment }, '/hy-sidebar · ^X sessions · /hy-tabs')
      )
    )

    return h(Box, { flexDirection: 'column', width: W }, ...nodes)
  }

  let app

  try {
    app = defineWidgetApp({
      help: 'hy sidebar — live session panel: context, subagents, todo, tools, skills, MCP, files',
      id: ID,
      init: () => ({ v: 1 }),
      mode: 'ambient',
      reduce: (state, input) => (input?.key?.escape ? null : state),
      render: () => h(Sidebar),
      width: WIDTH,
      zone: 'top-right'
    })
  } catch {
    return
  }

  // ── auto open on wide terminals / auto hide on narrow ones ──
  const isOpen = b => (b.overlay.get().ambient ?? []).some(a => a.appId === ID)
  let userChoice = null
  let last = null

  const sync = () => {
    const b = bridge()

    if (!b) {
      return
    }

    try {
      const open = isOpen(b)

      if (last !== null && open !== last) {
        userChoice = open
      }

      const wide = (process.stdout.columns || 80) >= MIN_COLS
      const want = userChoice ?? wide

      if (want && wide && !open) {
        openWidget(app, { v: 1 })
      } else if (open && !wide && userChoice === null) {
        b.patchOverlay({ ambient: b.overlay.get().ambient.filter(a => a.appId !== ID) })
      }

      last = isOpen(b)
    } catch {
      // never let a layout hiccup escape into the TUI
    }
  }

  if (!globalThis.__hySidebarBooted) {
    globalThis.__hySidebarBooted = true

    let tries = 0
    const boot = () => {
      if (bridge()) {
        startLoader() // tabs use the data even with the sidebar closed

        if (process.env.HY_SIDEBAR !== '0') {
          sync()
          process.stdout.on?.('resize', () => setTimeout(sync, 60))
        }
      } else if (++tries < 20) {
        setTimeout(boot, 250)
      }
    }

    setTimeout(boot, 300)
  }
}
