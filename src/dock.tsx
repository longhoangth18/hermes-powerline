
// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline — the processes / live-agents dock above the bar, restyled.
// Appended to components/agentsPanel.tsx at build time (stock AgentsPanelView is
// renamed to AgentsPanelViewClassic; HERMES_POWERLINE_DOCK=0 renders that one).
//
//    PROCESSES  2 running · 2 done                          ^T expand  ^R collapse
//  ▌⠼ A3-resume  chờ bài đang chạy (a3_g38) xong                 ccbsn-research
//  ▌⠼ ./run_job.sh jobs/a3_g42.ini  › profit 45.75      ccbsn-research  󰔛 12m34s
//  ▌✓ robust  chạy 2 bài chống trượt giá          ccbsn-research   exit 0 · 20s
//
// Powerline header like the bar, a state-coloured edge per row, the process named
// by what its command says about itself (its first `echo "[tag] text"`, else the
// command minus its leading `cd dir &&`), tag as a rounded pill, last output dim,
// and a right-hand column: directory, run time, or the exit verdict as a pill.
// Colours are exact xterm-256 greys where it matters (Termius/tmux round the rest).
// ═══════════════════════════════════════════════════════════════════════
import type { ReactNode as __PldNode } from 'react'

const PLD = {
  band: '#262626', // xterm 235
  seg: '#3A3A3A', // xterm 237
  comment: '#8787AF',
  cyan: '#8BE9FD',
  dark: '#1C1C1C',
  dim: '#BCBCBC',
  fg: '#F8F8F2',
  green: '#50FA7B',
  orange: '#FFB86C',
  purple: '#BD93F9',
  red: '#FF5555',
  yellow: '#F1FA8C'
}

const PLD_NF = (globalThis as { __plIcons?: boolean }).__plIcons !== false
const PLD_I = PLD_NF
  ? { agents: '\u{f0010} ', arrow: '', clock: '\u{f051b} ', dir: ' ', l: '', procs: ' ', r: '' }
  : { agents: '', arrow: '', clock: '', dir: '', l: '', procs: '', r: '' }
const PLD_SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const PLD_HOME = process.env.HOME ?? ''

const pldSpin = () => PLD_SPIN[Math.floor(Date.now() / 1000) % PLD_SPIN.length]!

const pldClock = (s: number) => {
  const m = Math.floor(s / 60)

  return s < 60 ? `${s}s` : m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** "/Users/x/ccbsn-research" → "ccbsn-research"; deeper paths keep their last two parts. */
const pldDir = (dir: string): string => {
  let d = dir.replace(/^["']|["']$/g, '')

  if (PLD_HOME && d.startsWith(PLD_HOME)) {
    d = '~' + d.slice(PLD_HOME.length)
  }

  const parts = d.split('/').filter(p => p && p !== '~')

  return parts.length ? parts.slice(-2).join('/') : d
}

/** What a background command is, for a person: { tag, title, dir }. */
export const pldDescribe = (command: string): { dir: string; tag: string; title: string } => {
  let cmd = command.replace(/\s+/g, ' ').trim()
  let dir = ''
  const cd = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)?\s*/.exec(cmd)

  if (cd) {
    dir = pldDir(cd[1]!)
    cmd = cmd.slice(cd[0].length)
  }

  const echo = /\becho\s+(?:-[ne]+\s+)?("([^"]*)"|'([^']*)')/.exec(cmd)
  let title = (echo ? (echo[2] ?? echo[3] ?? '') : '').replace(/\$\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  let tag = ''
  const t = /^\[([^\]]{1,24})\]\s*/.exec(title)

  if (t) {
    tag = t[1]!
    title = title.slice(t[0].length)
  }

  return { dir, tag, title: title || cmd || command }
}

/** A rounded pill: caps in the pill's colour on the band, text dark on the pill. */
function PldPill({ bg, children, fg = PLD.dark }: { bg: string; children: string; fg?: string }) {
  return (
    <>
      <Text color={bg}>{PLD_I.l}</Text>
      <Text backgroundColor={bg} bold color={fg}>{PLD_NF ? children : ` ${children} `}</Text>
      <Text color={bg}>{PLD_I.r}</Text>
    </>
  )
}

/** One full-width row: a state-coloured edge, a left part that truncates, a right part that keeps its width. */
function PldRow({ cols, edge, left, right, rightW }: { cols: number; edge?: string; left: __PldNode; right?: __PldNode; rightW: number }) {
  const rw = right ? Math.min(rightW + 1, Math.max(0, Math.floor(cols / 2))) : 0

  return (
    <Box flexDirection="row" width={cols}>
      {edge ? <Text color={edge}>{'▌ '}</Text> : <Text>{'  '}</Text>}
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">{left}</Text>
      </Box>
      {rw ? (
        <Box flexShrink={0} justifyContent="flex-end" width={rw}>
          <Text wrap="truncate-start">{right}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** Powerline header: [icon TITLE][counts] arrows, keyboard hints on the right. */
function PldHeader({ bg, cols, count, hint, title }: { bg: string; cols: number; count: string; hint: string; title: string }) {
  const keys = hint
    .replace(/^\s*·\s*/, '')
    .split(/\s*·\s*/)
    .filter(Boolean)
    .map(k => k.replace(/^Ctrl\+(\w)\s*/, '^$1 '))
  const right = (
    <>
      {keys.map((k, i) => {
        const [key, ...word] = k.split(' ')

        return (
          <Text key={k}>
            <Text backgroundColor={PLD.seg} bold color={PLD.fg}>{` ${key} `}</Text>
            <Text color={PLD.comment}>{` ${word.join(' ')}${i < keys.length - 1 ? '  ' : ''}`}</Text>
          </Text>
        )
      })}
    </>
  )
  const rightW = keys.reduce((n, k) => n + stringWidth(k) + 3, 0)

  return (
    <PldRow
      cols={cols}
      left={
        <>
          <Text backgroundColor={bg} bold color={PLD.dark}>{` ${PLD_I.procs && title === 'PROCESSES' ? PLD_I.procs : title === 'AGENTS' ? PLD_I.agents : ''}${title} `}</Text>
          <Text backgroundColor={PLD.seg} color={bg}>{PLD_I.arrow}</Text>
          <Text backgroundColor={PLD.seg} bold color={PLD.fg}>{` ${count} `}</Text>
          <Text color={PLD.seg}>{PLD_I.arrow || ' '}</Text>
        </>
      }
      right={keys.length ? right : undefined}
      rightW={rightW}
    />
  )
}

function PldProcess({ cols, row }: { cols: number; row: ProcessRow }) {
  const d = pldDescribe(row.command)
  const running = row.status === 'running'
  const state = running
    ? { color: PLD.orange, glyph: pldSpin() }
    : row.status === 'done'
      ? { color: PLD.green, glyph: '✓' }
      : row.status === 'lost'
        ? { color: PLD.comment, glyph: '?' }
        : { color: PLD.red, glyph: '×' }
  const last = running && row.detail.startsWith('last: ') ? row.detail.slice(6) : ''
  const time = running && row.elapsedSeconds >= 1 ? pldClock(row.elapsedSeconds) : ''
  const verdict = running ? '' : row.detail.replace(/(\d+)s ago$/, '$1s')
  const dirTxt = d.dir ? `${PLD_I.dir}${d.dir}` : ''
  const right = (
    <>
      {dirTxt ? <Text color={PLD.comment}>{dirTxt}</Text> : null}
      {time ? <Text bold color={PLD.cyan}>{`  ${PLD_I.clock}${time}`}</Text> : null}
      {verdict ? (
        <>
          <Text>{'  '}</Text>
          <PldPill bg={row.status === 'done' ? PLD.green : state.color}>{verdict}</PldPill>
        </>
      ) : null}
    </>
  )
  const rightW = stringWidth(dirTxt) + (time ? stringWidth(`  ${PLD_I.clock}${time}`) : 0) + (verdict ? stringWidth(verdict) + 2 + (PLD_NF ? 2 : 2) : 0)

  return (
    <PldRow
      cols={cols}
      edge={state.color}
      left={
        <>
          <Text bold color={state.color}>{`${state.glyph} `}</Text>
          {d.tag ? (
            <>
              <PldPill bg={PLD.purple}>{d.tag}</PldPill>
              <Text> </Text>
            </>
          ) : null}
          <Text bold={running} color={running ? PLD.fg : PLD.dim}>{d.title}</Text>
          {last ? <Text color={PLD.comment} italic>{`  › ${last}`}</Text> : null}
        </>
      }
      right={right}
      rightW={rightW}
    />
  )
}

function PldAgent({ cols, row, t }: { cols: number; row: AgentRows['rows'][number]; t: Theme }) {
  const live = ['dispatched', 'finalizing', 'queued', 'running'].includes(row.status)
  const g = live ? { color: PLD.purple, glyph: pldSpin() } : statusGlyph(row.status, t)
  const time = row.elapsedSeconds == null ? '' : pldClock(Math.round(row.elapsedSeconds))
  const id = row.id ? `@${row.id}` : ''

  return (
    <Box flexDirection="column">
      <PldRow
        cols={cols}
        edge={g.color}
        left={
          <>
            <Text bold color={g.color}>{`${g.glyph} `}</Text>
            {row.name ? (
              <>
                <PldPill bg={PLD.purple}>{row.name}</PldPill>
                <Text> </Text>
              </>
            ) : null}
            <Text bold={live} color={live ? PLD.fg : PLD.dim}>{row.goal}</Text>
          </>
        }
        right={
          <>
            {id ? <Text color={PLD.comment}>{id}</Text> : null}
            {time ? <Text bold color={PLD.cyan}>{`  ${PLD_I.clock}${time}`}</Text> : null}
          </>
        }
        rightW={stringWidth(id) + (time ? stringWidth(`  ${PLD_I.clock}${time}`) : 0)}
      />
      {row.detail ? (
        <Box flexDirection="row" width={cols}>
          <Text color={g.color}>{'▌ '}</Text>
          <Text color={PLD.comment} wrap="truncate-end">{`  ╰─ ${compactPreview(row.detail, Math.max(8, cols - 8))}`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

export function AgentsPanelView(props: AgentRows & { collapsed?: boolean; cols: number; processes?: ProcessBlock; t: Theme }) {
  const T = useT().hubs.agentsPanel

  if (process.env.HERMES_POWERLINE_DOCK === '0') {
    return <AgentsPanelViewClassic {...props} />
  }

  const { collapsed = false, cols, hidden, processes = EMPTY_PROCESSES, rows, running, t } = props

  if (!running && !processes.total) {
    return null
  }

  const procDone = processes.total - processes.running
  const procCount = [processes.running ? `${processes.running} running` : '', procDone ? `${procDone} done` : '', processes.hidden ? `+${processes.hidden}` : '']
    .filter(Boolean)
    .join(' · ')

  if (collapsed) {
    const first = rows[0]?.goal ?? (processes.rows[0] ? pldDescribe(processes.rows[0].command).title : '')

    return (
      <Box backgroundColor={PLD.band} flexDirection="column" flexShrink={0} width={cols}>
        <PldRow
          cols={cols}
          left={
            <>
              {running ? (
                <>
                  <PldPill bg={PLD.purple}>{`${pldSpin()} ${PLD_I.agents}${running} agents`}</PldPill>
                  <Text> </Text>
                </>
              ) : null}
              {processes.total ? <PldPill bg={processes.running ? PLD.green : PLD.seg} fg={processes.running ? PLD.dark : PLD.fg}>{`${PLD_I.procs}${procCount}`}</PldPill> : null}
              {first ? <Text color={PLD.comment} italic>{`  › ${first}`}</Text> : null}
            </>
          }
          right={<Text color={PLD.comment}>{T.collapsedHint.replace(/^\s*·\s*/, '').replace(/Ctrl\+/g, '^')}</Text>}
          rightW={stringWidth(T.collapsedHint) - 2}
        />
      </Box>
    )
  }

  return (
    <Box backgroundColor={PLD.band} flexDirection="column" flexShrink={0} width={cols}>
      {running ? <PldHeader bg={PLD.purple} cols={cols} count={`${running} live${hidden ? ` · +${hidden}` : ''}`} hint={T.expandedHint} title="AGENTS" /> : null}
      {rows.map(row => (
        <PldAgent cols={cols} key={row.key} row={row} t={t} />
      ))}
      {processes.total ? <PldHeader bg={PLD.green} cols={cols} count={procCount} hint={running ? '' : T.expandedHint} title="PROCESSES" /> : null}
      {processes.rows.map(row => (
        <PldProcess cols={cols} key={row.id} row={row} />
      ))}
    </Box>
  )
}
