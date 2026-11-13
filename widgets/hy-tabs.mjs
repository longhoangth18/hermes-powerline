// hy-tabs — session tabs + subagent route strip for the hy TUI (part of hermes-powerline).
//
// Bottom dock row:
//   ◫ ( ⠼ 1 refactor rate limiter × ) ( ✓ 2 pentest notes × ) [+]        ⑂ ·coder ⠼reviewer ✓researcher
//
//   • every live Hermes session (the ^X switcher roster) is a pill; the current
//     one is jade green, working ones spin and glow, ? = waiting for you;
//   • click a pill to switch, its × to close it, [+] for a new session
//     (closing works for sessions this window owns — for others Hermes refuses
//     and the × flashes a red ⊘ for 3 s);
//   • right side: one chip per subagent route (~/.hermes/profiles/*): pulsing
//     while a delegated task runs on it, ✓ once it has run this session,
//     dim when unused — data shared with hy-sidebar (globalThis.__hyData).
//
// Data: globalThis.__hySessions / __hyActivateSession / __hyCloseSession /
// __hyNewSession (published by the hermes-powerline build), __hyRouteStates (sidebar).
// Safety: no bridge (plain `hermes`, stock TUI) → never opens, renders nothing.
// Repaints only on a roster/route change, or every 120 ms while something works.
// HY_TABS=0 keeps it closed at startup; /hy-tabs toggles.

const ID = 'hy-tabs'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TAB_MAX = 22

const FALLBACK = {
  comment: '#6272A4', cyan: '#8BE9FD', deep: '#21222C', deeper: '#191A21', dim: '#9AA5CE', fg: '#F8F8F2',
  green: '#50FA7B', line: '#44475A', orange: '#FFB86C', pink: '#FF79C6', purple: '#BD93F9', red: '#FF5555',
  surface: '#343746', yellow: '#F1FA8C', accent: '#50FA7B', idle: '#8A95C0'
}

const roster = () => (Array.isArray(globalThis.__hySessions) ? globalThis.__hySessions : null)
const hasBridge = () => Boolean(globalThis.__hy?.ui?.get) && roster() !== null
const theme = () => ({ ...FALLBACK, ...(globalThis.__hy?.theme ?? {}) })
const IN_FLIGHT = new Set(['dispatched', 'finalizing', 'queued', 'running'])

// Delegated work of the session on screen still running (bridge v3 roster: in-turn + background).
const bgWork = () => {
  try {
    const r = globalThis.__hy?.roster?.()

    return Array.isArray(r) && r.some(x => IN_FLIGHT.has(x?.status))
  } catch {
    return false
  }
}

// A tab spins while its session works — and, for the current tab, while its subagents still run
// after the turn ended (the bar and sidebar show that work too).
const busy = (s, isCur = false) => s?.status === 'working' || s?.status === 'starting' || (isCur && bgWork())

const call = (fn, ...args) => {
  try {
    const f = globalThis[fn]

    return typeof f === 'function' ? f(...args) : undefined
  } catch {
    return undefined // best-effort UI action
  }
}

// Tabs whose × was refused (a session another window owns): id → time, shown as ⊘ in red.
const refused = new Map()

const closeTab = id => {
  const r = call('__hyCloseSession', id)

  Promise.resolve(r)
    .then(res => {
      // closeLiveView answers null for a session this window holds nothing for.
      if (!res || res.closed === false || res.ok === false) {
        refused.set(id, Date.now())
      }
    })
    .catch(() => refused.set(id, Date.now()))
}

export default function register(sdk) {
  const { Box, Text, React, defineWidgetApp, openWidget } = sdk

  if (!Box || !Text || !React || !defineWidgetApp || !openWidget) {
    return
  }

  const h = sdk.h ?? React.createElement
  const { useEffect, useState } = React

  const label = (s, i) => {
    const raw = String(s?.title || s?.preview || '').replace(/\s+/g, ' ').trim() || `session ${i + 1}`

    return raw.length > TAB_MAX ? raw.slice(0, TAB_MAX - 1) + '…' : raw
  }

  const routeSig = () => {
    try {
      return [...(globalThis.__hyRouteStates?.() ?? new Map())].map(([r, s]) => `${r}:${s}`).join(',')
    } catch {
      return ''
    }
  }

  function Tabs() {
    const [, force] = useState(0)

    useEffect(() => {
      let sig = ''
      const id = setInterval(() => {
        const list = roster() ?? []
        const routes = routeSig()
        const next = list.map(s => `${s.id}:${s.status}:${s.title ?? ''}:${s.current ? 1 : 0}`).join('|') + `#${globalThis.__hy?.ui?.get()?.sid}#${routes}`

        const flashing = [...refused.values()].some(t => Date.now() - t < 3000)

        if (next !== sig || flashing || list.some(x => busy(x)) || bgWork() || routes.includes(':active')) {
          sig = next
          force(n => n + 1)
        }
      }, 120)

      return () => clearInterval(id)
    }, [])

    const list = roster()

    if (!list) {
      return null
    }

    const c = theme()
    const cur = globalThis.__hy?.ui?.get()?.sid
    const now = Date.now()
    const spin = SPIN[Math.floor(now / 90) % SPIN.length]
    const cols = process.stdout.columns || 100

    // Route chips (right side).
    let states = new Map()

    try {
      states = globalThis.__hyRouteStates?.() ?? new Map()
    } catch {
      // sidebar not loaded → no route strip
    }

    const routeNodes = []
    let routeW = 0

    for (const [r, st] of states) {
      const pulse = Math.floor(now / 300) % 2
      const sty =
        st === 'active'
          ? { bg: pulse ? c.orange : c.yellow, bold: true, fg: c.deeper, g: spin }
          : st === 'done'
            ? { bg: c.surface, bold: true, fg: c.green, g: '✓' }
            : st === 'failed'
              ? { bg: c.surface, bold: true, fg: c.red, g: '×' }
              : { bg: c.deep, fg: c.idle, g: '·' }
      const text = ` ${sty.g} ${r} `

      routeW += text.length + 1
      routeNodes.push(h(Text, { backgroundColor: sty.bg, bold: sty.bold, color: sty.fg, key: `r${r}` }, text), h(Text, { key: `rs${r}` }, ' '))
    }

    const showRoutes = routeNodes.length > 0 && cols >= 90
    const budget = cols - 8 - (showRoutes ? routeW + 4 : 16)
    const tabs = []
    let used = 0

    list.forEach((s, i) => {
      const isCur = Boolean(s.current) || s.id === cur
      const name = ` ${i + 1} ${label(s, i)} `
      const w = name.length + 6

      if (used + w > budget) {
        return
      }

      used += w

      const bg = isCur ? c.accent : c.surface
      const fg = isCur ? c.deeper : c.fg
      const working = busy(s, isCur)
      const glyph = working ? spin : s.status === 'waiting' ? '?' : '●'
      const gColor = working ? (isCur ? c.deeper : c.orange) : s.status === 'waiting' ? (isCur ? c.deeper : c.yellow) : isCur ? c.deeper : c.green
      const sweep = working && !isCur ? Math.floor(now / 70) % (name.length + 8) : -99

      tabs.push(
        h(
          Box,
          { flexDirection: 'row', flexShrink: 0, key: s.id },
          h(Text, { color: bg }, '\u{e0b6}'),
          h(
            Box,
            { flexShrink: 0, onClick: () => !isCur && call('__hyActivateSession', s.id) },
            h(
              Text,
              { backgroundColor: bg, bold: isCur },
              h(Text, { color: gColor }, glyph),
              ...[...name].map((ch, k) => {
                const d = Math.abs(k - sweep + 4)

                return h(Text, { color: d <= 2 ? '#FFFFFF' : d <= 4 ? c.yellow : fg, key: k }, ch)
              })
            )
          ),
          h(
            Box,
            { flexShrink: 0, onClick: () => closeTab(s.id) },
            now - (refused.get(s.id) ?? 0) < 3000
              ? h(Text, { backgroundColor: c.red, bold: true, color: c.deeper }, '⊘ ')
              : h(Text, { backgroundColor: bg, color: isCur ? c.deeper : c.comment }, '× ')
          ),
          h(Text, { color: bg }, '\u{e0b4}'),
          h(Text, null, ' ')
        )
      )
    })

    const hidden = list.length - tabs.length

    return h(
      Box,
      { flexDirection: 'row', flexShrink: 0, width: Math.max(20, cols - 4) },
      h(Text, { color: c.accent }, '\u{f04e9} '),
      ...tabs,
      hidden > 0 ? h(Text, { color: c.dim }, `+${hidden} `) : null,
      h(
        Box,
        { flexShrink: 0, onClick: () => call('__hyNewSession') },
        h(Text, null, h(Text, { color: c.line }, '\u{e0b6}'), h(Text, { backgroundColor: c.line, bold: true, color: c.green }, '+'), h(Text, { color: c.line }, '\u{e0b4}'))
      ),
      h(Box, { flexGrow: 1 }),
      showRoutes ? h(Text, { color: c.accent }, '\u{f000e} ') : h(Text, { color: c.comment }, '^X switch'),
      ...(showRoutes ? routeNodes : [])
    )
  }

  let app

  try {
    app = defineWidgetApp({
      help: 'hy tabs — live sessions as clickable tabs (× close, + new) and subagent route status',
      id: ID,
      init: () => ({ v: 1 }),
      mode: 'ambient',
      reduce: (state, input) => (input?.key?.escape ? null : state),
      render: () => (hasBridge() ? h(Tabs) : null),
      width: 10,
      zone: 'dock-bottom'
    })
  } catch {
    return
  }

  if (process.env.HY_TABS !== '0' && !globalThis.__hyTabsBooted) {
    globalThis.__hyTabsBooted = true

    let tries = 0
    const boot = () => {
      if (hasBridge()) {
        try {
          openWidget(app, { v: 1 })
        } catch {
          // ignore
        }
      } else if (++tries < 160) {
        // The roster arrives with the first live-session poll, which can take a while
        // right after the gateway (re)starts: keep trying for ~2 minutes.
        setTimeout(boot, tries < 40 ? 250 : 1000)
      }
    }

    setTimeout(boot, 300)
  }
}
