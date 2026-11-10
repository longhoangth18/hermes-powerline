
// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline — injected by ~/.local/bin/hermes-powerline at build time.
// Source of truth: ~/.hermes/powerline/powerline.tsx (outside the git repo, so
// `hermes update` never touches it). Appended to components/appChrome.tsx so it
// can reuse that module's private helpers (FaceTicker, SessionDuration, …).
// ═══════════════════════════════════════════════════════════════════════
import { readFileSync as __plReadFileSync } from 'node:fs'
import { Component as __PlComponent } from 'react'
import { homedir as __plHomedir } from 'node:os'
import { join as __plJoin } from 'node:path'

import {
  PL_LOOK as __PL_LOOK,
  plGray as __plGray,
  plInk as __plInk,
  plIsLight as __plIsLight,
  plLeftGray as __plLeftGray,
  plRightWidth as __plRightWidth,
  plTone as __plTone,
  type PlTone as __PlTone
} from '../lib/prompt.js'

type PlStyle = 'arrow' | 'flame' | 'round' | 'slant'

interface PlConf {
  enabled: boolean
  icons: boolean
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
  const conf: PlConf = { enabled: true, icons: true, palette: 'mono', style: 'arrow' }

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
  w: number
}

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

function PowerlineRule(p: StatusRuleProps) {
  const { busy, cols, t, usage } = p
  const T = messages()
  const sep = PL_SEPS[PL_CONF.style] ?? PL_SEPS.arrow
  // Icon + gap (2 cells by default, so full-size Nerd Font glyphs have room).
  const ic = (glyph: string) => (PL_CONF.icons ? glyph.trimEnd() + __PL_LOOK.gap : '')
  const mono = __PL_LOOK.mono
  const edge = __PL_LOOK.edge
  const ok = (name: string) => p.statusBarFields == null || p.statusBarFields.has(name)

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

    pinned.push({
      bg: C.busy,
      bold: true,
      fg: dark,
      key: 'status',
      node: face(dark),
      render: bg => face(__plInk(bg)),
      w: busyIndicatorWidth(style, p.turnStartedAt != null)
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

  if (DEV_CREDITS_MODE) {
    pinned.push({ bg: C.warn, fg: dark, key: 'devmode', node: T.status.devCredits, w: stringWidth(T.status.devCredits) })
  }

  const modelText = `${ic('\u{f0674}')}${modelLabel(p.model, p.modelReasoningEffort, p.modelFast, p.modelReasoningEffortWire)}`

  if (ok('model')) {
    pinned.push({ bg: C.model, bold: true, fg: dark, key: 'model', node: modelText, w: stringWidth(modelText) })
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
  }

  // Context is the first optional-ish thing: added only when it fits whole.
  let ctxSeg: null | PlSeg = null

  if (ctxLabel) {
    const txt = `${ic('\u{f01bc}')}${ctxLabel}` // nf-md-database

    ctxSeg = { bg: C.ctxBg, fg: light, key: 'ctx', node: txt, w: stringWidth(txt) }

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
  const durBg = mono ? __plGray(9) : C.durBg
  const durFg = mono ? __plInk(durBg) : PL_CONF.palette !== 'skin' ? dark : light
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
  // only as wide as its content (never wider than the stats block below it).
  const rCells: { bg: string; bold?: boolean; fg: string; text: string }[] = []

  if (sharedW > 0) {
    const room = Math.max(0, Math.min(sharedW, Math.floor(width * 0.45)) - durPart)

    if (title) {
      const bg = mono ? __plGray(6) : C.titleBg

      if (room - sepW >= 8) {
        rCells.push({ bg, bold: true, fg: mono ? __plInk(bg) : dark, text: plTruncStart(` ${ic('\u{f0b79}')}${title} `, room - sepW) })
      }
    } else {
      const br = cwd.branch ? ` ${ic('\u{f062c}')}${cwd.branch} ` : ''
      const brW = stringWidth(br)
      const keepBranch = brW > 0 && brW + 2 * sepW + 10 <= room
      const pathRoom = room - sepW - (keepBranch ? brW + sepW : 0)

      if (pathRoom >= 6) {
        const pbg = mono ? __plGray(5) : C.cwdBg

        rCells.push({ bg: pbg, fg: mono ? __plInk(pbg) : C.cwdFg, text: plTruncStart(` ${ic('\u{f0770}')}${cwd.path} `, pathRoom) })

        if (keepBranch) {
          const bbg = mono ? __plGray(7) : C.mid

          rCells.push({ bg: bbg, bold: true, fg: mono ? __plInk(bbg) : C.branch, text: br })
        }
      }
    }
  }

  const blockW = sharedW > 0 ? rCells.reduce((n, c) => n + stringWidth(c.text) + sepW, 0) + durPart : 0

  const sepR = (prev: string | undefined, bg: string) =>
    edge ? (
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

  // Metrics first: tokens/s is the reason this bar exists.
  const tps = typeof usage.avg_tps === 'number' ? `${ic('\u{f04c5}')}${usage.avg_tps < 10 ? usage.avg_tps.toFixed(1) : Math.round(usage.avg_tps)} t/s` : ''

  if (tps && ok('tps')) {
    add({ bg: C.tpsBg, bold: true, fg: PL_CONF.palette !== 'skin' ? dark : t.color.label, key: 'tps', node: tps, w: stringWidth(tps) })
  }

  if (typeof usage.cache_hit_pct === 'number' && ok('cache_hit')) {
    const txt = `${ic('\u{f00e8}') || '◎ '}${usage.cache_hit_pct}%` // nf-md-cached
    const c = usage.cache_hit_pct >= 70 ? t.color.statusGood : usage.cache_hit_pct >= 40 ? t.color.statusWarn : light
    const dracula = PL_CONF.palette !== 'skin'

    add({ bg: C.cacheBg(usage.cache_hit_pct), fg: dracula ? dark : c, key: 'cache', node: txt, w: stringWidth(txt) })
  }

  if (typeof usage.avg_latency_s === 'number' && ok('latency')) {
    const txt = `${ic('\u{f051f}') || '◷ '}${usage.avg_latency_s.toFixed(1)}s` // nf-md-timer_sand

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

  if (subagents > 0 && ok('bg_subagents')) {
    add({ bg: deep, fg: t.color.label, key: 'subagents', node: `${PL_LINK} ${subagents}`, w: stringWidth(`${PL_LINK} ${subagents}`) })

    if (!busy) {
      const hint = subagents === 1 ? T.status.resumesWhenSubagentFinishes : T.status.resumesWhenSubagentsFinish(subagents)

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

  // Grey palette: walk the ramp dark → light, left to right.
  if (mono) {
    left.forEach((seg, i) => {
      seg.bg = __plLeftGray(i, left.length)
      seg.fg = seg.tone ? __plTone(seg.tone, seg.bg) : __plInk(seg.bg)

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
    const arrow = edge ? (
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
