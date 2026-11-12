// hy-sidebar — an OpenCode-style live side panel for the Hermes TUI (part of hermes-powerline).
//
// Lives in $HERMES_HOME/tui-widgets/ — Hermes' official user-widget slot, which
// `hermes update` never touches. An ambient app in the right rail, opened by
// itself on wide terminals (≥ 112 cols), toggled with /hy-sidebar.
//
// Live data comes from the TUI stores the hermes-powerline build publishes on
// globalThis.__hy; skills the session (and its subagents) loaded and files it
// changed come from state.db, read-only, through node:sqlite.
//
// Safety contract (why it can never break Hermes or slow the Mac):
//   • no bridge (plain `hermes`, stock TUI, a Hermes that moved things) → the
//     panel never opens and renders nothing;
//   • every data read is try/catch'd; a renderer throw is caught by the SDK's
//     WidgetBoundary; node:sqlite missing / schema changed → those rows hide;
//   • no work while idle: store changes re-render (throttled 120 ms); a clock
//     only runs while something animates (working, a tool, a skill loading);
//     state.db is polled every 3 s while busy, 15 s idle, read-only.
// HY_SIDEBAR=0 keeps it closed at startup (it still answers /hy-sidebar).

const ID = 'hy-sidebar'
const WIDTH = 40 // rail columns (paddingX 1 each side → 38 content)
const MIN_COLS = 112 // auto-hide below this terminal width
const DB_IDLE_MS = 15_000
const DB_BUSY_MS = 3_000
const ANIM_MS = 120

const JADE = '#5FD75F'
const MINT = '#87FFAF'
const AMBER = '#FFAF5F'
const ROSE = '#FF5F5F'
const SKY = '#87AFFF'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// Nerd Font glyphs (verified in JetBrainsMono NF).
const IC = {
  ctx: '\u{f035b}',
  file: '\u{f0dc8}',
  mcp: '\u{f048d}',
  model: '\u{f06a9}',
  puzzle: '\u{f0431}',
  robot: '\u{f06a9}',
  run: '\u{f140b}',
  team: '\u{f000e}',
  todo: '\u{f0756}'
}

const bridge = () => {
  const b = globalThis.__hy

  return b && b.ui?.get && b.turn?.get && b.overlay?.get && b.patchOverlay ? b : null
}

export default function register(sdk) {
  const { Box, Text, React, defineWidgetApp, openWidget } = sdk

  if (!Box || !Text || !React || !defineWidgetApp || !openWidget) {
    return // SDK changed shape: stay out of the way.
  }

  const h = sdk.h ?? React.createElement
  const { useEffect, useRef, useState } = React

  // ── state.db reader ─────────────────────────────────────────────────
  let db = null
  let dbFailed = false

  const openDb = async () => {
    if (db || dbFailed) {
      return db
    }

    try {
      const { DatabaseSync } = await import('node:sqlite')
      const home = process.env.HERMES_HOME?.trim() || `${process.env.HOME}/.hermes`

      db = new DatabaseSync(`${home}/state.db`, { readOnly: true })
    } catch {
      dbFailed = true
    }

    return db
  }

  const readSession = async sid => {
    const conn = await openDb()

    if (!conn || !sid) {
      return null
    }

    try {
      const rows = conn
        .prepare(
          `SELECT session_id AS sid, tool_calls AS tc FROM messages
            WHERE role = 'assistant' AND tool_calls IS NOT NULL
              AND (session_id = ? OR session_id IN (SELECT id FROM sessions WHERE parent_session_id = ?))
              AND (tool_calls LIKE '%skill_view%' OR tool_calls LIKE '%write_file%' OR tool_calls LIKE '%"patch"%')
            ORDER BY id`
        )
        .all(sid, sid)

      const skills = new Map()
      const files = new Map()

      for (const { sid: rowSid, tc } of rows) {
        let calls

        try {
          calls = JSON.parse(tc)
        } catch {
          continue
        }

        for (const c of Array.isArray(calls) ? calls : []) {
          const fn = c?.function?.name
          let args = {}

          try {
            args = JSON.parse(c?.function?.arguments || '{}') ?? {}
          } catch {
            // streamed / non-JSON arguments
          }

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
              files.delete(p) // re-insert → most recent last
              files.set(p, f)
            }
          }
        }
      }

      return { files, skills }
    } catch {
      return null
    }
  }

  // ── view helpers ──────────────────────────────────────────────────────
  const W = WIDTH - 2

  const fit = (s, w) => {
    const str = String(s ?? '')

    return str.length > w ? str.slice(0, Math.max(0, w - 1)) + '…' : str
  }

  const short = n => {
    if (n == null || Number.isNaN(n)) {
      return '–'
    }

    const v = Number(n)

    if (v >= 1e6) {
      return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
    }

    if (v >= 1e3) {
      return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k'
    }

    return String(Math.round(v))
  }

  const dur = ms => {
    const s = Math.max(0, Math.round(ms / 1000))

    if (s < 60) {
      return `${s}s`
    }

    return s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
  }

  const tail = p => {
    const home = process.env.HOME
    let s = String(p)

    if (home && s.startsWith(home)) {
      s = '~' + s.slice(home.length)
    }

    const parts = s.split('/')

    return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : s
  }

  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const mixHex = (a, b, t) =>
    '#' +
    hex(a)
      .map((v, i) => Math.round(v + (hex(b)[i] - v) * t))
      .map(v => v.toString(16).padStart(2, '0'))
      .join('')

  // A light band sweeping across the text — the "working" shimmer.
  const Glow = ({ text, base, glow, now, bold }) => {
    const chars = [...String(text)]
    const span = chars.length + 8
    const head = Math.floor(now / 70) % span

    return h(
      Text,
      { bold },
      ...chars.map((ch, i) => {
        const d = Math.abs(i - head + 4)
        const t = d > 3 ? 0 : 1 - d / 4

        return h(Text, { color: t ? mixHex(base, glow, t) : base, key: i }, ch)
      })
    )
  }

  // Context gauge: eighth-blocks for a smooth edge, jade → amber → rose by fill.
  const Gauge = ({ pct, width }) => {
    const p = Math.max(0, Math.min(100, pct ?? 0))
    const cells = (p / 100) * width
    const full = Math.floor(cells)
    const frac = cells - full
    const eighths = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
    const end = p >= 85 ? ROSE : p >= 60 ? AMBER : JADE
    const out = []

    for (let i = 0; i < full; i++) {
      out.push(h(Text, { color: mixHex('#5FAF5F', end, width > 1 ? i / (width - 1) : 1), key: i }, '█'))
    }

    if (full < width) {
      const e = eighths[Math.round(frac * 7)]

      if (e) {
        out.push(h(Text, { backgroundColor: '#303030', color: end, key: 'f' }, e))
      }

      const rest = width - full - (e ? 1 : 0)

      if (rest > 0) {
        out.push(h(Text, { backgroundColor: '#303030', key: 'r' }, ' '.repeat(rest)))
      }
    }

    return h(Text, null, ...out)
  }

  const Section = ({ t, icon, title, count, children }) =>
    h(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      h(
        Text,
        { wrap: 'truncate-end' },
        h(Text, { color: JADE }, '▍'),
        h(Text, { bold: true, color: t.color.label }, ` ${icon}  ${title}`),
        count != null ? h(Text, { color: t.color.muted }, `  ${count}`) : null
      ),
      children
    )

  const Row = ({ mark, markColor, text, color, right, rightColor, dim, bold, glowNow }) => {
    const r = right ? ` ${right}` : ''
    const room = Math.max(4, W - 3 - r.length)
    const body = fit(text, room)

    return h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { color: markColor }, ` ${mark} `),
      glowNow != null
        ? h(Glow, { base: color, bold, glow: '#FFFFFF', now: glowNow, text: body })
        : h(Text, { bold, color, dimColor: dim }, body),
      h(Text, null, ' '.repeat(Math.max(0, room - body.length))),
      r ? h(Text, { color: rightColor }, r) : null
    )
  }

  // ── the panel ─────────────────────────────────────────────────────────
  function Sidebar({ t }) {
    const [, force] = useState(0)
    const [data, setData] = useState(null)
    const sidRef = useRef(null)
    const b = bridge()

    // Store-driven re-render (throttled) + a clock only while something animates.
    useEffect(() => {
      if (!b) {
        return
      }

      let pending = null
      const bump = () => {
        pending ??= setTimeout(() => {
          pending = null
          force(n => n + 1)
        }, ANIM_MS)
      }

      const offTurn = b.turn.listen(bump)
      const offUi = b.ui.listen(bump)
      const clock = setInterval(() => {
        const ui = b.ui.get()
        const turn = b.turn.get()

        if (ui.busy || (turn.tools ?? []).length || (turn.subagents ?? []).some(s => s.status === 'running')) {
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

    // state.db poll (skills + files for this session and its subagents).
    useEffect(() => {
      if (!b) {
        return
      }

      let alive = true
      let timer = null

      const run = async () => {
        const ui = b.ui.get()
        const sid = ui.storedSid || ui.info?.stored_session_id || ui.sid || null

        if (sid !== sidRef.current) {
          sidRef.current = sid
          setData(null)
        }

        const res = await readSession(sid)

        if (alive && res) {
          setData(res)
        }

        if (alive) {
          timer = setTimeout(run, ui.busy ? DB_BUSY_MS : DB_IDLE_MS)
        }
      }

      void run()

      // A finished tool (skill_view / patch / write_file) → refresh sooner.
      let toolCount = 0
      const offTurn = b.turn.listen(turn => {
        const n = (turn?.tools ?? []).length

        if (n < toolCount) {
          clearTimeout(timer)
          timer = setTimeout(run, 600)
        }

        toolCount = n
      })

      return () => {
        alive = false
        clearTimeout(timer)
        offTurn()
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

    const info = ui.info ?? {}
    const usage = { ...(info.usage ?? {}), ...(ui.usage ?? {}) }
    const now = Date.now()
    const spin = SPIN[Math.floor(now / 90) % SPIN.length]
    const nodes = []

    // ── header ──
    const profile = info.profile_name || 'default'
    const title = ui.sessionTitle || info.title || 'new session'

    nodes.push(
      h(
        Box,
        { flexDirection: 'column', key: 'head' },
        h(
          Text,
          { wrap: 'truncate-end' },
          h(Text, { backgroundColor: JADE, bold: true, color: '#1C1C1C' }, ` ${IC.robot} hermes `),
          h(Text, { backgroundColor: '#3A3A3A', color: '#E4E4E4' }, ` ${fit(profile, 12)} `),
          h(Text, { color: '#3A3A3A' }, '\u{e0b0}'),
          ui.busy
            ? h(Text, null, h(Text, { color: AMBER }, ` ${spin} `), h(Glow, { base: AMBER, bold: true, glow: '#FFFFD7', now, text: 'working' }))
            : h(Text, { color: t.color.muted }, '  idle')
        ),
        h(Text, { bold: true, color: t.color.text, wrap: 'wrap' }, fit(title, W * 2)),
        info.cwd
          ? h(
              Text,
              { color: t.color.muted, wrap: 'truncate-middle' },
              tail(info.cwd) + (info.branch ? `   ${info.branch}` : '')
            )
          : null
      )
    )

    // ── context ──
    const pct =
      usage.context_percent ?? (usage.context_used && usage.context_max ? (usage.context_used / usage.context_max) * 100 : null)
    const stats = [
      usage.calls ? `${usage.calls} calls` : '',
      usage.total ? `${short(usage.total)} tok` : '',
      usage.cache_hit_pct != null ? `cache ${Math.round(usage.cache_hit_pct)}%` : '',
      usage.cost_usd ? `$${Number(usage.cost_usd).toFixed(2)}` : ''
    ].filter(Boolean)

    nodes.push(
      h(
        Section,
        { count: pct == null ? null : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`, icon: IC.ctx, key: 'ctx', t, title: 'CONTEXT' },
        h(
          Text,
          { wrap: 'truncate-end' },
          h(Text, null, ' '),
          h(Gauge, { pct, width: W - 15 }),
          h(Text, { color: t.color.muted }, ` ${short(usage.context_used)}/${short(usage.context_max)}`)
        ),
        h(
          Text,
          { color: t.color.muted, wrap: 'truncate-end' },
          ` ${IC.model}  `,
          h(Text, { color: t.color.text }, fit(info.model || '?', 22)),
          info.reasoning_effort ? ` · ${info.reasoning_effort}` : ''
        ),
        stats.length ? h(Text, { color: t.color.muted, wrap: 'truncate-end' }, ` ${stats.join(' · ')}`) : null
      )
    )

    // ── skills: loading (live skill_view calls) then loaded ──
    const live = new Map()

    for (const tool of turn.tools ?? []) {
      if (tool?.name === 'skill_view') {
        const raw = String(tool.context || tool.verboseArgs || '')
        const name = raw.match(/["']?name["']?\s*[:=]\s*["']([^"']+)/)?.[1] ?? raw.replace(/^[\s"'{]+|[\s"'}]+$/g, '')

        live.set(name || 'skill', tool.startedAt ?? now)
      }
    }

    const skillRows = []

    for (const [name, at] of live) {
      skillRows.push(
        h(Row, { bold: true, color: '#FFD787', glowNow: now, key: `l${name}`, mark: spin, markColor: AMBER, right: dur(now - at), rightColor: AMBER, text: name })
      )
    }

    for (const [name, s] of [...(data?.skills ?? [])].reverse()) {
      if (!live.has(name)) {
        skillRows.push(
          h(Row, {
            color: t.color.text,
            key: `s${name}`,
            mark: s.sub ? '↳' : '✓',
            markColor: JADE,
            right: s.n > 1 ? `${s.n}×` : s.sub ? 'sub' : '',
            rightColor: t.color.muted,
            text: name
          })
        )
      }
    }

    if (skillRows.length) {
      nodes.push(h(Section, { count: (data?.skills?.size ?? 0) + [...live.keys()].filter(k => !data?.skills?.has(k)).length, icon: IC.puzzle, key: 'skills', t, title: 'SKILLS' }, ...skillRows.slice(0, 10)))
    }

    // ── running tools ──
    const running = (turn.tools ?? []).filter(x => x?.name && x.name !== 'skill_view')

    if (running.length) {
      nodes.push(
        h(
          Section,
          { count: running.length, icon: IC.run, key: 'run', t, title: 'RUNNING' },
          ...running.slice(0, 6).map(tool =>
            h(Row, {
              color: t.color.text,
              glowNow: now,
              key: tool.id ?? tool.name,
              mark: spin,
              markColor: SKY,
              right: tool.startedAt ? dur(now - tool.startedAt) : '',
              rightColor: t.color.muted,
              text: `${tool.name}${tool.context ? `  ${tool.context}` : ''}`
            })
          )
        )
      )
    }

    // ── subagents ──
    const subs = turn.subagents ?? []

    if (subs.length) {
      const g = s => (s === 'running' ? spin : s === 'completed' ? '✓' : s === 'failed' || s === 'error' ? '✗' : s === 'queued' ? '○' : '•')
      const c = s => (s === 'running' ? SKY : s === 'completed' ? JADE : s === 'failed' || s === 'error' ? ROSE : t.color.muted)

      nodes.push(
        h(
          Section,
          { count: subs.length, icon: IC.team, key: 'subs', t, title: 'SUBAGENTS' },
          ...subs.slice(0, 6).map(s =>
            h(Row, {
              color: t.color.text,
              glowNow: s.status === 'running' ? now : null,
              key: s.id,
              mark: g(s.status),
              markColor: c(s.status),
              right: s.model ? fit(String(s.model).replace(/^.*\//, ''), 12) : '',
              rightColor: t.color.muted,
              text: s.goal || s.id
            })
          )
        )
      )
    }

    // ── todo ──
    const todos = turn.todos ?? []

    if (todos.length) {
      const done = todos.filter(x => x.status === 'completed').length
      const mk = s => (s === 'completed' ? '✓' : s === 'in_progress' ? '▶' : s === 'cancelled' ? '✗' : '○')
      const mc = s => (s === 'completed' ? JADE : s === 'in_progress' ? AMBER : s === 'cancelled' ? ROSE : t.color.muted)

      nodes.push(
        h(
          Section,
          { count: `${done}/${todos.length}`, icon: IC.todo, key: 'todo', t, title: 'TODO' },
          ...todos.slice(0, 8).map(x =>
            h(Row, {
              bold: x.status === 'in_progress',
              color: x.status === 'completed' ? t.color.muted : t.color.text,
              dim: x.status === 'completed' || x.status === 'cancelled',
              key: x.id,
              mark: mk(x.status),
              markColor: mc(x.status),
              text: x.content
            })
          )
        )
      )
    }

    // ── files changed ──
    if (data?.files?.size) {
      nodes.push(
        h(
          Section,
          { count: data.files.size, icon: IC.file, key: 'files', t, title: 'FILES' },
          ...[...data.files]
            .reverse()
            .slice(0, 8)
            .map(([p, f]) =>
              h(Row, {
                color: t.color.text,
                key: p,
                mark: f.created && f.n === 1 ? '+' : '~',
                markColor: f.created && f.n === 1 ? JADE : AMBER,
                right: f.sub ? 'coder' : f.n > 1 ? `${f.n}×` : '',
                rightColor: t.color.muted,
                text: tail(p)
              })
            )
        )
      )
    }

    // ── MCP ──
    const mcp = Array.isArray(info.mcp_servers) ? info.mcp_servers : []

    if (mcp.length) {
      const up = m => m.connected || m.status === 'connected'
      const dot = m => (up(m) ? JADE : m.status === 'lazy' || m.status === 'configured' ? '#8A8A8A' : m.status === 'connecting' ? AMBER : ROSE)
      const half = Math.floor((W - 2) / 2)
      const rows = []

      for (let i = 0; i < mcp.length; i += 2) {
        const a = mcp[i]
        const z = mcp[i + 1]

        rows.push(
          h(
            Text,
            { key: String(a.name ?? i), wrap: 'truncate-end' },
            h(Text, { color: dot(a) }, ' ● '),
            h(Text, { color: t.color.text }, fit(a.name, half - 4).padEnd(half - 3)),
            z ? h(Text, { color: dot(z) }, '● ') : null,
            z ? h(Text, { color: t.color.text }, fit(z.name, half - 4)) : null
          )
        )
      }

      nodes.push(h(Section, { count: `${mcp.filter(up).length}/${mcp.length}`, icon: IC.mcp, key: 'mcp', t, title: 'MCP' }, ...rows))
    }

    nodes.push(h(Text, { color: '#4E4E4E', key: 'foot' }, '\n /hy-sidebar · ^X phiên · /hy-tabs'))

    return h(Box, { flexDirection: 'column', width: W }, ...nodes)
  }

  let app

  try {
    app = defineWidgetApp({
      help: 'hy sidebar — live session panel: context, skills, tools, subagents, todo, files, MCP',
      id: ID,
      init: () => ({ v: 1 }),
      mode: 'ambient',
      reduce: (state, input) => (input?.key?.escape ? null : state),
      render: ({ t }) => h(Sidebar, { t }),
      width: WIDTH,
      zone: 'top-right'
    })
  } catch {
    return
  }

  // ── auto open on wide terminals / auto hide on narrow ones ────────────
  // Only with the hy bridge: under plain `hermes` (stock TUI) nothing opens.
  const isOpen = b => (b.overlay.get().ambient ?? []).some(a => a.appId === ID)
  let userChoice = null // set once the user toggles /hy-sidebar themselves
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

  if (process.env.HY_SIDEBAR !== '0' && !globalThis.__hySidebarBooted) {
    globalThis.__hySidebarBooted = true

    let tries = 0
    const boot = () => {
      if (bridge()) {
        sync()
        process.stdout.on?.('resize', () => setTimeout(sync, 60))
      } else if (++tries < 20) {
        setTimeout(boot, 250) // the bridge lands when appChrome loads
      }
    }

    setTimeout(boot, 300)
  }
}
