
// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline — composer prompt. Appended to lib/prompt.ts at build time
// by ~/.local/bin/hermes-powerline (stock composerPromptText is renamed to
// composerPromptTextClassic). Modelled on an Oh My Posh style
// shell prompt:   user  󰒍 host  ☤ hermes
// The returned prompt string has exactly the rendered width, so Hermes' own
// width maths (composerPromptWidth / stableComposerColumns) stays correct;
// components/appLayout.tsx's PromptPrefix paints it via plPromptSegments().
// ═══════════════════════════════════════════════════════════════════════
import { readFileSync as __plpReadFileSync } from 'node:fs'
import { homedir as __plpHomedir, hostname as __plpHostname, userInfo as __plpUserInfo } from 'node:os'
import { join as __plpJoin } from 'node:path'

export type PlPromptKind = 'agent' | 'caret' | 'host' | 'user'

export interface PlPromptSeg {
  kind: PlPromptKind
  text: string
}

export type PlpCap = 'flat' | 'round' | 'slant'

const PLP_CAPS: Record<PlpCap, string> = {
  flat: '', // straight vertical edge — no cap glyph
  round: '', // left half-circle (OMP leading_diamond)
  slant: '' // diagonal cut (powerline lower-right triangle)
}

export const PLP_SEP = '' // powerline arrow
export const PLP_CARET = '❯' // ❯ input caret under the two-line prompt

const PLP_APPLE = '\uf179' // nf-fa-apple
const PLP_HOST = '\u{f01c4}' // nf-md-desktop_mac
const PLP_AGENT = '\u{f140b}' // nf-md-lightning_bolt — Hermes, the swift messenger

export type PlPaletteName = 'dracula' | 'mono' | 'skin'

interface PlpConf {
  bigIcons: boolean
  cap: PlpCap
  edge: null | string
  on: boolean
  palette: PlPaletteName
  sys: boolean
  twoLine: boolean
}

function plpConf(): PlpConf {
  const conf: PlpConf = { bigIcons: true, cap: 'slant', edge: null, on: true, palette: 'mono', sys: true, twoLine: true }
  let edgeRaw: unknown

  if (process.env.HERMES_POWERLINE === '0' || process.env.HERMES_POWERLINE_PROMPT === '0') {
    conf.on = false
  }

  try {
    const home = process.env.HERMES_HOME?.trim() || __plpJoin(__plpHomedir(), '.hermes')
    const path = process.env.HERMES_POWERLINE_CONF?.trim() || __plpJoin(home, 'powerline', 'config.json')
    const raw = JSON.parse(__plpReadFileSync(path, 'utf8')) as {
      bigIcons?: unknown
      cap?: unknown
      edge?: unknown
      enabled?: unknown
      palette?: unknown
      prompt?: unknown
      sys?: unknown
      twoLine?: unknown
    }

    if (raw.enabled === false || raw.prompt === false) {
      conf.on = false
    }

    if (typeof raw.cap === 'string' && raw.cap in PLP_CAPS) {
      conf.cap = raw.cap as PlpCap
    }

    if (raw.sys === false || process.env.HERMES_POWERLINE_SYS === '0') {
      conf.sys = false
    }

    if (raw.twoLine === false) {
      conf.twoLine = false
    }

    if (raw.palette === 'dracula' || raw.palette === 'skin' || raw.palette === 'mono') {
      conf.palette = raw.palette
    }

    if (raw.bigIcons === false) {
      conf.bigIcons = false
    }

    edgeRaw = raw.edge
  } catch {
    // defaults
  }

  // The coloured ">" band between segments: on (green) for the grey palette,
  // off for the others unless a colour is given. `edge: false` turns it off.
  if (typeof edgeRaw === 'string' && /^#[0-9a-f]{6}$/i.test(edgeRaw)) {
    conf.edge = edgeRaw
  } else if (edgeRaw !== false && conf.palette === 'mono') {
    conf.edge = '#5FD75F'
  }

  return conf
}

const PLP_CONF = plpConf()

// ── shared look (status bar + prompt row) ───────────────────────────────
// Neutral grey ramp, dark → light. Every colour is an exact xterm-256 value, so
// it looks the same with or without truecolor (tmux, SSH clients). It stops at
// a mid grey so plain white text stays readable on every step. The separators
// are a 2-cell band in the edge colour, which reads as a green ">" outline.
export const PL_GRAYS = [
  '#1C1C1C',
  '#262626',
  '#303030',
  '#3A3A3A',
  '#444444',
  '#4E4E4E',
  '#585858',
  '#626262',
  '#6C6C6C',
  '#767676'
]

export const plGray = (i: number) => PL_GRAYS[Math.max(0, Math.min(PL_GRAYS.length - 1, Math.round(i)))]!

export const plIsLight = (bg: string) => {
  const n = parseInt(bg.slice(1), 16)

  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150
}

/** Text colour that reads on `bg`. */
export const plInk = (_bg: string) => '#FFFFFF'

export type PlTone = 'accent' | 'err' | 'warn'

/** Accent / alarm text colour tuned for a dark or a light grey background. */
export const plTone = (tone: PlTone, bg: string, edge = PLP_CONF.edge ?? '#5FD75F') =>
  plIsLight(bg)
    ? { accent: '#005F00', err: '#AF0000', warn: '#875F00' }[tone]
    : { accent: edge, err: '#FF5F5F', warn: '#FFAF5F' }[tone]

export const PL_LOOK = {
  /** Colour of the separator band, or null → classic 1-cell separators. */
  edge: PLP_CONF.edge,
  /** Gap after an icon: 2 cells leave room for full-size (non-Mono) Nerd Font glyphs. */
  gap: PLP_CONF.bigIcons ? '  ' : ' ',
  mono: PLP_CONF.palette === 'mono',
  palette: PLP_CONF.palette,
  /** Cells one separator takes. */
  sepW: PLP_CONF.edge ? 2 : 1
}

/** Steps along the grey ramp for the i-th of n left-hand segments. */
export const plLeftGray = (i: number, n: number) => plGray(n <= 4 ? i * 2 : (i * 6) / Math.max(1, n - 1))

export const PLP_CAP_L = PLP_CAPS[PLP_CONF.cap]
/** Show CPU / GPU / RAM / temperature on the right of the two-line prompt row. */
export const PLP_SYS = PLP_CONF.sys

function plpEnabled(): boolean {
  return PLP_CONF.on
}

const PLP_ON = plpEnabled()

const plpClip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

const PLP_USER = (() => {
  try {
    return plpClip(__plpUserInfo().username || process.env.USER || 'user', 16)
  } catch {
    return plpClip(process.env.USER || 'user', 16)
  }
})()

const PLP_HOSTNAME = plpClip((__plpHostname() || 'mac').replace(/\.local$/i, '').split('.')[0] || 'mac', 18)

// Prompt string → its segments. Keyed by the exact string we produced, so
// PromptPrefix only paints prompts that came from here (shell `$`, termux `>`
// and the classic prompt fall through untouched).
const plpRegistry = new Map<string, PlPromptSeg[]>()

function plpBuild(segs: PlPromptSeg[]): string {
  const text = PLP_CAP_L + segs.map(s => s.text + PLP_SEP.repeat(PL_LOOK.sepW)).join('')

  plpRegistry.set(text, segs)

  return text
}

export function plPromptSegments(promptText: string): null | PlPromptSeg[] {
  return plpRegistry.get(promptText) ?? null
}

function plpSegments(profileName: null | string | undefined, cols: number, roomy: number): PlPromptSeg[] {
  const agent = profileName && !['default', 'custom'].includes(profileName) ? profileName : 'hermes'
  const g = PL_LOOK.gap
  const user: PlPromptSeg = { kind: 'user', text: ` ${PLP_APPLE}${g}${PLP_USER} ` }
  const host: PlPromptSeg = { kind: 'host', text: ` ${PLP_HOST}${g}${PLP_HOSTNAME} ` }
  const hermes: PlPromptSeg = { kind: 'agent', text: ` ${PLP_AGENT}${g}${agent} ` }

  // Shed host, then user, on narrow panes.
  if (cols >= roomy) {
    return [user, host, hermes]
  }

  if (cols >= roomy - 30) {
    return [user, hermes]
  }

  return [{ kind: 'user', text: ` ${PLP_APPLE}${g.slice(1)} ` }]
}

/** Two-line mode: the powerline row drawn ABOVE the input (null = none). */
export function plPromptLine(
  profileName?: null | string,
  shellMode = false,
  termuxMode = false,
  totalCols?: number
): null | PlPromptSeg[] {
  if (!PLP_ON || !PLP_CONF.twoLine || termuxMode) {
    return null
  }

  void shellMode // keep the row in `!` mode too, so the composer never jumps

  return plpSegments(profileName, totalCols ?? 0, 60)
}

// ── balanced two-row layout ─────────────────────────────────────────────
// Row 1 (status bar) and row 2 (prompt row) each end in a right-hand block of
// the SAME width, so the two blocks line up into one clean column:
//   row 1:  ready  model  ctx …            | folder  branch | timer |
//   row 2:  user  host  hermes             | cpu | gpu | ram | temp |
// Every stat cell has a fixed width (values are padded), so nothing jitters.
export type PlStatKey = 'cpu' | 'disk' | 'gpu' | 'ram' | 'temp'

/** Value widths (cells) per stat; a cell = separator + ' ' + icon + gap + value + ' '. */
export const PL_STAT_VALUE_W: Record<PlStatKey, number> = { cpu: 4, disk: 8, gpu: 4, ram: 8, temp: 4 }
export const plStatCellW = (k: PlStatKey) => PL_STAT_VALUE_W[k] + 3 + PL_LOOK.gap.length + PL_LOOK.sepW

const PL_STAT_TIERS: PlStatKey[][] = [
  ['cpu', 'gpu', 'ram', 'disk', 'temp'],
  ['cpu', 'ram', 'disk', 'temp'],
  ['cpu', 'ram', 'disk'],
  ['cpu', 'ram']
]

const plTierW = (keys: PlStatKey[]) => keys.reduce((n, k) => n + plStatCellW(k), 0)

/** Which stats show at this terminal width (display order): the richest set
 *  that takes at most ~46% of the row, so the status bar keeps its room. */
export function plStatTier(totalCols: number): PlStatKey[] {
  if (!PLP_ON || !PLP_CONF.twoLine || !PLP_CONF.sys || totalCols < 80) {
    return []
  }

  return PL_STAT_TIERS.find(keys => plTierW(keys) <= totalCols * 0.46) ?? []
}

/** Width of the right-hand block on both rows (0 = no shared block). */
export function plRightWidth(totalCols: number): number {
  return plTierW(plStatTier(totalCols))
}

export function composerPromptText(
  prompt: string,
  profileName?: null | string,
  shellMode = false,
  termuxMode = false,
  totalCols?: number
): string {
  if (!PLP_ON || shellMode || termuxMode) {
    return composerPromptTextClassic(prompt, profileName, shellMode, termuxMode, totalCols)
  }

  // Two-line: segments live on their own row; the input row only gets ❯, so
  // wrapped text starts right at the left edge instead of under a wide prompt.
  if (PLP_CONF.twoLine) {
    plpRegistry.set(PLP_CARET, [{ kind: 'caret', text: PLP_CARET }])

    return PLP_CARET
  }

  // One-line: leave the input at least ~45 columns.
  return plpBuild(plpSegments(profileName, totalCols ?? 0, 100))
}
