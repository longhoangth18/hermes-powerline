// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline · codeview — injected into components/markdown.tsx at
// build time (appended; the stock `renderTable` is renamed to
// `renderTableClassic` and the fenced-code branch calls __plCodeBlock first).
//
//   • code blocks: a filled editor panel — language chip + icon, line numbers,
//     a real multi-line tokenizer (comments/strings spanning lines, functions,
//     types, constants, decorators, shell vars/flags, JSON keys, markup tags,
//     CSS properties) for ~30 languages, soft-wrapped with a ↪ gutter;
//   • unified diffs (```diff and the inline diffs Hermes emits for patch /
//     write_file): per-file header with +N −M, old/new line numbers, tinted
//     add/remove rows, and the changed code syntax-highlighted by file type;
//   • tables: rounded box borders, bold header band, numeric columns right-aligned.
//
// HERMES_CODEVIEW=0 restores the stock renderers. Any exception inside falls
// back to the stock renderer for that block — never a broken transcript.
// ═══════════════════════════════════════════════════════════════════════

import { HY as __cvHY } from '../lib/prompt.js'

const PL_CV_ON = process.env.HERMES_CODEVIEW !== '0'
const PL_CV_MAX_W = 120

// ── palette ─────────────────────────────────────────────────────────────

interface PlCvPal {
  accent: string
  addBg: string
  addFg: string
  addGut: string
  attr: string
  bg: string
  border: string
  cnst: string
  com: string
  deco: string
  delBg: string
  delFg: string
  delGut: string
  fn: string
  gutter: string
  head: string
  headFg: string
  hunk: string
  hunkBg: string
  kw: string
  muted: string
  num: string
  op: string
  prop: string
  punc: string
  str: string
  tag: string
  text: string
  type: string
  vari: string
}

// Dracula (draculatheme.com/spec) for every token; canvas tones come from the
// shared HY theme in lib/prompt.ts, which falls back to exact xterm greys when
// Hermes runs at 256 colours (tmux / Apple Terminal), where a tinted dark would
// round to a washed-out cube grey. Accent hexes round to close neighbours.
const PL_CV_DARK: PlCvPal = {
  accent: __cvHY.purple, // language chip
  addBg: __cvHY.truecolor ? '#1A3A1A' : '#0B3B14', // OpenCode Dracula · 256: → 22
  addFg: __cvHY.green,
  addGut: __cvHY.truecolor ? '#224A22' : '#0B3B14',
  attr: __cvHY.green, // HTML attributes
  bg: __cvHY.deep, // editor panel (#21222C)
  border: __cvHY.line,
  cnst: __cvHY.purple, // true/false/null/self, ALL_CAPS
  com: __cvHY.comment,
  deco: __cvHY.green, // @decorators
  delBg: __cvHY.truecolor ? '#3A1A1A' : '#420C12', // OpenCode Dracula · 256: → 52
  delFg: __cvHY.red,
  delGut: __cvHY.truecolor ? '#4A2222' : '#420C12',
  fn: __cvHY.green, // functions / commands
  gutter: __cvHY.truecolor ? '#6272A4' : '#6C6C6C',
  head: __cvHY.line, // header band (#44475A)
  headFg: __cvHY.fg,
  hunk: __cvHY.comment,
  hunkBg: __cvHY.surface,
  kw: __cvHY.pink,
  muted: __cvHY.dim,
  num: __cvHY.orange, // spec: numbers/booleans orange
  op: __cvHY.pink,
  prop: __cvHY.fg,
  punc: __cvHY.truecolor ? '#C0C4D6' : '#BCBCBC',
  str: __cvHY.yellow,
  tag: __cvHY.pink,
  text: __cvHY.fg,
  type: __cvHY.cyan, // classes / types (italic)
  vari: __cvHY.orange // shell $vars / flags
}

const PL_CV_LIGHT: PlCvPal = {
  accent: '#008700', //  28
  addBg: '#D7FFD7', //  194
  addFg: '#005F00', //   22
  addGut: '#AFFFAF', // 157
  attr: '#005FAF', //    25
  bg: '#EEEEEE', //     255
  border: '#A8A8A8', // 248
  cnst: '#5F00AF', //    55
  com: '#808080', //    244
  deco: '#875F00', //    94
  delBg: '#FFD7D7', //  224
  delFg: '#AF0000', //  124
  delGut: '#FFAFAF', // 217
  fn: '#005FAF', //      25
  gutter: '#8A8A8A', // 245
  head: '#DADADA', //   253
  headFg: '#262626', // 235
  hunk: '#585858', //   240
  hunkBg: '#E4E4E4', // 254
  kw: '#AF005F', //     125
  muted: '#585858', //  240
  num: '#AF5F00', //    130
  op: '#AF005F', //     125
  prop: '#005F87', //    24
  punc: '#585858', //   240
  str: '#005F00', //     22
  tag: '#AF005F', //    125
  text: '#1C1C1C', //   234
  type: '#5F00AF', //    55
  vari: '#AF5F00' //    130
}

const plCvLum = (hex: string): number => {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim())

  if (!m) {
    return 0.8
  }

  const n = parseInt(m[1]!, 16)

  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

// Light theme ⇔ the theme's body text is dark.
const plCvPal = (t: Theme): PlCvPal => (plCvLum(t.color.text) < 0.45 ? PL_CV_LIGHT : PL_CV_DARK)

// ── languages ───────────────────────────────────────────────────────────

type PlCvKind =
  | 'attr'
  | 'cnst'
  | 'com'
  | 'deco'
  | 'fn'
  | 'kw'
  | 'num'
  | 'op'
  | 'prop'
  | 'punc'
  | 'str'
  | 'tag'
  | 'text'
  | 'type'
  | 'vari'

type PlCvSeg = [PlCvKind, string]

interface PlCvLang {
  block?: [string, string]
  ci?: boolean
  deco?: boolean
  family?: 'css' | 'json' | 'markup' | 'yaml' | 'ini' | 'docker' | 'make'
  kw: Set<string>
  line: string[]
  lit: Set<string>
  quotes: string
  shell?: boolean
  triple?: boolean
  types: Set<string>
}

const plW = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const PL_LIT_C = plW('true false null nullptr NULL undefined NaN Infinity this self super')
const PL_TYPES_C = plW(
  'int long short char float double void bool boolean byte string String number any unknown never object symbol bigint ' +
    'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 str Vec Option Result Box usize size_t uint8_t uint32_t ' +
    'int32_t int64_t uint64_t auto var let const unsigned signed Map Set Array Promise Record Partial'
)

const PL_KW_TS = plW(
  'abstract as async await break case catch class const continue debugger default delete do else enum export extends ' +
    'finally for from function get if implements import in instanceof interface is keyof let new of package private ' +
    'protected public readonly return satisfies set static switch throw try type typeof var void while with yield declare namespace module'
)

const PL_KW_PY = plW(
  'and as assert async await break class continue def del elif else except finally for from global if import in is ' +
    'lambda nonlocal not or pass raise return try while with yield match case'
)

const PL_KW_SH = plW(
  'if then else elif fi for in do done while until case esac function return break continue local export readonly ' +
    'declare typeset select time source alias unset shift exit trap set eval exec'
)

const PL_KW_GO = plW(
  'break case chan const continue default defer else fallthrough for func go goto if import interface map package range ' +
    'return select struct switch type var'
)

const PL_KW_RUST = plW(
  'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref ' +
    'return static struct trait type unsafe use where while yield'
)

const PL_KW_C = plW(
  'auto break case catch class const constexpr continue default delete do else enum explicit extern for friend goto if ' +
    'inline mutable namespace new noexcept operator private protected public register return sizeof static struct switch ' +
    'template throw try typedef typename union using virtual volatile while include define ifdef ifndef endif pragma'
)

const PL_KW_JAVA = plW(
  'abstract assert break case catch class const continue default do else enum extends final finally for goto if ' +
    'implements import instanceof interface native new package private protected public return static strictfp super ' +
    'switch synchronized throw throws transient try volatile while record sealed permits var yield ' +
    // C# / Kotlin / Swift / Dart overlap
    'fun val object companion data override open internal when is in out func let guard defer extension protocol ' +
    'struct init deinit inout mutating where using namespace async await readonly ref out params base lock foreach get set'
)

const PL_KW_PHP = plW(
  'abstract and array as break callable case catch class clone const continue declare default do echo else elseif ' +
    'empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global ' +
    'goto if implements include include_once instanceof insteadof interface isset list match namespace new or print ' +
    'private protected public readonly require require_once return static switch throw trait try unset use var while xor yield'
)

const PL_KW_RB = plW(
  'alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue ' +
    'retry return self super then undef unless until when while yield attr_reader attr_accessor require puts'
)

const PL_KW_LUA = plW('and break do else elseif end for function goto if in local not or repeat return then until while')

const PL_KW_SQL = plW(
  'select from where and or not in is null as by group order limit offset insert into values update set delete create ' +
    'table drop alter add column primary key foreign references join left right inner outer full cross on distinct ' +
    'having union all exists between like ilike case when then else end index view with returning default constraint ' +
    'unique check begin commit rollback transaction grant revoke asc desc count sum avg min max'
)

const PL_KW_PS = plW(
  'begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function ' +
    'if in param process return switch throw trap try until using var while'
)

const PL_KW_DOCKER = plW(
  'FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS'
)

const plLang = (over: Partial<PlCvLang> & { kw: Set<string> }): PlCvLang => ({
  line: [],
  lit: PL_LIT_C,
  quotes: `"'`,
  types: PL_TYPES_C,
  ...over
})

const PL_C_LIKE = { block: ['/*', '*/'] as [string, string], line: ['//'] }

const PL_LANGS: Record<string, PlCvLang> = {
  c: plLang({ ...PL_C_LIKE, kw: PL_KW_C }),
  cs: plLang({ ...PL_C_LIKE, deco: false, kw: PL_KW_JAVA }),
  css: plLang({ block: ['/*', '*/'], family: 'css', kw: plW('@media @import @font-face @keyframes @supports @layer !important') }),
  docker: plLang({ family: 'docker', kw: PL_KW_DOCKER, line: ['#'], shell: true }),
  go: plLang({ ...PL_C_LIKE, kw: PL_KW_GO, lit: plW('true false nil iota'), quotes: '"\'`' }),
  html: plLang({ family: 'markup', kw: new Set() }),
  ini: plLang({ family: 'ini', kw: new Set(), line: ['#', ';'] }),
  java: plLang({ ...PL_C_LIKE, deco: true, kw: PL_KW_JAVA }),
  json: plLang({ ...PL_C_LIKE, family: 'json', kw: new Set(), lit: plW('true false null') }),
  lua: plLang({ block: ['--[[', ']]'], kw: PL_KW_LUA, line: ['--'], lit: plW('true false nil self') }),
  make: plLang({ family: 'make', kw: plW('ifeq ifneq ifdef ifndef else endif include define endef export override'), line: ['#'], shell: true }),
  php: plLang({ ...PL_C_LIKE, kw: PL_KW_PHP, line: ['//', '#'], shell: true }),
  ps1: plLang({ block: ['<#', '#>'], ci: true, kw: PL_KW_PS, line: ['#'], lit: plW('$true $false $null'), shell: true }),
  py: plLang({ deco: true, kw: PL_KW_PY, line: ['#'], lit: plW('True False None self cls'), triple: true, types: plW('int str float bool list dict set tuple bytes object type Any Optional List Dict Tuple Callable Iterable Iterator Union') }),
  rb: plLang({ block: ['=begin', '=end'], kw: PL_KW_RB, line: ['#'], lit: plW('true false nil self'), shell: true }),
  rust: plLang({ ...PL_C_LIKE, deco: false, kw: PL_KW_RUST, lit: plW('true false self Self None Some Ok Err') }),
  sh: plLang({ kw: PL_KW_SH, line: ['#'], lit: plW('true false'), quotes: `"'\``, shell: true, types: new Set() }),
  sql: plLang({ block: ['/*', '*/'], ci: true, kw: PL_KW_SQL, line: ['--'], lit: plW('true false null') }),
  ts: plLang({ ...PL_C_LIKE, deco: true, kw: PL_KW_TS, quotes: '"\'`' }),
  yaml: plLang({ family: 'yaml', kw: new Set(), line: ['#'], lit: plW('true false null yes no on off ~') })
}

const PL_ALIAS: Record<string, string> = {
  bash: 'sh', 'c#': 'cs', 'c++': 'cpp', cc: 'cpp', cfg: 'ini', cjs: 'ts', conf: 'ini', console: 'sh', cpp: 'c', csharp: 'cs',
  cxx: 'cpp', dart: 'java', dockerfile: 'docker', dotenv: 'ini', env: 'ini', fish: 'sh', h: 'c', hpp: 'cpp', htm: 'html',
  javascript: 'ts', js: 'ts', json5: 'json', jsonc: 'json', jsx: 'ts', kotlin: 'java', kt: 'java', kts: 'java', less: 'css',
  makefile: 'make', mjs: 'ts', mts: 'ts', php: 'php', plist: 'html', powershell: 'ps1', properties: 'ini', psm1: 'ps1',
  pwsh: 'ps1', py3: 'py', pyi: 'py', python: 'py', rb: 'rb', rs: 'rust', ruby: 'rb', sass: 'css', scala: 'java',
  scss: 'css', shell: 'sh', shellsession: 'sh', svelte: 'html', svg: 'html', swift: 'java', terraform: 'ini', tf: 'ini',
  toml: 'ini', tsx: 'ts', typescript: 'ts', vue: 'html', xml: 'html', yml: 'yaml', zsh: 'sh', zshrc: 'sh', bashrc: 'sh',
  gradle: 'java', groovy: 'java', proto: 'c', graphql: 'ts', gql: 'ts', ex: 'rb', exs: 'rb', r: 'py', jl: 'py', nim: 'py'
}

const plCvCanon = (lang: string): string => {
  const l = lang.toLowerCase()

  return PL_ALIAS[l] ?? l
}

const plCvLangOf = (lang: string): null | PlCvLang => PL_LANGS[plCvCanon(lang)] ?? null

// Language chip: Nerd Font icon (verified in JetBrainsMono NF) + label.
const PL_CV_ICON: Record<string, string> = {
  c: '\u{f0671}', cpp: '\u{f0672}', cs: '\u{f031b}', css: '\u{f031c}', diff: '\u{f055a}', docker: '\u{f0868}',
  go: '\u{f07d3}', html: '\u{f031d}', ini: '\u{f0493}', java: '\u{f0b37}', json: '\u{f0626}', lua: '\u{f08b1}',
  make: '\u{f1064}', md: '\u{f0354}', php: '\u{f031f}', ps1: '\u{f0a0a}', py: '\u{f0320}', rb: '\u{f0d2d}',
  rust: '\u{f1617}', sh: '\u{f1183}', sql: '\u{f01bc}', ts: '\u{f06e6}', yaml: '\u{f0493}'
}

const PL_CV_ICON_RAW: Record<string, string> = {
  javascript: '\u{f031e}', js: '\u{f031e}', jsx: '\u{f031e}', kotlin: '\u{f1219}', kt: '\u{f1219}', markdown: '\u{f0354}',
  md: '\u{f0354}', swift: '\u{f06e5}', xml: '\u{f05c0}', r: '\u{f07d4}', haskell: '\u{f0c92}', hs: '\u{f0c92}', text: '\u{f09a8}',
  txt: '\u{f09a8}', log: '\u{f09a8}', output: '\u{f07b7}', console: '\u{f07b7}'
}

const plCvIcon = (lang: string) =>
  PL_CV_ICON_RAW[lang.toLowerCase()] ?? PL_CV_ICON[plCvCanon(lang)] ?? (lang ? '\u{f022e}' : '\u{f0169}')

// File extension → language (diff headers, `lang:path` fences).
const plCvLangFromPath = (path: string): string => {
  const base = path.split('/').pop() ?? ''
  const lower = base.toLowerCase()

  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) {
    return 'docker'
  }

  if (lower === 'makefile' || lower === 'gnumakefile') {
    return 'make'
  }

  if (lower.startsWith('.') && !lower.slice(1).includes('.')) {
    return PL_ALIAS[lower.slice(1)] ? lower.slice(1) : lower.includes('rc') ? 'sh' : 'ini'
  }

  const ext = lower.includes('.') ? lower.split('.').pop()! : ''

  return ext
}

// ── tokenizer ───────────────────────────────────────────────────────────

interface PlCvState {
  // Inside a block comment / multi-line string: its closing delimiter.
  close: null | string
  kind: PlCvKind
  inTag?: boolean
}

const PL_NUM_RE = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/
const PL_ID_RE = /^[A-Za-z_$À-￿][\w$À-￿]*/
const PL_OPS = '=+-*/%<>!&|^~?:'
const PL_PUNC = '()[]{},.;'

function plCvClassifyId(
  word: string,
  lang: PlCvLang,
  line: string,
  start: number,
  end: number,
  firstWord: boolean
): PlCvKind {
  const key = lang.ci ? word.toLowerCase() : word
  const next = line.slice(end).match(/^\s*(.)/)?.[1] ?? ''
  const prev = line.slice(0, start).match(/(.)\s*$/)?.[1] ?? ''

  if (lang.kw.has(key) || (lang.ci && lang.kw.has(word.toUpperCase()))) {
    return 'kw'
  }

  // Name being defined: `def foo`, `function foo`, `fn foo`, `func foo` → function;
  // `class Foo`, `struct Foo`, `interface Foo`, `type Foo` → type.
  const before = line.slice(0, start).match(/(\w+)\s+$/)?.[1]

  if (before && /^(def|function|fn|func|fun|sub|proc|method)$/.test(before)) {
    return 'fn'
  }

  if (before && /^(class|struct|interface|type|enum|trait|record|union|impl|object|protocol)$/.test(before)) {
    return 'type'
  }

  if (lang.lit.has(word)) {
    return 'cnst'
  }

  if (lang.shell && firstWord && !lang.family) {
    return 'fn'
  }

  if (next === '(') {
    return 'fn'
  }

  if (prev === '.' && word !== '') {
    return 'prop'
  }

  if (lang.types.has(word)) {
    return 'type'
  }

  if (word.length > 1 && /^[A-Z][A-Z0-9_]+$/.test(word)) {
    return 'cnst'
  }

  if (/^[A-Z][a-z0-9]/.test(word)) {
    return 'type'
  }

  return 'text'
}

/** Tokenize a whole block (state carries across lines). Never throws on odd input. */
function plCvTokenize(lines: string[], langName: string): PlCvSeg[][] {
  const lang = plCvLangOf(langName)

  if (!lang) {
    return lines.map(l => [['text', l] as PlCvSeg])
  }

  const st: PlCvState = { close: null, kind: 'text' }

  return lines.map(line => plCvLine(line, lang, st))
}

function plCvLine(line: string, lang: PlCvLang, st: PlCvState): PlCvSeg[] {
  const out: PlCvSeg[] = []
  const push = (kind: PlCvKind, text: string) => {
    if (!text) {
      return
    }

    const last = out[out.length - 1]

    if (last && last[0] === kind) {
      last[1] += text
    } else {
      out.push([kind, text])
    }
  }

  let i = 0
  let firstWord = true

  // Continue a block comment / multi-line string from a previous line.
  if (st.close) {
    const end = line.indexOf(st.close)

    if (end < 0) {
      push(st.kind, line)

      return out
    }

    push(st.kind, line.slice(0, end + st.close.length))
    i = end + st.close.length
    st.close = null
  }

  // Line-shaped families first.
  if (lang.family === 'yaml' && i === 0) {
    const m = line.match(/^(\s*)(- )?([^#'"\s][^:#]*?)(:)(\s|$)/)

    if (m) {
      push('text', m[1]!)
      push('punc', m[2] ?? '')
      push('prop', m[3]!)
      push('punc', m[4]!)
      i = m[0].length - (m[5] ? m[5].length : 0)
      firstWord = false
    } else {
      const d = line.match(/^(\s*)(- )/)

      if (d) {
        push('text', d[1]!)
        push('punc', d[2]!)
        i = d[0].length
      }
    }
  }

  if (lang.family === 'ini' && i === 0) {
    const sec = line.match(/^(\s*)(\[[^\]]*\])(.*)$/)

    if (sec) {
      push('text', sec[1]!)
      push('type', sec[2]!)
      i = sec[1]!.length + sec[2]!.length
    } else {
      const kv = line.match(/^(\s*)([\w.\-"]+)(\s*)([=:])/)

      if (kv) {
        push('text', kv[1]!)
        push('prop', kv[2]!)
        push('text', kv[3]!)
        push('op', kv[4]!)
        i = kv[0].length
      }
    }
  }

  if (lang.family === 'docker' && i === 0) {
    const m = line.match(/^(\s*)([A-Za-z]+)(\s|$)/)

    if (m && PL_KW_DOCKER.has(m[2]!.toUpperCase())) {
      push('text', m[1]!)
      push('kw', m[2]!)
      i = m[1]!.length + m[2]!.length
      firstWord = false
    }
  }

  if (lang.family === 'make' && i === 0) {
    const m = line.match(/^([\w.%/\-$() ]+?)(::?)(?!=)/)

    if (m && !line.startsWith('\t')) {
      push('fn', m[1]!)
      push('op', m[2]!)
      i = m[0].length
    }
  }

  if (lang.family === 'markup') {
    plCvMarkup(line.slice(i), st, push)

    return out
  }

  let braceDepth = 0

  while (i < line.length) {
    const rest = line.slice(i)
    const ch = line[i]!

    // Block comment open.
    if (lang.block && rest.startsWith(lang.block[0]) && !(lang.block[0] === '=begin' && i > 0)) {
      const end = line.indexOf(lang.block[1], i + lang.block[0].length)

      if (end < 0) {
        push('com', rest)
        st.close = lang.block[1]
        st.kind = 'com'

        return out
      }

      push('com', line.slice(i, end + lang.block[1].length))
      i = end + lang.block[1].length
      continue
    }

    // Line comment (shell-ish `#` only at a word start, so `$#` / `a#b` stay code).
    const lc = lang.line.find(p => rest.startsWith(p))

    if (lc && (lc !== '#' || !lang.shell || i === 0 || /\s/.test(line[i - 1]!))) {
      push('com', rest)

      return out
    }

    // Triple-quoted strings (Python docstrings) may span lines.
    if (lang.triple && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const q = rest.slice(0, 3)
      const end = line.indexOf(q, i + 3)

      if (end < 0) {
        push('str', rest)
        st.close = q
        st.kind = 'str'

        return out
      }

      push('str', line.slice(i, end + 3))
      i = end + 3
      continue
    }

    // Strings.
    if (lang.quotes.includes(ch)) {
      let j = i + 1

      while (j < line.length && line[j] !== ch) {
        j += line[j] === '\\' ? 2 : 1
      }

      if (j >= line.length && ch === '`') {
        push('str', rest)
        st.close = '`'
        st.kind = 'str'

        return out
      }

      const s = line.slice(i, Math.min(j + 1, line.length))
      const isKey = (lang.family === 'json' || lang.family === 'yaml') && /^\s*:/.test(line.slice(j + 1))

      push(isKey ? 'prop' : 'str', s)
      i += s.length
      firstWord = false
      continue
    }

    // Shell variables: $VAR, ${...}, $(...) opener, $1, $@ …
    if (lang.shell && ch === '$') {
      const m = rest.match(/^\$(?:\{[^}]*\}|[A-Za-z_][\w]*|[@*#?$!0-9-]|\()/)

      if (m) {
        push('vari', m[0])
        i += m[0].length
        continue
      }
    }

    // Shell flags: -x / --long-flag after whitespace.
    if (lang.shell && ch === '-' && (i === 0 || /\s/.test(line[i - 1]!))) {
      const m = rest.match(/^--?[A-Za-z][\w-]*/)

      if (m) {
        push('vari', m[0])
        i += m[0].length
        continue
      }
    }

    // Decorators / annotations.
    if (ch === '@' && lang.deco) {
      const m = rest.match(/^@[\w.]+/)

      if (m) {
        push('deco', m[0])
        i += m[0].length
        continue
      }
    }

    // CSS: hex colours, @rules, properties, selectors.
    if (lang.family === 'css') {
      const hex = rest.match(/^#[\da-fA-F]{3,8}\b/)

      if (hex && braceDepth > 0) {
        push('num', hex[0])
        i += hex[0].length
        continue
      }

      const at = rest.match(/^@[\w-]+/)

      if (at) {
        push('kw', at[0])
        i += at[0].length
        continue
      }

      const prop = rest.match(/^[\w-]+(?=\s*:)/)

      if (prop && (braceDepth > 0 || /^\s/.test(line))) {
        push('prop', prop[0])
        i += prop[0].length
        continue
      }

      const sel = rest.match(/^[.#]?[\w-]+/)

      if (sel && braceDepth === 0 && !/^\s/.test(line)) {
        push(sel[0][0] === '.' || sel[0][0] === '#' ? 'fn' : 'tag', sel[0])
        i += sel[0].length
        continue
      }
    }

    // Numbers (not glued to an identifier).
    if (/\d/.test(ch) && (i === 0 || !/[\w$]/.test(line[i - 1]!))) {
      const m = rest.match(PL_NUM_RE)

      if (m) {
        push('num', m[0])
        i += m[0].length
        firstWord = false
        continue
      }
    }

    // Identifiers.
    const id = rest.match(lang.family === 'css' ? /^[\w-]+/ : PL_ID_RE)

    if (id) {
      const word = id[0]
      // Shell: words after |, &&, ;, sudo are commands too.
      const cmdStart =
        lang.shell && (firstWord || /(?:^|[|;&(]|\bsudo|\bexec|\btime)\s*$/.test(line.slice(0, i)))

      push(plCvClassifyId(word, lang, line, i, i + word.length, !!cmdStart), word)
      i += word.length
      firstWord = false
      continue
    }

    if (ch === '{') {
      braceDepth++
    } else if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
    }

    if (PL_OPS.includes(ch)) {
      push('op', ch)
    } else if (PL_PUNC.includes(ch)) {
      push('punc', ch)
    } else {
      push('text', ch)
    }

    if (!/\s/.test(ch)) {
      firstWord = lang.shell ? /[|;&]/.test(ch) : false
    }

    i++
  }

  return out
}

// HTML / XML / SVG / Vue: comments, tags, attributes, strings, entities.
function plCvMarkup(line: string, st: PlCvState, push: (k: PlCvKind, s: string) => void) {
  let i = 0

  while (i < line.length) {
    const rest = line.slice(i)

    if (st.close === '-->' || rest.startsWith('<!--')) {
      const from = st.close ? 0 : 4
      const end = rest.indexOf('-->', from)

      if (end < 0) {
        push('com', rest)
        st.close = '-->'
        st.kind = 'com'

        return
      }

      push('com', rest.slice(0, end + 3))
      st.close = null
      i += end + 3
      continue
    }

    if (!st.inTag) {
      const open = rest.match(/^<\/?[\w:.-]+|^<!\w+|^<\?\w+/)

      if (open) {
        push('punc', open[0].startsWith('</') ? '</' : '<')
        push('tag', open[0].replace(/^<\/?/, ''))
        st.inTag = true
        i += open[0].length
        continue
      }

      const ent = rest.match(/^&[#\w]+;/)

      if (ent) {
        push('cnst', ent[0])
        i += ent[0].length
        continue
      }

      const txt = rest.match(/^[^<&]+/)

      push('text', txt ? txt[0] : rest[0]!)
      i += txt ? txt[0].length : 1
      continue
    }

    const close = rest.match(/^\/?>|^\?>/)

    if (close) {
      push('punc', close[0])
      st.inTag = false
      i += close[0].length
      continue
    }

    const str = rest.match(/^"[^"]*"?|^'[^']*'?/)

    if (str) {
      push('str', str[0])
      i += str[0].length
      continue
    }

    const attr = rest.match(/^[@:#]?[\w:.\-[\]()]+/)

    if (attr) {
      push('attr', attr[0])
      i += attr[0].length
      continue
    }

    push(rest[0] === '=' ? 'op' : 'text', rest[0]!)
    i++
  }
}

// ── layout helpers ──────────────────────────────────────────────────────

const plCvColor = (k: PlCvKind, p: PlCvPal): string => (k === 'text' ? p.text : (p as unknown as Record<string, string>)[k]!)

const plCvExpandTabs = (s: string) => s.replace(/\t/g, '    ')

/** Soft-wrap a token row into rows of at most `w` display cells. */
function plCvWrap(segs: PlCvSeg[], w: number): PlCvSeg[][] {
  const rows: PlCvSeg[][] = [[]]
  let used = 0

  for (const [kind, raw] of segs) {
    let buf = ''

    for (const g of raw) {
      const gw = Math.max(0, stringWidth(g))

      if (used + gw > w && used > 0) {
        if (buf) {
          rows[rows.length - 1]!.push([kind, buf])
        }

        rows.push([])
        buf = ''
        used = 0
      }

      buf += g
      used += gw
    }

    if (buf) {
      rows[rows.length - 1]!.push([kind, buf])
    }
  }

  return rows
}

const plCvSegWidth = (segs: PlCvSeg[]) => segs.reduce((n, [, s]) => n + stringWidth(s), 0)

const plCvPad = (n: number) => (n > 0 ? ' '.repeat(n) : '')

function PlCvRow({
  bg,
  gutter,
  gutterBg,
  gutterFg,
  pal,
  segs,
  width,
  marker,
  markerFg,
  dim
}: {
  bg: string
  dim?: boolean
  gutter: string
  gutterBg?: string
  gutterFg: string
  marker?: string
  markerFg?: string
  pal: PlCvPal
  segs: PlCvSeg[]
  width: number
}) {
  const used = stringWidth(gutter) + (marker ? stringWidth(marker) : 0) + plCvSegWidth(segs)

  return (
    <Text>
      <Text backgroundColor={gutterBg ?? bg} color={gutterFg}>
        {gutter}
      </Text>
      {marker ? (
        <Text backgroundColor={bg} bold color={markerFg ?? gutterFg}>
          {marker}
        </Text>
      ) : null}
      {segs.map(([kind, s], i) => (
        <Text
          backgroundColor={bg}
          bold={kind === 'kw' || kind === 'tag'}
          color={plCvColor(kind, pal)}
          dimColor={dim}
          italic={kind === 'com' || kind === 'type' || kind === 'deco' || kind === 'cnst'}
          key={i}
        >
          {s}
        </Text>
      ))}
      <Text backgroundColor={bg}>{plCvPad(width - used)}</Text>
    </Text>
  )
}

function PlCvHeader({
  icon,
  label,
  pal,
  right,
  width
}: {
  icon: string
  label: string
  pal: PlCvPal
  right: { color: string; text: string }[]
  width: number
}) {
  const chip = ` ${icon}  ${label} `
  const rightW = right.reduce((n, r) => n + stringWidth(r.text), 0)
  const fill = Math.max(1, width - stringWidth(chip) - rightW - 1)

  return (
    <Text>
      <Text backgroundColor={pal.accent} bold color={pal === PL_CV_DARK ? __cvHY.deeper : '#FFFFFF'}>
        {chip}
      </Text>
      <Text backgroundColor={pal.head}>{plCvPad(fill)}</Text>
      {right.map((r, i) => (
        <Text backgroundColor={pal.head} color={r.color} key={i}>
          {r.text}
        </Text>
      ))}
      <Text backgroundColor={pal.head}> </Text>
    </Text>
  )
}

const plCvWidth = (cols: number | undefined) => Math.max(36, Math.min(PL_CV_MAX_W, (cols ?? 100) - 4))

// ── code block ──────────────────────────────────────────────────────────

function plCvCodePanel(block: string[], langRaw: string, t: Theme, cols: number | undefined, key: number): ReactNode {
  const pal = plCvPal(t)
  const width = plCvWidth(cols)
  // `lang:path` / `lang path` / `lang title="path"` fences carry a file name.
  const info = langRaw.trim()
  const m = info.match(/^([\w#+.-]+)(?:[:\s]+(?:title=)?["']?([^"'\s]+)["']?)?/)
  let lang = m?.[1] ?? ''
  const file = m?.[2] ?? ''

  if (!lang && file) {
    lang = plCvLangFromPath(file)
  }

  const lines = block.map(plCvExpandTabs)

  // Drop one trailing empty line (common in model output).
  while (lines.length > 1 && !lines[lines.length - 1]!.trim()) {
    lines.pop()
  }

  const tokens = plCvTokenize(lines, lang)
  const numW = Math.max(2, String(lines.length).length)
  const showNums = lines.length > 1
  const gutterW = showNums ? numW + 3 : 2
  const codeW = Math.max(8, width - gutterW - 1)
  const label = file ? `${lang || 'text'} · ${file}` : lang || 'code'
  const right = [{ color: pal.muted, text: `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}` }]
  const rows: ReactNode[] = []

  tokens.forEach((segs, li) => {
    plCvWrap(segs, codeW).forEach((part, pi) => {
      const g = !showNums ? '  ' : pi === 0 ? ` ${String(li + 1).padStart(numW)} ` : ` ${'↪'.padStart(numW)} `

      rows.push(
        <PlCvRow
          bg={pal.bg}
          gutter={g + (showNums ? '│' : '')}
          gutterFg={pal.gutter}
          key={`${li}.${pi}`}
          pal={pal}
          segs={[['text', ' '], ...part]}
          width={width}
        />
      )
    })
  })

  return (
    <Box flexDirection="column" key={key} marginY={0} paddingLeft={2}>
      <PlCvHeader icon={plCvIcon(lang)} label={label} pal={pal} right={right} width={width} />
      {rows}
      <Text color={pal.head}>{'▀'.repeat(width)}</Text>
    </Box>
  )
}

// ── unified diff ────────────────────────────────────────────────────────

interface PlCvDiffFile {
  add: number
  del: number
  lines: { kind: 'add' | 'ctx' | 'del' | 'hunk' | 'meta'; newNo?: number; oldNo?: number; text: string }[]
  path: string
}

function plCvParseDiff(block: string[]): PlCvDiffFile[] {
  const files: PlCvDiffFile[] = []
  let cur: null | PlCvDiffFile = null
  let oldNo = 0
  let newNo = 0
  let sawHunk = false
  const ensure = () => {
    if (!cur) {
      cur = { add: 0, del: 0, lines: [], path: '' }
      files.push(cur)
    }

    return cur
  }

  for (let idx = 0; idx < block.length; idx++) {
    const raw = plCvExpandTabs(block[idx]!)

    if (raw.startsWith('diff --git ')) {
      cur = { add: 0, del: 0, lines: [], path: raw.split(' b/').pop() ?? '' }
      files.push(cur)
      sawHunk = false
      continue
    }

    // Hermes' own inline-diff header: "a/<path> → b/<path>" (paths may be absolute: "a//abs").
    const hermesHead = raw.match(/^a\/(.+?) → b\/(.+)$/)

    if (hermesHead) {
      cur = { add: 0, del: 0, lines: [], path: hermesHead[2]!.trim() }
      files.push(cur)
      sawHunk = false
      continue
    }

    if (/^(index |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)/.test(raw)) {
      continue
    }

    if (raw.startsWith('--- ') && block[idx + 1]?.startsWith('+++ ')) {
      const a = raw.slice(4).replace(/^a\//, '').split('\t')[0]!
      const b = block[idx + 1]!.slice(4).replace(/^b\//, '').split('\t')[0]!

      if (cur && (cur as PlCvDiffFile).lines.length) {
        cur = null
      }

      const f = ensure()

      f.path = b === '/dev/null' ? a : b
      sawHunk = false
      idx++
      continue
    }

    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)

    if (h) {
      oldNo = Number(h[1])
      newNo = Number(h[2])
      sawHunk = true
      ensure().lines.push({ kind: 'hunk', text: (h[3] ?? '').trim() })
      continue
    }

    const f = ensure()

    if (raw.startsWith('+')) {
      f.add++
      f.lines.push({ kind: 'add', newNo: sawHunk ? newNo++ : undefined, text: raw.slice(1) })
    } else if (raw.startsWith('-')) {
      f.del++
      f.lines.push({ kind: 'del', oldNo: sawHunk ? oldNo++ : undefined, text: raw.slice(1) })
    } else if (raw.startsWith('\\')) {
      f.lines.push({ kind: 'meta', text: raw })
    } else {
      f.lines.push({
        kind: 'ctx',
        newNo: sawHunk ? newNo++ : undefined,
        oldNo: sawHunk ? oldNo++ : undefined,
        text: raw.startsWith(' ') ? raw.slice(1) : raw
      })
    }
  }

  return files.filter(f => f.lines.length || f.path)
}

/** Header-friendly path: $HOME → ~, collapse a leading //, keep the tail when long. */
function plCvShortPath(path: string, max: number): string {
  let p = path.replace(/^\/\/+/, '/')
  const home = process.env.HOME

  if (home && p.startsWith(home)) {
    p = '~' + p.slice(home.length)
  }

  if (stringWidth(p) <= max) {
    return p
  }

  const parts = p.split('/')
  let tail = parts.pop() ?? p

  while (parts.length && stringWidth(`…/${parts[parts.length - 1]}/${tail}`) <= max) {
    tail = `${parts.pop()}/${tail}`
  }

  return `…/${tail}`
}

function plCvDiffPanel(block: string[], t: Theme, cols: number | undefined, key: number): ReactNode {
  const pal = plCvPal(t)
  const width = plCvWidth(cols)
  const files = plCvParseDiff(block)

  if (!files.length) {
    return null
  }

  const out: ReactNode[] = []

  files.forEach((f, fi) => {
    const lang = f.path ? plCvLangFromPath(f.path) : ''
    const maxNo = Math.max(0, ...f.lines.map(l => Math.max(l.oldNo ?? 0, l.newNo ?? 0)))
    const numbered = maxNo > 0
    const nw = Math.max(2, String(maxNo).length)
    const gutterW = numbered ? nw * 2 + 3 : 1
    const codeW = Math.max(8, width - gutterW - 3)
    // Highlight old and new sides as two streams so multi-line state stays coherent.
    const tokOld = plCvTokenize(f.lines.filter(l => l.kind !== 'add' && l.kind !== 'hunk' && l.kind !== 'meta').map(l => l.text), lang)
    const tokNew = plCvTokenize(f.lines.filter(l => l.kind !== 'del' && l.kind !== 'hunk' && l.kind !== 'meta').map(l => l.text), lang)
    let io = 0
    let ineu = 0
    const right = [
      { color: pal.addFg, text: `+${f.add}` },
      { color: pal.muted, text: ' ' },
      { color: pal.delFg, text: `−${f.del}` }
    ]

    out.push(
      <PlCvHeader
        icon={'\u{f055a}'}
        key={`h${fi}`}
        label={plCvShortPath(f.path, width - 24) || 'diff'}
        pal={pal}
        right={right}
        width={width}
      />
    )

    f.lines.forEach((l, li) => {
      if (l.kind === 'hunk') {
        const txt = `⋯ ${l.text}`.trimEnd()

        out.push(
          <Text key={`${fi}.${li}`}>
            <Text backgroundColor={pal.hunkBg} color={pal.hunk} italic>
              {plCvPad(gutterW) + '  ' + txt.slice(0, width - gutterW - 2) + plCvPad(width - gutterW - 2 - stringWidth(txt))}
            </Text>
          </Text>
        )

        return
      }

      if (l.kind === 'meta') {
        out.push(
          <Text backgroundColor={pal.bg} color={pal.muted} dimColor key={`${fi}.${li}`}>
            {(plCvPad(gutterW + 2) + l.text).padEnd(width)}
          </Text>
        )

        return
      }

      const segs = l.kind === 'add' ? tokNew[ineu++]! : l.kind === 'del' ? tokOld[io++]! : (io++, tokNew[ineu++]!)
      const bg = l.kind === 'add' ? pal.addBg : l.kind === 'del' ? pal.delBg : pal.bg
      const gbg = l.kind === 'add' ? pal.addGut : l.kind === 'del' ? pal.delGut : pal.bg
      const marker = l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '
      const markerFg = l.kind === 'add' ? pal.addFg : l.kind === 'del' ? pal.delFg : pal.gutter

      plCvWrap(segs ?? [['text', l.text]], codeW).forEach((part, pi) => {
        const g = numbered
          ? pi === 0
            ? ` ${l.oldNo != null ? String(l.oldNo).padStart(nw) : ' '.repeat(nw)} ${l.newNo != null ? String(l.newNo).padStart(nw) : ' '.repeat(nw)} `
            : ` ${' '.repeat(nw)} ${'↪'.padStart(nw)} `
          : ' '

        out.push(
          <PlCvRow
            bg={bg}
            dim={l.kind === 'ctx'}
            gutter={g}
            gutterBg={gbg}
            gutterFg={l.kind === 'ctx' ? pal.gutter : markerFg}
            key={`${fi}.${li}.${pi}`}
            marker={pi === 0 ? ` ${marker} ` : '   '}
            markerFg={markerFg}
            pal={pal}
            segs={part}
            width={width}
          />
        )
      })
    })

    out.push(
      <Text color={pal.head} key={`e${fi}`}>
        {'▀'.repeat(width)}
      </Text>
    )
  })

  return (
    <Box flexDirection="column" key={key} paddingLeft={2}>
      {out}
    </Box>
  )
}

/** Entry from the fenced-code branch. null → let the stock renderer draw it. */
function __plCodeBlock(block: string[], lang: string, t: Theme, cols: number | undefined, key: number): null | ReactNode {
  if (!PL_CV_ON) {
    return null
  }

  try {
    const canon = plCvCanon(lang.split(/[:\s]/)[0] ?? '')

    if (canon === 'diff' || canon === 'patch' || canon === 'udiff') {
      return plCvDiffPanel(block, t, cols, key)
    }

    // An unlabelled block that is clearly a unified diff gets the diff view too.
    if (!lang.trim() && block.some(l => l.startsWith('@@ ')) && block.some(l => /^[+-]/.test(l))) {
      return plCvDiffPanel(block, t, cols, key)
    }

    return plCvCodePanel(block, lang, t, cols, key)
  } catch {
    return null
  }
}

// ── tables ──────────────────────────────────────────────────────────────

const PL_TB_NUM_RE = /^[-+]?(?:[$€£¥₫]\s?)?[\d.,]+\s?(?:%|[kKmMbBgGtT][bB]?|ms|s|x|đ|₫|\$)?$/

function plTbWrap(text: string, w: number): string[] {
  const out: string[] = []
  let line = ''

  const flush = () => {
    out.push(line)
    line = ''
  }

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const ww = stringWidth(word)

    if (ww > w) {
      if (line) {
        flush()
      }

      let chunk = ''

      for (const g of word) {
        if (stringWidth(chunk + g) > w) {
          out.push(chunk)
          chunk = ''
        }

        chunk += g
      }

      line = chunk
      continue
    }

    if (!line) {
      line = word
    } else if (stringWidth(line) + 1 + ww <= w) {
      line += ' ' + word
    } else {
      flush()
      line = word
    }
  }

  if (line || !out.length) {
    flush()
  }

  return out
}

function renderTable(k: number, rows: string[][], t: Theme, cols?: number): ReactNode {
  if (!PL_CV_ON) {
    return renderTableClassic(k, rows, t, cols)
  }

  try {
    if (!rows.length || !rows[0]!.length) {
      return null
    }

    const pal = plCvPal(t)
    const n = rows[0]!.length
    const norm = rows.map(r => (r.length >= n ? r.slice(0, n) : [...r, ...Array<string>(n - r.length).fill('')]))
    const plain = norm.map(r => r.map(c => stripInlineMarkup(c).trim()))
    const ideal = plain[0]!.map((_, ci) => Math.max(1, ...plain.map(r => stringWidth(r[ci]!))))
    const minW = plain[0]!.map((_, ci) =>
      Math.min(14, Math.max(3, ...plain.map(r => Math.max(0, ...r[ci]!.split(/\s+/).map(w => stringWidth(w))))))
    )
    // 2 = paddingLeft; per column: 1 border + 2 padding; +1 closing border.
    const avail = Math.min((cols ?? 100) - 2, PL_CV_MAX_W) - (n * 3 + 1)
    const sumIdeal = ideal.reduce((a, b) => a + b, 0)
    const sumMin = minW.reduce((a, b) => a + b, 0)

    if (avail < sumMin) {
      return renderTableClassic(k, rows, t, cols)
    }

    let widths = ideal

    if (sumIdeal > avail) {
      const extra = avail - sumMin
      const over = ideal.map((w, i) => Math.max(0, w - minW[i]!))
      const totalOver = over.reduce((a, b) => a + b, 0) || 1

      widths = minW.map((m, i) => m + Math.floor((over[i]! / totalOver) * extra))
    }

    const numeric = plain[0]!.map((_, ci) => {
      const body = plain.slice(1).map(r => r[ci]!).filter(Boolean)

      return body.length > 0 && body.every(c => PL_TB_NUM_RE.test(c))
    })

    const B = pal.border
    const rule = (l: string, m: string, r: string) => (
      <Text color={B}>{l + widths.map(w => '─'.repeat(w + 2)).join(m) + r}</Text>
    )

    const drawRow = (ri: number) => {
      const isHead = ri === 0
      const cells = plain[ri]!.map((c, ci) => plTbWrap(c, widths[ci]!))
      const height = Math.max(...cells.map(c => c.length))
      const lines: ReactNode[] = []

      for (let li = 0; li < height; li++) {
        lines.push(
          <Text key={li}>
            <Text color={B}>│</Text>
            {cells.map((c, ci) => {
              const txt = c[li] ?? ''
              const pad = widths[ci]! - stringWidth(txt)
              const right = numeric[ci] && !isHead
              const single = height === 1 && !isHead && stringWidth(stripInlineMarkup(norm[ri]![ci]!)) <= widths[ci]!

              return (
                <Text key={ci}>
                  <Text backgroundColor={isHead ? pal.head : undefined}>
                    {' ' + (right ? plCvPad(pad) : '')}
                  </Text>
                  {single ? (
                    <MdInline t={t} text={norm[ri]![ci]!.trim()} />
                  ) : (
                    <Text backgroundColor={isHead ? pal.head : undefined} bold={isHead} color={isHead ? pal.accent : t.color.text}>
                      {txt}
                    </Text>
                  )}
                  <Text backgroundColor={isHead ? pal.head : undefined}>{(right ? '' : plCvPad(pad)) + ' '}</Text>
                    <Text backgroundColor={isHead && ci < cells.length - 1 ? pal.head : undefined} color={B}>
                    │
                  </Text>
                </Text>
              )
            })}
          </Text>
        )
      }

      return lines
    }

    return (
      <Box flexDirection="column" key={k} paddingLeft={2}>
        {rule('╭', '┬', '╮')}
        {drawRow(0)}
        {rule('├', '┼', '┤')}
        {norm.slice(1).map((_, i) => (
          <Fragment key={i}>{drawRow(i + 1)}</Fragment>
        ))}
        {rule('╰', '┴', '╯')}
      </Box>
    )
  } catch {
    return renderTableClassic(k, rows, t, cols)
  }
}

// ── markdown (Dracula) ──────────────────────────────────────────────────
// Headings, rules, bullets, numbers, quotes, inline code, bold and italic are
// routed here by one-line inserts in markdown.tsx. HERMES_CODEVIEW=0 → stock look.

const plMdDark = (t: Theme) => plCvLum(t.color.text) >= 0.45

const __plMd = (t: Theme) =>
  plMdDark(t)
    ? {
        bold: __cvHY.orange,
        bullets: [__cvHY.cyan, __cvHY.purple, __cvHY.pink],
        code: __cvHY.green,
        codeBg: __cvHY.line,
        h1: __cvHY.purple,
        h2: __cvHY.purple,
        h3: __cvHY.purple,
        h4: __cvHY.pink,
        italic: __cvHY.yellow,
        num: __cvHY.purple,
        quote: __cvHY.purple,
        quoteText: __cvHY.yellow,
        rule: __cvHY.comment,
        ruleMark: __cvHY.purple,
        done: __cvHY.green,
        todo: __cvHY.dim,
        ink: __cvHY.deeper
      }
    : {
        bold: '#AF5F00',
        bullets: ['#5F00AF', '#AF005F', '#005F87'],
        code: '#005F00',
        codeBg: '#E4E4E4',
        h1: '#5F00AF',
        h2: '#5F00AF',
        h3: '#AF005F',
        h4: '#005F87',
        italic: '#875F00',
        num: '#5F00AF',
        quote: '#5F00AF',
        quoteText: '#585858',
        rule: '#BCBCBC',
        ruleMark: '#5F00AF',
        done: '#008700',
        todo: '#8A8A8A',
        ink: '#FFFFFF'
      }

function __plHeading(level: number, text: string, t: Theme, cols: number | undefined, key: number): ReactNode {
  const md = __plMd(t)
  const width = plCvWidth(cols)

  if (level === 1) {
    const plain = stripInlineMarkup(text)
    const fill = Math.max(2, width - stringWidth(plain) - 4)

    return (
      <Box flexDirection="column" key={key} marginTop={1}>
        <Text>
          <Text backgroundColor={md.h1} bold color={md.ink}>
            {` ${plain} `}
          </Text>
          <Text color={md.h1}>{' ' + '━'.repeat(fill)}</Text>
        </Text>
      </Box>
    )
  }

  if (level === 2) {
    return (
      <Box key={key} marginTop={1}>
        <Text bold color={md.h2} wrap="wrap-trim">
          {'▍ '}
          <MdInline color={md.h2} t={t} text={text} />
        </Text>
      </Box>
    )
  }

  const color = level === 3 ? md.h3 : md.h4

  return (
    <Text bold color={color} key={key} wrap="wrap-trim">
      {level === 3 ? '◆ ' : '› '}
      <MdInline color={color} t={t} text={text} />
    </Text>
  )
}

function __plRule(t: Theme, cols: number | undefined, key: number): ReactNode {
  const md = __plMd(t)
  const w = Math.min(plCvWidth(cols), 72)
  const side = Math.max(2, Math.floor((w - 3) / 2))

  return (
    <Text key={key}>
      <Text color={md.rule}>{'─'.repeat(side)}</Text>
      <Text color={md.ruleMark}>{' ◆ '}</Text>
      <Text color={md.rule}>{'─'.repeat(side)}</Text>
    </Text>
  )
}

const __plBulletColor = (t: Theme, indent: string, task: null | RegExpMatchArray): string => {
  if (!PL_CV_ON) {
    return t.color.muted
  }

  const md = __plMd(t)

  if (task) {
    return task[1]!.toLowerCase() === 'x' ? md.done : md.todo
  }

  return md.bullets[indentDepth(indent) % md.bullets.length]!
}

const __plBullet = (marker: string, indent: string, task: null | RegExpMatchArray): string => {
  if (!PL_CV_ON) {
    return marker
  }

  if (task) {
    return task[1]!.toLowerCase() === 'x' ? '✔' : '○'
  }

  return ['●', '○', '▪'][indentDepth(indent) % 3]!
}

const __plNumColor = (t: Theme): string => (PL_CV_ON ? __plMd(t).num : t.color.muted)

const __plQuoteBar = (t: Theme): ReactNode =>
  PL_CV_ON ? <Text color={__plMd(t).quote}>{'▌ '}</Text> : '│ '

const __plQuoteColor = (t: Theme): string => (PL_CV_ON ? __plMd(t).quoteText : t.color.muted)

function __plInlineCode(code: string, t: Theme, key: number): null | ReactNode {
  if (!PL_CV_ON) {
    return null
  }

  const md = __plMd(t)

  return (
    <Text backgroundColor={md.codeBg} color={md.code} key={key}>
      {` ${code} `}
    </Text>
  )
}

const __plBoldColor = (t: Theme): string | undefined => (PL_CV_ON ? __plMd(t).bold : undefined)
const __plItalicColor = (t: Theme): string | undefined => (PL_CV_ON ? __plMd(t).italic : undefined)

// ── system notice cards ─────────────────────────────────────────────────
// Hermes injects background results as USER-role messages — e.g. the async
// delegation batch "[ASYNC DELEGATION BATCH COMPLETE — deleg_x]" with a long
// instruction paragraph for the model, per-task "--- ✓ TASK i/n: goal (…) ---"
// headers, raw JSON summaries and an "[INTERNAL NOTIFICATION …]" footer. The
// transcript shows them as a card instead: coloured edge, title + timing,
// one line per task, JSON summaries as key: value, other text as markdown.
// messageLine.tsx calls globalThis.__plNoticeCard (one optional insert).

const PL_NOTICE_HEAD_RE = /^\[([A-Z][A-Z0-9 _/-]{3,})(?:\s+[—-]\s+([^\]]+))?\]\s*$/

function plNoticeSummary(text: string, t: Theme, width: number, key: string): ReactNode {
  const s = text.trim()

  if (/^[[{]/.test(s)) {
    try {
      const v = JSON.parse(s) as unknown
      const md = __plMd(t)

      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return (
          <Box flexDirection="column" key={key}>
            {Object.entries(v as Record<string, unknown>).map(([k, val]) => (
              <Text key={k} wrap="wrap-trim">
                <Text bold color={md.h2}>
                  {k}
                </Text>
                <Text color={__cvHY.comment}>{': '}</Text>
                <Text color={typeof val === 'string' ? __cvHY.fg : md.num}>
                  {typeof val === 'string' ? val : JSON.stringify(val)}
                </Text>
              </Text>
            ))}
          </Box>
        )
      }
    } catch {
      // not JSON — fall through to markdown
    }
  }

  return <Md cols={width} key={key} t={t} text={s} />
}

function __plNoticeCardImpl(text: string, t: Theme, cols: number): null | ReactNode {
  if (!PL_CV_ON || typeof text !== 'string' || !text.startsWith('[')) {
    return null
  }

  const lines = text.split('\n')
  const head = lines[0]!.match(PL_NOTICE_HEAD_RE)

  if (!head || !/INTERNAL NOTIFICATION|DELEGATION|BACKGROUND|PROCESS|CRON|TASK/.test(text)) {
    return null
  }

  const md = __plMd(t)
  const width = Math.max(30, Math.min(PL_CV_MAX_W, cols - 2))
  const kind = head[1]!.trim()
  const ident = head[2]?.trim() ?? ''
  const meta: string[] = []
  const tasks: { body: string[]; head: string; ok: boolean }[] = []
  const free: string[] = []
  let cur: null | { body: string[]; head: string; ok: boolean } = null

  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\s+$/, '')

    if (/^\[INTERNAL NOTIFICATION/.test(line) || /^chat message because of it\.\]$/.test(line)) {
      continue
    }

    const task = line.match(/^---\s*([✓✗⚠])\s*(TASK\s+\d+\/\d+.*?)\s*---$/)

    if (task) {
      cur = { body: [], head: `${task[1]} ${task[2]}`, ok: task[1] === '✓' }
      tasks.push(cur)
      continue
    }

    const m = line.match(/^(Dispatched|Role|Model|Total duration|Completed|Exit code|Command|Duration):?\s*(.*)$/)

    if (!cur && m) {
      meta.push(line.replace(/\s{2,}/g, ' · '))
      continue
    }

    if (cur) {
      if (/^Full live transcript/.test(line)) {
        cur.body.push(`\u0000${line.replace(/^Full live transcript[^:]*:\s*/, '')}`)
      } else {
        cur.body.push(line)
      }
    } else if (line.trim() && !/^A background fan-out unit|^Any other units|act on these or re-dispatch/.test(line)) {
      free.push(line)
    }
  }

  const ok = tasks.length ? tasks.every(x => x.ok) : !/ERROR|FAILED|✗/.test(text)
  const edge = ok ? __cvHY.green : __cvHY.red
  const title = /DELEGATION/.test(kind) ? `⑂ SUBAGENT ${ok ? 'XONG' : 'LỖI'}` : `◈ ${kind}`

  return (
    <Box flexDirection="column" marginY={0}>
      <Text>
        <Text backgroundColor={edge} bold color={__cvHY.deeper}>
          {` ${title} `}
        </Text>
        {ident ? <Text color={__cvHY.comment}>{`  ${ident}`}</Text> : null}
      </Text>
      {meta.length ? (
        <Text color={__cvHY.dim} wrap="wrap-trim">
          <Text color={edge}>{'▌ '}</Text>
          {meta.join(' · ')}
        </Text>
      ) : null}
      {tasks.map((task, i) => {
        const hm = task.head.match(/^(.)\s*TASK\s+(\d+\/\d+):?\s*(.*?)\s*\((.*)\)\s*$/)
        const goal = hm?.[3] ?? task.head
        const info = (hm?.[4] ?? '').replace(/status=/, '').replace(/api_calls=(\d+)/, '$1 calls')
        const body = task.body.filter(l => !l.startsWith('\u0000')).join('\n').trim()
        const transcript = task.body.find(l => l.startsWith('\u0000'))?.slice(1)

        return (
          <Box flexDirection="column" key={i}>
            <Text wrap="wrap-trim">
              <Text color={task.ok ? __cvHY.green : __cvHY.red}>{`▌ ${task.ok ? '✓' : '✗'} `}</Text>
              <Text bold color={__cvHY.fg}>
                {hm ? `${hm[2]} ` : ''}
              </Text>
              <Text bold color={md.h2}>
                {goal}
              </Text>
              {info ? <Text color={__cvHY.comment}>{`  ${info}`}</Text> : null}
            </Text>
            {body ? (
              <Box paddingLeft={2}>{plNoticeSummary(body, t, width - 4, `s${i}`)}</Box>
            ) : null}
            {transcript ? (
              <Text color={__cvHY.comment} wrap="truncate-middle">
                {`  ↳ ${transcript.replace(process.env.HOME ?? '\u0000', '~')}`}
              </Text>
            ) : null}
          </Box>
        )
      })}
      {free.length ? (
        <Box paddingLeft={2}>{plNoticeSummary(free.join('\n'), t, width - 4, 'free')}</Box>
      ) : null}
    </Box>
  )
}

;(globalThis as { __plNoticeCard?: unknown }).__plNoticeCard = (text: string, t: Theme, cols: number) => {
  try {
    return __plNoticeCardImpl(text, t, cols)
  } catch {
    return null
  }
}
