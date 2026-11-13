
// ═══════════════════════════════════════════════════════════════════════
// hermes-powerline — the processes / live-agents dock above the bar, restyled.
// Appended to components/agentsPanel.tsx at build time (stock AgentsPanelView is
// renamed to AgentsPanelViewClassic; HERMES_POWERLINE_DOCK=0 renders that one).
//
//    PROCESSES  3 running                               ^T expand · ^R collapse
//   ⠼ A3-resume  chờ bài đang chạy (a3_g38) xong          ccbsn-research · 12m
//   ✓ robust  chạy 2 bài chống trượt giá        exit 0 · 20s ago · ccbsn-research
//
// A process is named by what its command says about itself (the first
// `echo "[tag] text"`, else the command without its leading `cd dir &&`); the
// directory and the time sit in a right-hand column. Dark band (xterm 235: exact
// on 256-colour terminals), chips in the bar's colours.
// ═══════════════════════════════════════════════════════════════════════
import type { ReactNode as __PldNode } from 'react'

const PLD = {
  band: '#262626',
  comment: '#6272A4',
  dark: '#191A21',
  dim: '#9AA5CE',
  fg: '#F8F8F2',
  green: '#50FA7B',
  orange: '#FFB86C',
  purple: '#BD93F9',
  red: '#FF5555',
  yellow: '#F1FA8C'
}

const PLD_SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const PLD_HOME = process.env.HOME ?? ''

const pldSpin = () => PLD_SPIN[Math.floor(Date.now() / 1000) % PLD_SPIN.length]!

const pldTime = (s: number) => (s >= 1 ? fmtDuration(s) : '')

/** "/Users/x/ccbsn-research" → "ccbsn-research"; "~/a/b/c" → "b/c". */
const pldDir = (dir: string): string => {
  const d = dir.replace(/^["']|["']$/g, '').replace(PLD_HOME ? new RegExp(`^${PLD_HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : /^$/, '~')
  const parts = d.split('/').filter(Boolean)

  return parts.length > 2 ? parts.slice(-2).join('/') : d
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
  let title = echo ? (echo[2] ?? echo[3] ?? '') : ''
  title = title.replace(/\$\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()

  let tag = ''
  const t = /^\[([^\]]{1,24})\]\s*/.exec(title)

  if (t) {
    tag = t[1]!
    title = title.slice(t[0].length)
  }

  if (!title) {
    title = cmd || command
  }

  return { dir, tag, title }
}

function PldChip({ bg, text }: { bg: string; text: string }) {
  return (
    <Text backgroundColor={bg} bold color={PLD.dark}>
      {` ${text} `}
    </Text>
  )
}

/** One full-width row: left part truncates, right part keeps its width. */
function PldRow({ cols, left, right, rightColor = PLD.comment }: { cols: number; left: __PldNode; right: string; rightColor?: string }) {
  const rw = right ? Math.min(stringWidth(right) + 1, Math.max(0, Math.floor(cols / 2))) : 0

  return (
    <Box flexDirection="row" width={cols}>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">{left}</Text>
      </Box>
      {rw ? (
        <Box flexShrink={0} width={rw}>
          <Text color={rightColor} wrap="truncate-start">{` ${right}`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

const pldHints = (s: string) => s.replace(/^\s*·\s*/, '').replace(/Ctrl\+/g, '^')

function PldProcess({ cols, row }: { cols: number; row: ProcessRow }) {
  const d = pldDescribe(row.command)
  const running = row.status === 'running'
  const mark = running
    ? { color: PLD.orange, glyph: pldSpin() }
    : row.status === 'done'
      ? { color: PLD.green, glyph: '✓' }
      : row.status === 'lost'
        ? { color: PLD.dim, glyph: '?' }
        : { color: PLD.red, glyph: '×' }
  // Running: the last output line (dim) after the title; the right column has dir · time.
  // Finished: the verdict ("exit 0 · 20s ago") on the right, in the outcome's colour.
  const last = running && row.detail.startsWith('last: ') ? row.detail.slice(6) : ''
  const right = running ? [d.dir, pldTime(row.elapsedSeconds)].filter(Boolean).join(' · ') : [row.detail, d.dir].filter(Boolean).join(' · ')

  return (
    <PldRow
      cols={cols}
      left={
        <>
          <Text color={mark.color}>{` ${mark.glyph} `}</Text>
          {d.tag ? <Text bold color={PLD.purple}>{`${d.tag}  `}</Text> : null}
          <Text color={running ? PLD.fg : PLD.dim}>{d.title}</Text>
          {last ? <Text color={PLD.comment}>{`  › ${last}`}</Text> : null}
        </>
      }
      right={right}
      rightColor={running || row.status === 'done' ? PLD.comment : mark.color}
    />
  )
}

function PldAgent({ cols, row, t }: { cols: number; row: AgentRows['rows'][number]; t: Theme }) {
  const live = row.status === 'running' || row.status === 'queued' || row.status === 'dispatched' || row.status === 'finalizing'
  const g = live ? { color: PLD.orange, glyph: pldSpin() } : statusGlyph(row.status, t)

  return (
    <Box flexDirection="column">
      <PldRow
        cols={cols}
        left={
          <>
            <Text color={g.color}>{` ${g.glyph} `}</Text>
            {row.name ? <Text bold color={PLD.purple}>{`${row.name} › `}</Text> : null}
            <Text color={live ? PLD.fg : PLD.dim}>{row.goal}</Text>
          </>
        }
        right={[row.id ? `@${row.id}` : '', row.elapsedSeconds == null ? '' : fmtDuration(row.elapsedSeconds)].filter(Boolean).join(' · ')}
      />
      {row.detail ? (
        <Text color={PLD.comment} wrap="truncate-end">{`   ↳ ${compactPreview(row.detail, Math.max(8, cols - 5))}`}</Text>
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

  const procWord = processes.running ? `${processes.running} running` : processSummary(processes)
  const header = (chip: string, bg: string, what: string, more: number, hint: string) => (
    <PldRow
      cols={cols}
      left={
        <>
          <PldChip bg={bg} text={chip} />
          <Text bold color={PLD.fg}>{`  ${what}`}</Text>
          {more ? <Text color={PLD.comment}>{`  +${more} more`}</Text> : null}
        </>
      }
      right={hint}
    />
  )

  if (collapsed) {
    const parts = [running ? `${running} agents` : '', processes.total ? `procs ${procWord}` : ''].filter(Boolean).join(' · ')
    const first = rows[0]?.goal ?? (processes.rows[0] ? pldDescribe(processes.rows[0].command).title : '')

    return (
      <Box backgroundColor={PLD.band} flexDirection="column" flexShrink={0} width={cols}>
        <PldRow
          cols={cols}
          left={
            <>
              <PldChip bg={running ? PLD.purple : PLD.green} text={`${pldSpin()} DOCK`} />
              <Text bold color={PLD.fg}>{`  ${parts}`}</Text>
              {first ? <Text color={PLD.comment}>{`  › ${first}`}</Text> : null}
            </>
          }
          right={pldHints(T.collapsedHint)}
        />
      </Box>
    )
  }

  return (
    <Box backgroundColor={PLD.band} flexDirection="column" flexShrink={0} width={cols}>
      {running ? header('⑂ AGENTS', PLD.purple, `${running} live`, hidden, pldHints(T.expandedHint)) : null}
      {rows.map(row => (
        <PldAgent cols={cols} key={row.key} row={row} t={t} />
      ))}
      {processes.total
        ? header('⚙ PROCESSES', PLD.green, procWord, processes.hidden, running ? '' : pldHints(T.expandedHint))
        : null}
      {processes.rows.map(row => (
        <PldProcess cols={cols} key={row.id} row={row} />
      ))}
    </Box>
  )
}
