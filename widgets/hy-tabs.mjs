// hy-tabs — OpenCode-style session tabs for the Hermes TUI (part of hermes-powerline).
//
// Every live Hermes session (the roster the ^X switcher shows) is a tab in the
// bottom dock: the current one is a jade pill, the others show their state —
// a spinner + sweeping glow while working, ? when waiting for you, ✓ idle.
// Click a tab to switch to it; ^X opens the full switcher; /new starts one.
// Hidden while there is only one session, so a single-chat day stays clean.
//
// Data: globalThis.__hySessions (published by the hermes-powerline build from
// app/liveSessions.ts, refreshed by Hermes every ~1.5 s) and
// globalThis.__hyActivateSession (from app/useMainApp.ts).
// Safety: no bridge (plain `hermes` / stock TUI) → never opens, renders nothing.
// Re-renders only when the roster changes, or every 120 ms while a session works.
// HY_TABS=0 keeps it closed at startup; /hy-tabs toggles.

const ID = 'hy-tabs'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TAB_MAX = 24
const JADE = '#5FD75F'
const AMBER = '#FFAF5F'

const roster = () => (Array.isArray(globalThis.__hySessions) ? globalThis.__hySessions : null)
const hasBridge = () => !!globalThis.__hy?.ui?.get && roster() !== null

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

  const busy = s => s?.status === 'working' || s?.status === 'starting'

  function Tabs({ t }) {
    const [, force] = useState(0)

    useEffect(() => {
      let sig = ''
      const id = setInterval(() => {
        const list = roster() ?? []
        const next = list.map(s => `${s.id}:${s.status}:${s.title ?? ''}:${s.current ? 1 : 0}`).join('|') + `#${globalThis.__hy?.ui?.get()?.sid}`

        // Repaint on a roster change, or continuously while a session works (spinner/glow).
        if (next !== sig || list.some(busy)) {
          sig = next
          force(n => n + 1)
        }
      }, 120)

      return () => clearInterval(id)
    }, [])

    const list = roster()

    if (!list || list.length < 2) {
      return null
    }

    const cur = globalThis.__hy?.ui?.get()?.sid
    const now = Date.now()
    const spin = SPIN[Math.floor(now / 90) % SPIN.length]
    const cols = process.stdout.columns || 100
    const budget = cols - 24
    const tabs = []
    let used = 2

    list.forEach((s, i) => {
      const isCur = Boolean(s.current) || s.id === cur
      const text = ` ${i + 1} ${label(s, i)} `
      const w = text.length + 4

      if (used + w > budget) {
        return
      }

      used += w

      const bg = isCur ? JADE : '#303030'
      const fg = isCur ? '#1C1C1C' : '#C6C6C6'
      const glyph = busy(s) ? spin : s.status === 'waiting' ? '?' : '✓'
      const gColor = isCur ? '#1C1C1C' : busy(s) ? AMBER : s.status === 'waiting' ? '#FFFF87' : JADE
      // Working, not focused: a soft glow sweeps across the tab title.
      const sweep = busy(s) && !isCur ? Math.floor(now / 70) % (text.length + 8) : -99

      tabs.push(
        h(
          Box,
          {
            flexShrink: 0,
            key: s.id,
            onClick: () => {
              try {
                if (!isCur && typeof globalThis.__hyActivateSession === 'function') {
                  globalThis.__hyActivateSession(s.id)
                }
              } catch {
                // switching is best-effort
              }
            }
          },
          h(
            Text,
            null,
            h(Text, { color: bg }, '\u{e0b6}'),
            h(Text, { backgroundColor: bg, bold: true, color: gColor }, glyph),
            h(
              Text,
              { backgroundColor: bg, bold: isCur },
              ...[...text].map((ch, k) => {
                const d = Math.abs(k - sweep + 4)

                return h(Text, { color: d <= 2 ? '#FFFFFF' : d <= 4 ? '#E4E4E4' : fg, key: k }, ch)
              })
            ),
            h(Text, { color: bg }, '\u{e0b4}'),
            h(Text, null, ' ')
          )
        )
      )
    })

    const hidden = list.length - tabs.length

    return h(
      Box,
      { flexDirection: 'row', flexShrink: 0, width: Math.max(20, cols - 4) },
      h(Text, { color: '#6C6C6C' }, '\u{f04e9} '),
      ...tabs,
      hidden > 0 ? h(Text, { color: t.color.muted }, `+${hidden} `) : null,
      h(Box, { flexGrow: 1 }),
      h(Text, { color: '#585858' }, '^X switch · /new')
    )
  }

  let app

  try {
    app = defineWidgetApp({
      help: 'hy tabs — live sessions as clickable tabs (^X switcher, /new)',
      id: ID,
      init: () => ({ v: 1 }),
      mode: 'ambient',
      reduce: (state, input) => (input?.key?.escape ? null : state),
      render: ({ t }) => (hasBridge() ? h(Tabs, { t }) : null),
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
      } else if (++tries < 40) {
        setTimeout(boot, 250) // roster arrives with the first live-session poll
      }
    }

    setTimeout(boot, 300)
  }
}
