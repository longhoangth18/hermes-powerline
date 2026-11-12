
// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline — paints the powerline composer prompt. Appended to
// components/appLayout.tsx at build time (stock PromptPrefix is renamed to
// PromptPrefixClassic; a <PlPromptLine/> is inserted above the input rows).
// Only prompts built by lib/prompt.ts's powerline composerPromptText are
// painted; anything else renders the stock way.
// ═══════════════════════════════════════════════════════════════════════
import { type ChildProcess as __PlsChild, execFile as __plsExecFile } from 'node:child_process'
import {
  existsSync as __plsExists,
  readdirSync as __plsReaddir,
  readFileSync as __plsRead,
  rmSync as __plsRm,
  statfsSync as __plsStatfs
} from 'node:fs'
import { cpus as __plsCpus, freemem as __plsFreemem, tmpdir as __plsTmpdir, totalmem as __plsTotalmem } from 'node:os'
import { join as __plsJoin } from 'node:path'
import {
  Component as __PlsComponent,
  type ReactNode as __PlsNode,
  useEffect as __plsUseEffect,
  useState as __plsUseState
} from 'react'

import {
  PL_LOOK,
  plEdgeGray,
  plGray,
  plInk,
  plTone,
  PLP_CAP_L,
  PLP_SEP,
  PLP_SYS,
  PL_STAT_VALUE_W,
  plRightWidth,
  type PlStatKey,
  plStatTier,
  plPromptLine,
  plPromptSegments,
  type PlPromptKind,
  type PlPromptSeg
} from '../lib/prompt.js'

// ── system stats sampler ─────────────────────────────────────────────────
// macOS: `macmon pipe -s 1` = ONE sample, then a clean exit. macmon panics on
// EPIPE (→ one crash report per probe, which can snowball), so it never
// writes to a pipe at all: sh redirects its stdout to a temp FILE. Even if
// Hermes dies mid-sample (tab closed, SIGHUP), the orphan just finishes
// writing the file and exits cleanly.
// After 3 failures in a row we stop calling macmon for good and fall back to
// node's os counters (CPU + RAM only).
interface PlSys {
  cpu: number // 0..100
  diskTotal?: number // bytes
  diskUsed?: number // bytes
  gpu?: number // 0..100
  ramTotal: number // bytes
  ramUsed: number // bytes
  temp?: number // °C, hottest of CPU / GPU averages
}

const PLS_EVERY_MS = 3000
const PLS_MACMON =
  process.platform === 'darwin'
    ? (['/opt/homebrew/bin/macmon', '/usr/local/bin/macmon'].find(p => __plsExists(p)) ?? null)
    : null

const PLS_OUT = __plsJoin(__plsTmpdir(), `hermes-pl-macmon-${process.pid}.json`)
let plsLast: null | PlSys = null
let plsChild: __PlsChild | null = null
let plsTimer: null | ReturnType<typeof setInterval> = null
let plsFails = 0
let plsPrevCpu: null | { idle: number; total: number } = null
const plsSubs = new Set<(s: PlSys) => void>()

// Sweep files left by Hermes sessions that died without an 'exit' event (SIGHUP).
try {
  for (const f of __plsReaddir(__plsTmpdir())) {
    const pid = Number(/^hermes-pl-macmon-(\d+)\.json$/.exec(f)?.[1])

    if (!pid || pid === process.pid) {
      continue
    }

    try {
      process.kill(pid, 0) // still alive → leave it
    } catch (e) {
      // ESRCH = no such process. EPERM = alive but not ours → leave it.
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
        __plsRm(__plsJoin(__plsTmpdir(), f), { force: true })
      }
    }
  }
} catch {
  // best effort
}

process.once('exit', () => {
  plsChild?.kill('SIGKILL')

  try {
    __plsRm(PLS_OUT, { force: true })
  } catch {
    // best effort
  }
})

// Disk: one statfs every 30 s (the data volume on macOS — `/` is the sealed
// system snapshot). used = total − available, the way Finder counts it.
const PLS_DISK_PATH =
  process.platform === 'darwin' && __plsExists('/System/Volumes/Data') ? '/System/Volumes/Data' : '/'

let plsDiskAt = 0
let plsDiskVal: { diskTotal?: number; diskUsed?: number } = {}

function plsDisk() {
  const now = Date.now()

  if (now - plsDiskAt > 30_000) {
    plsDiskAt = now

    try {
      const f = __plsStatfs(PLS_DISK_PATH)
      const total = f.blocks * f.bsize

      plsDiskVal = total > 0 ? { diskTotal: total, diskUsed: total - f.bavail * f.bsize } : {}
    } catch {
      plsDiskVal = {}
    }
  }

  return plsDiskVal
}

function plsEmit(sample: PlSys) {
  const s = { ...sample, ...plsDisk() }

  plsLast = s

  for (const fn of plsSubs) {
    fn(s)
  }
}

// "Used" memory the way the OS monitors count it. total − free would count
// the file cache as used and read far too high.
//   macOS: app (anonymous − purgeable) + wired + compressed, from vm_stat —
//          the same sum Activity Monitor and macmon report.
//   Linux: total − MemAvailable.
let plsVmUsed: null | number = null

function plsMemUsed(total: number): number {
  if (process.platform === 'linux') {
    try {
      const m = /^MemAvailable:\s+(\d+) kB/m.exec(__plsRead('/proc/meminfo', 'utf8'))

      if (m) {
        return total - Number(m[1]) * 1024
      }
    } catch {
      // fall through
    }
  }

  if (process.platform === 'darwin') {
    // Async refresh; the value lands for the next tick. vm_stat exits by
    // itself after printing, so reading its pipe is safe.
    __plsExecFile('/usr/bin/vm_stat', { timeout: 2000 }, (err, out) => {
      if (err) {
        return
      }

      const page = Number(/page size of (\d+) bytes/.exec(out)?.[1]) || 16384
      const n = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? NaN)

      const pages =
        n('Anonymous pages') - n('Pages purgeable') + n('Pages wired down') + n('Pages occupied by compressor')

      if (Number.isFinite(pages) && pages > 0) {
        plsVmUsed = pages * page
      }
    })

    if (plsVmUsed != null) {
      return plsVmUsed
    }
  }

  return total - __plsFreemem()
}

function plsFallback(): PlSys {
  let idle = 0
  let total = 0

  for (const c of __plsCpus()) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }

  const prev = plsPrevCpu
  plsPrevCpu = { idle, total }
  const dt = prev ? total - prev.total : 0
  const cpu = prev && dt > 0 ? 100 * (1 - (idle - prev.idle) / dt) : (plsLast?.cpu ?? 0)
  const ramTotal = __plsTotalmem()

  return { cpu, ramTotal, ramUsed: plsMemUsed(ramTotal) }
}

function plsTick() {
  if (plsChild) {
    return
  }

  if (!PLS_MACMON || plsFails >= 3) {
    plsEmit(plsFallback())

    return
  }

  plsChild = __plsExecFile(
    '/bin/sh',
    ['-c', 'exec "$0" pipe -s 1 -i 700 >"$1" 2>/dev/null', PLS_MACMON, PLS_OUT],
    { killSignal: 'SIGKILL', timeout: 5000 },
    err => {
      plsChild = null

      try {
        if (err) {
          throw err
        }

        const out = __plsRead(PLS_OUT, 'utf8')
        const d = JSON.parse(out.trim().split('\n').pop() || '') as {
          cpu_active_ratio?: number
          gpu_active_ratio?: number
          memory?: { ram_total?: number; ram_usage?: number }
          temp?: { cpu_temp_avg?: number; gpu_temp_avg?: number }
        }

        const temps = [d.temp?.cpu_temp_avg, d.temp?.gpu_temp_avg].filter(
          (x): x is number => typeof x === 'number' && x > 0
        )

        plsFails = 0
        plsEmit({
          cpu: 100 * (d.cpu_active_ratio ?? 0),
          gpu: typeof d.gpu_active_ratio === 'number' ? 100 * d.gpu_active_ratio : undefined,
          ramTotal: d.memory?.ram_total ?? __plsTotalmem(),
          ramUsed: d.memory?.ram_usage ?? 0,
          temp: temps.length ? Math.max(...temps) : undefined
        })
      } catch {
        plsFails += 1
        plsEmit(plsFallback())
      }
    }
  )
}

function usePlSys(on: boolean): null | PlSys {
  const [s, set] = __plsUseState<null | PlSys>(plsLast)

  __plsUseEffect(() => {
    if (!on) {
      return
    }

    plsSubs.add(set)

    if (!plsTimer) {
      plsTick()
      plsTimer = setInterval(plsTick, PLS_EVERY_MS)
      plsTimer.unref?.()
    }

    return () => {
      plsSubs.delete(set)

      if (!plsSubs.size && plsTimer) {
        clearInterval(plsTimer)
        plsTimer = null
      }
    }
  }, [on])

  return on ? s : null
}

interface PlStat {
  bg: string
  fg: string
  key: PlStatKey
  text: string
}

const PLS_SEP_R = '\ue0b2' // left-pointing powerline arrow
const plsW = (s: string) => [...s].length // our glyphs are all 1 cell

const PLS_ICON: Record<PlStatKey, string> = {
  cpu: '\u{f061a}', // nf-md-chip
  disk: '\u{f02ca}', // nf-md-harddisk
  gpu: '\u{f08ae}', // nf-md-expansion_card
  ram: '\u{f035b}', // nf-md-memory
  temp: '\u{f050f}' // nf-md-thermometer
}

// Dracula (draculatheme.com) — used by `palette: "dracula"`.
const PLP_DRACULA = {
  bg: '#282A36',
  cyan: '#8BE9FD',
  green: '#50FA7B',
  pink: '#FF79C6',
  purple: '#BD93F9'
}

const PLS_NORMAL: Record<PlStatKey, string> = {
  cpu: '#50FA7B',
  disk: '#FF79C6',
  gpu: '#F1FA8C',
  ram: '#BD93F9',
  temp: '#8BE9FD'
}

// 0 = fine, 1 = warn, 2 = critical
const plsLevel = (v: number, warn: number, crit: number): 0 | 1 | 2 => (v >= crit ? 2 : v >= warn ? 1 : 0)

function plsDiskText(used: number, total: number): string {
  // Decimal units, like Finder / the label on the box.
  return total >= 1e12
    ? `${(used / 1e12).toFixed(1)}/${(total / 1e12).toFixed(1)}T`
    : `${Math.round(used / 1e9)}/${Math.round(total / 1e9)}G`
}

// Before the first sample lands every cell shows '--' (layout stays put).
function plsStats(s: null | PlSys, keys: PlStatKey[]): PlStat[] {
  const gb = (b: number) => b / 1024 ** 3
  const pct = (v: number) => `${Math.round(Math.max(0, Math.min(100, v)))}%`
  const all: Partial<Record<PlStatKey, { level: 0 | 1 | 2; value: string }>> = {}

  if (s) {
    const ramPct = s.ramTotal ? (100 * s.ramUsed) / s.ramTotal : 0

    all.cpu = { level: plsLevel(s.cpu, 70, 90), value: pct(s.cpu) }
    all.ram = { level: plsLevel(ramPct, 75, 90), value: `${gb(s.ramUsed).toFixed(1)}/${Math.round(gb(s.ramTotal))}G` }

    if (s.gpu != null) {
      all.gpu = { level: plsLevel(s.gpu, 70, 90), value: pct(s.gpu) }
    }

    if (s.temp != null) {
      all.temp = { level: plsLevel(s.temp, 70, 85), value: `${Math.round(s.temp)}\u00b0C` }
    }

    if (s.diskTotal && s.diskUsed != null) {
      all.disk = {
        level: plsLevel((100 * s.diskUsed) / s.diskTotal, 85, 95),
        value: plsDiskText(s.diskUsed, s.diskTotal)
      }
    }
  }

  return keys.map((key, i) => {
    const st = all[key]
    // Value centred in its fixed slot, so every cell keeps the same width.
    const w = PL_STAT_VALUE_W[key]
    const raw = [...(st?.value ?? '--')].slice(0, w).join('')
    const left = Math.floor((w - plsW(raw)) / 2)
    const value = ' '.repeat(left) + raw + ' '.repeat(w - plsW(raw) - left)
    const text = ` ${PLS_ICON[key]}${PL_LOOK.gap}${value} `
    const level = st?.level ?? 0

    if (PL_LOOK.mono) {
      // Mirrors the left bars: darkest at the right screen edge → lighter inward.
      const bg = plEdgeGray(keys.length - 1 - i, keys.length)

      return { bg, fg: level ? plTone(level === 2 ? 'err' : 'warn', bg) : plInk(bg), key, text }
    }

    const bg = !st ? '#6272A4' : level === 2 ? '#FF5555' : level === 1 ? '#FFB86C' : PLS_NORMAL[key]

    return { bg, fg: PLP_DRACULA.bg, key, text }
  })
}

const PLP_LOOK: Record<PlPromptKind, { bg: string; fg: string }> = PL_LOOK.mono
  ? {
      agent: { bg: plEdgeGray(2, 3), fg: plInk(plEdgeGray(2, 3)) },
      caret: { bg: plGray(0), fg: PL_LOOK.edge ?? '#5FD75F' },
      host: { bg: plEdgeGray(1, 3), fg: plInk(plEdgeGray(1, 3)) },
      user: { bg: plEdgeGray(0, 3), fg: plInk(plEdgeGray(0, 3)) }
    }
  : {
      agent: { bg: PLP_DRACULA.cyan, fg: PLP_DRACULA.bg },
      caret: { bg: PLP_DRACULA.bg, fg: PLP_DRACULA.green },
      host: { bg: PLP_DRACULA.pink, fg: PLP_DRACULA.bg },
      user: { bg: PLP_DRACULA.purple, fg: PLP_DRACULA.bg }
    }

function PlSegs({ segs }: { segs: PlPromptSeg[] }) {
  return (
    <>
      {PLP_CAP_L ? <Text color={PLP_LOOK[segs[0]!.kind].bg}>{PLP_CAP_L}</Text> : null}
      {segs.map((seg, i) => {
        const { bg, fg } = PLP_LOOK[seg.kind]
        const next = segs[i + 1]

        return (
          <Text key={seg.kind}>
            <Text backgroundColor={bg} bold color={fg}>
              {seg.text}
            </Text>
            {PL_LOOK.thin ? (
              next ? (
                <Text backgroundColor={PLP_LOOK[next.kind].bg} color={PL_LOOK.edge!}>
                  {PL_LOOK.thinOf(PLP_SEP)}
                </Text>
              ) : (
                <Text color={bg}>{PLP_SEP}</Text>
              )
            ) : PL_LOOK.edge ? (
              <>
                <Text backgroundColor={PL_LOOK.edge} color={bg}>
                  {PLP_SEP}
                </Text>
                <Text backgroundColor={next ? PLP_LOOK[next.kind].bg : undefined} color={PL_LOOK.edge}>
                  {PLP_SEP}
                </Text>
              </>
            ) : next ? (
              <Text backgroundColor={PLP_LOOK[next.kind].bg} color={bg}>
                {PLP_SEP}
              </Text>
            ) : (
              <Text color={bg}>{PLP_SEP}</Text>
            )}
          </Text>
        )
      })}
    </>
  )
}

// Same safety net as the status bar: a render error falls back to stock.
class PlsBoundary extends __PlsComponent<{ children: __PlsNode; fallback: () => __PlsNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // swallowed on purpose
  }

  render() {
    return this.state.failed ? this.props.fallback() : this.props.children
  }
}

/** Row above the input in two-line mode: user / host / agent, stats on the right. */
const PlPromptLineInner = memo(function PlPromptLineInner(props: {
  cols: number
  profileName?: null | string
  shellMode: boolean
}) {
  const width = Math.max(1, props.cols - 2) // composer has paddingX={1}
  const segs = plPromptLine(props.profileName, props.shellMode, TERMUX_TUI_MODE, width)
  const tier = segs?.length ? plStatTier(props.cols) : []
  const sys = usePlSys(PLP_SYS && tier.length > 0)

  if (!segs?.length) {
    return null
  }

  // Shared right block: same width as the status bar's right block above.
  const leftW = plsW(PLP_CAP_L) + segs.reduce((n, s) => n + plsW(s.text) + PL_LOOK.sepW, 0)
  const stats = tier.length && leftW + plRightWidth(props.cols) + 1 <= width ? plsStats(sys, tier) : []

  return (
    <Box flexShrink={0} height={1} overflow="hidden" width={width}>
      <Box flexShrink={0}>
        <PlSegs segs={segs} />
      </Box>
      <Box flexGrow={1} />
      {stats.length ? (
        <Box flexShrink={0}>
          {stats.map((st, i) => (
            <Text key={st.key}>
              {PL_LOOK.thin ? (
                i ? (
                  <Text backgroundColor={stats[i - 1]!.bg} color={PL_LOOK.edge!}>
                    {PL_LOOK.thinOf(PLS_SEP_R)}
                  </Text>
                ) : (
                  <Text color={st.bg}>{PLS_SEP_R}</Text>
                )
              ) : PL_LOOK.edge ? (
                <>
                  <Text backgroundColor={i ? stats[i - 1]!.bg : undefined} color={PL_LOOK.edge}>
                    {PLS_SEP_R}
                  </Text>
                  <Text backgroundColor={PL_LOOK.edge} color={st.bg}>
                    {PLS_SEP_R}
                  </Text>
                </>
              ) : (
                <Text backgroundColor={i ? stats[i - 1]!.bg : undefined} color={st.bg}>
                  {PLS_SEP_R}
                </Text>
              )}
              <Text backgroundColor={st.bg} bold color={st.fg}>
                {st.text}
              </Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
})

function PlPromptLine(props: { cols: number; profileName?: null | string; shellMode: boolean }) {
  return (
    <PlsBoundary fallback={() => null}>
      <PlPromptLineInner {...props} />
    </PlsBoundary>
  )
}

function PromptPrefix(props: { bold?: boolean; color: string; promptText: string; width: number }) {
  return (
    <PlsBoundary fallback={() => <PromptPrefixClassic {...props} />}>
      <PlPromptPrefix {...props} />
    </PlsBoundary>
  )
}

const PlPromptPrefix = memo(function PlPromptPrefix(props: {
  bold?: boolean
  color: string
  promptText: string
  width: number
}) {
  const segs = plPromptSegments(props.promptText)

  if (!segs?.length) {
    return <PromptPrefixClassic {...props} />
  }

  if (segs[0]!.kind === 'caret') {
    return (
      <Box flexShrink={0} width={props.width}>
        <Text bold color={PLP_LOOK.caret.fg}>
          {segs[0]!.text}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexShrink={0} width={props.width}>
      <PlSegs segs={segs} />
    </Box>
  )
})
