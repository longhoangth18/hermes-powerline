
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
  /** true: the edge is ONE thin chevron cell; false: the 2-cell bold band. */
  edgeThin: boolean
  on: boolean
  palette: PlPaletteName
  sys: boolean
  twoLine: boolean
}

function plpConf(): PlpConf {
  const conf: PlpConf = { bigIcons: true, cap: 'slant', edge: null, edgeThin: true, on: true, palette: 'mono', sys: true, twoLine: true }
  let edgeRaw: unknown

  if (process.env.HERMES_POWERLINE === '0' || process.env.HERMES_POWERLINE_PROMPT === '0') {
    conf.on = false
  }

  // Env switches work with or without a (valid) config.json.
  if (process.env.HERMES_POWERLINE_SYS === '0') {
    conf.sys = false
  }

  try {
    const home = process.env.HERMES_HOME?.trim() || __plpJoin(__plpHomedir(), '.hermes')
    const path = process.env.HERMES_POWERLINE_CONF?.trim() || __plpJoin(home, 'powerline', 'config.json')
    const raw = JSON.parse(__plpReadFileSync(path, 'utf8')) as {
      bigIcons?: unknown
      cap?: unknown
      edge?: unknown
      edgeThin?: unknown
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

    if (raw.sys === false) {
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

    if (typeof raw.edgeThin === 'boolean') {
      conf.edgeThin = raw.edgeThin
    }
  } catch {
    // defaults
  }

  // The coloured ">" band between segments: on (green) for the grey palette,
  // off for the others unless a colour is given. `edge: false` turns it off.
  if (typeof edgeRaw === 'string' && /^#[0-9a-f]{6}$/i.test(edgeRaw)) {
    conf.edge = edgeRaw
  } else if (edgeRaw !== false && conf.palette === 'mono') {
    conf.edge = '#50FA7B' // Dracula green
  }

  return conf
}

const PLP_CONF = plpConf()

// ── shared look (status bar + prompt row) ───────────────────────────────
// Neutral grey ramp, dark → light. Every colour is an exact xterm-256 value, so
// it looks the same with or without truecolor (tmux, SSH clients). It stops at
// a mid grey so plain white text stays readable on every step. The separators
// are one thin chevron in the edge colour (or, with edgeThin: false, the 2-cell bold band).
// ── hy theme: Dracula, colour-depth aware ───────────────────────────────
// Truecolor terminals get the real Dracula canvas tones. Under 256 colours
// (tmux clamps to 256; Apple Terminal without COLORTERM is 256 too) a tinted
// dark like #282A36 rounds to cube 59 (#5f5f5f), so backgrounds fall back to
// neutral greys that both of Hermes' downgrades map exactly. Accents stay the
// Dracula hexes — they round to close neighbours either way.
// Mirrors hermes-ink/colorize.ts: tmux → 256; COLORTERM / HERMES_TUI_TRUECOLOR → 24-bit.
export const HY_TRUECOLOR = (() => {
  const e = process.env

  if (e.TMUX) {
    return false
  }

  if (/^(?:1|true|yes|on)$/i.test((e.HERMES_TUI_TRUECOLOR ?? '').trim()) || /truecolor|24bit/i.test(e.COLORTERM ?? '')) {
    return true
  }

  return /^(?:iTerm\.app|WezTerm|vscode|ghostty|Hyper|WarpTerminal|kitty|Tabby)$/.test(e.TERM_PROGRAM ?? '') || /kitty|ghostty|wezterm|alacritty|foot/.test(e.TERM ?? '')
})()

const T24 = HY_TRUECOLOR

export const HY = {
  truecolor: T24,
  // Canvas + surfaces — Dracula spec shades; 256 colours use dracula/vim's xterm codes.
  bg: T24 ? '#282A36' : '#303030', //          Background      | 236
  deep: T24 ? '#21222C' : '#262626', //        Dark (sidebar)  | 235
  deeper: T24 ? '#191A21' : '#1C1C1C', //      Darker          | 234
  surface: T24 ? '#343746' : '#3A3A3A', //     Light           | 237
  line: T24 ? '#44475A' : '#444444', //        Selection       | 238
  raised: T24 ? '#4D5066' : '#4E4E4E', //                      | 239
  // Text. `dim` is the legible muted label (#9AA5CE ≈ 5.9:1 on #282A36);
  // `comment` (3:1) is only for rules, hints and code comments.
  fg: T24 ? '#F8F8F2' : '#DADADA', //          Foreground      | 253
  dim: T24 ? '#9AA5CE' : '#AFAFD7',
  comment: T24 ? '#6272A4' : '#5F5FAF', //     Comment         | 61
  cyan: T24 ? '#8BE9FD' : '#87D7FF', //                        | 117
  green: T24 ? '#50FA7B' : '#5FFF87', //                       | 84
  orange: T24 ? '#FFB86C' : '#FFAF5F', //                      | 215
  pink: T24 ? '#FF79C6' : '#FF87D7', //                        | 212
  purple: T24 ? '#BD93F9' : '#AF87FF', //                      | 141
  red: T24 ? '#FF5555' : '#FF5F5F', //                         | 203
  yellow: T24 ? '#F1FA8C' : '#FFFF87', //                      | 228
  /** Idle / unused chips and tiles: dimmer than labels, still ≥ 3:1 on the surface (comment is 2.5:1). */
  idle: T24 ? '#8A95C0' : '#8787AF',
  /** The hy accent: Dracula green (the user's colour), not Dracula's usual purple. */
  accent: T24 ? '#50FA7B' : '#5FFF87'
}

// Powerline ramp, dark → light. Truecolor: Dracula canvas tones up to Comment
// blue; 256 colours: exact xterm greys (identical under both downgrades).
export const PL_GRAYS = T24
  ? ['#191A21', '#21222C', '#282A36', '#2E303E', '#343746', '#3B3E50', '#44475A', '#4F5268', '#595D78', '#6272A4']
  : ['#1C1C1C', '#262626', '#303030', '#3A3A3A', '#444444', '#4E4E4E', '#585858', '#626262', '#6C6C6C', '#767676']

export const plGray = (i: number) => PL_GRAYS[Math.max(0, Math.min(PL_GRAYS.length - 1, Math.round(i)))]!

export const plIsLight = (bg: string) => {
  const n = parseInt(bg.slice(1), 16)

  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150
}

/** Text colour that reads on `bg`. */
export const plInk = (_bg: string) => '#FFFFFF'

export type PlTone = 'accent' | 'err' | 'warn'

/** Accent / alarm text colour tuned for a dark or a light grey background. */
export const plTone = (tone: PlTone, bg: string, edge = PLP_CONF.edge ?? '#50FA7B') =>
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
  sepW: PLP_CONF.edge && !PLP_CONF.edgeThin ? 2 : 1,
  /** Edge drawn as one thin chevron (default) instead of the 2-cell band. */
  thin: !!PLP_CONF.edge && PLP_CONF.edgeThin,
  /** The thin (outline) variant of a solid powerline glyph: Nerd Font keeps it at codepoint + 1. */
  thinOf: (ch: string) => {
    const cp = ch.codePointAt(0) ?? 0

    return cp >= 0xe0b0 && cp <= 0xe0c3 && cp % 2 === 0 ? String.fromCodePoint(cp + 1) : ch
  }
}

/**
 * Grey for a cell `d` steps in from its bar's OUTER edge (0 = the cell touching
 * the screen edge) in a bar of `n` cells: every bar runs dark at the edge →
 * lighter toward the middle, mirrored left/right. #262626 at the edge (one step
 * off the canvas, so it still reads as a cell) up to #767676, where white text
 * still keeps its contrast.
 */
export const plEdgeGray = (d: number, n: number) => plGray(Math.min(9, 1 + d * (n <= 4 ? 2.5 : 8 / Math.max(1, n - 1))))

/** Steps along the grey ramp for the i-th of n left-hand segments. */
export const plLeftGray = (i: number, n: number) => plEdgeGray(i, n)

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
