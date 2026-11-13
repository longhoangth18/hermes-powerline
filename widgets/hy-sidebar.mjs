// hy-sidebar — the live session panel of the hy TUI (part of hermes-powerline).
//
// An official Hermes user widget ($HERMES_HOME/tui-widgets/), ambient, right rail,
// auto-open on terminals ≥ 112 columns, /hy-sidebar toggles. Layout follows the
// OpenCode / Crush sidebars (design notes in docs/GUIDE.md):
//
//   title · model · context gauge (tokens · % · cost)
//   SUBAGENTS  route chips lit while active · live tasks · finished tasks
//   TODO       progress bar · items (▶ in progress, ✓ done, ○ pending)
//   RUNNING    tools in flight with timers
//   SKILLS     used this session + a wall of every skill (loading pulses, used glows)
//   MCP        every server: health dot + word · in use (spinner) · calls this session
//   FILES      written / patched files
//   …pinned:   cwd · branch
//              CLAUDE  claude-sub jobs: lit while Claude Code works, flash on finish, last day's
//                      history (✓ done × error ◔ limit ◷ timeout ⊘ cancelled ? lost), ✗ denials
//
// Data: live TUI stores via globalThis.__hy (bridge.ts); history from state.db
// (read-only, node:sqlite): skills, delegations (task → route), subagent
// sessions, MCP calls, files. The loader publishes globalThis.__hyData so the
// tabs widget shows the same subagent/route state.
//
// Safety: no bridge → never opens, renders nothing. Every read is guarded; the
// SDK's widget error boundary catches render throws. Idle = no repaint; a clock
// runs only while something animates. HY_SIDEBAR=0 keeps it closed at start.

const ID = 'hy-sidebar'
const WIDTH = 42 // rail columns (paddingX 1 → 40 content), OpenCode's sidebar width
const MIN_COLS = 112
const DB_IDLE_MS = 15_000
const DB_BUSY_MS = 2_500
// One repaint tick while something works (~5 fps): smooth enough for spinners and glows, and half
// the CPU of the old 120 ms tick (measured: busy TUI 13 % → widgets were half of it).
const ANIM_MS = 200
const FLASH_MS = 4_000
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// Dracula fallback (the bridge normally hands us the colour-depth-aware palette).
const FALLBACK = {
  bg: '#282A36', comment: '#6272A4', cyan: '#8BE9FD', deep: '#21222C', deeper: '#191A21', dim: '#9AA5CE',
  fg: '#F8F8F2', green: '#50FA7B', line: '#44475A', orange: '#FFB86C', pink: '#FF79C6', purple: '#BD93F9',
  raised: '#4D5066', red: '#FF5555', surface: '#343746', truecolor: true, yellow: '#F1FA8C', accent: '#50FA7B', idle: '#8A95C0'
}

const IC = {
  branch: '\u{f062c}', file: '\u{f0dc8}', folder: '\u{f0770}', mcp: '\u{f048d}', model: '\u{f06a9}',
  puzzle: '\u{f0431}', run: '\u{f140b}', team: '\u{f000e}', todo: '\u{f0756}'
}

const bridge = () => {
  const b = globalThis.__hy

  return b && b.ui?.get && b.turn?.get && b.overlay?.get && b.patchOverlay ? b : null
}

// Subagent statuses that mean "still working" (same set as Hermes' live-agents dock).
const IN_FLIGHT = new Set(['dispatched', 'finalizing', 'queued', 'running'])
const inFlight = s => IN_FLIGHT.has(s?.status)

// Every subagent of this session: in-turn ones AND background (async) delegations that outlive
// the turn (bridge v3 roster); older bridges only know the in-turn list.
const subsOf = turn => {
  try {
    const r = bridge()?.roster?.()

    if (Array.isArray(r)) {
      return r
    }
  } catch {
    // fall back below
  }

  return turn?.subagents ?? []
}

const theme = () => {
  try {
    return { ...FALLBACK, ...(globalThis.__hy?.theme ?? {}) }
  } catch {
    return FALLBACK
  }
}

const skillKey = n => String(n ?? '').split(':').pop().trim().toLowerCase()
const mcpServer = n => /^mcp__([^_].*?)__/.exec(String(n ?? ''))?.[1] ?? null

// ── shared data loader (state.db) ───────────────────────────────────────
// One poller per TUI process; both hy widgets read globalThis.__hyData.
const loader = (globalThis.__hyLoader ??= { db: null, failed: false, started: false, timer: null })

async function openDb() {
  if (loader.db || loader.failed) {
    return loader.db
  }

  try {
    const { DatabaseSync } = await import('node:sqlite')
    const home = process.env.HERMES_HOME?.trim() || `${process.env.HOME}/.hermes`

    loader.db = new DatabaseSync(`${home}/state.db`, { readOnly: true })
  } catch {
    loader.failed = true
  }

  return loader.db
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') {
    return raw
  }

  try {
    return JSON.parse(raw || '{}') ?? {}
  } catch {
    return {}
  }
}

async function readSession(sid) {
  const db = await openDb()

  if (!db || !sid) {
    return null
  }

  try {
    const msgs = db
      .prepare(
        `SELECT session_id AS sid, tool_calls AS tc, timestamp AS ts FROM messages
          WHERE role = 'assistant' AND tool_calls IS NOT NULL
            AND (session_id = ? OR session_id IN (SELECT id FROM sessions WHERE parent_session_id = ?))
          ORDER BY id`
      )
      .all(sid, sid)

    const skills = new Map()
    const files = new Map()
    const mcp = new Map() // server → { n, last, at }
    const delegations = [] // { goal, profile }

    const onCall = (fn, args, rowSid, ts) => {
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
          files.delete(p)
          files.set(p, f)
        }
      } else if (fn === 'delegate_task') {
        // `tasks` may arrive as a JSON string (Hermes parses it); a legacy top-level `goal` is wrapped
        // into one task WITHOUT any profile, so it runs on the default route.
        let list = args.tasks

        if (typeof list === 'string') {
          try {
            list = JSON.parse(list)
          } catch {
            list = null
          }
        }

        for (const t of Array.isArray(list) ? list : [{ goal: args.goal }]) {
          if (t && typeof t.goal === 'string') {
            delegations.push({ goal: t.goal, profile: typeof t.profile === 'string' && t.profile ? t.profile : routeConfig().def || 'default' })
          }
        }
      }

      const server = mcpServer(fn)

      if (server) {
        const m = mcp.get(server) ?? { at: 0, last: '', n: 0 }

        m.n++
        m.last = String(fn).split('__').slice(2).join('__')
        m.at = Math.max(m.at, Number(ts) || 0)
        mcp.set(server, m)
      }
    }

    for (const { sid: rowSid, tc, ts } of msgs) {
      let calls

      try {
        calls = JSON.parse(tc)
      } catch {
        continue
      }

      for (const c of Array.isArray(calls) ? calls : []) {
        const fn = c?.function?.name
        const args = parseArgs(c?.function?.arguments)

        onCall(fn, args, rowSid, ts)

        // Deferred tools run through tool_call: { name, arguments } or { calls: [...] }.
        if (fn === 'tool_call') {
          for (const ic of Array.isArray(args.calls) ? args.calls : [args]) {
            if (ic && typeof ic.name === 'string') {
              onCall(ic.name, parseArgs(ic.arguments), rowSid, ts)
            }
          }
        }
      }
    }

    // Subagent sessions of this session (finished or running), routed by goal.
    const kids = db
      .prepare(
        `SELECT id, model, end_reason AS endReason, started_at AS st, ended_at AS en, tool_call_count AS tools, title
           FROM sessions WHERE parent_session_id = ? ORDER BY started_at`
      )
      .all(sid)
      .map(k => {
        const goal = String(k.title ?? '').replace(/^Subagent:\s*/, '').replace(/…$/, '')
        const d = delegations.find(x => x.goal.startsWith(goal.slice(0, 40)) || goal.startsWith(x.goal.slice(0, 40)))

        return { ...k, goal, profile: d?.profile ?? routeConfig().byModel.get(k.model) ?? 'default' }
      })

    return { delegations, files, kids, mcp, skills }
  } catch {
    return null
  }
}

// How Hermes routes a delegation: delegation.backends.profile_routes.default takes tasks with no
// `profile`, and a subagent's model tells its route when exactly one profile uses that model.
// Read lazily, re-read when config.yaml changes (checked at most every 10 s).
let routeCfg = null

// A config's primary model and provider: the model: block, up to the next top-level key (comments allowed).
function modelOf(text) {
  const block = String(text).match(/^model:\n([\s\S]*?)(?=^[^\s#])/m)?.[1] ?? ''
  const pick = key => block.match(new RegExp(`^[ \\t]+${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*(?:#.*)?$`, 'm'))?.[1]?.trim()
  const model = pick('default') || pick('model')

  return model ? { model, provider: pick('provider') || '' } : null
}

// Providers the route profiles run on besides main's, with their models and routes, and whether one of
// those routes is working now — re-read from the configs (cached 10 s, mtime-checked), never hard-coded,
// so moving Kimi to another route or Coarena to another model shows up by itself. Published for the bar.
function providerLines() {
  const cfg = routeConfig()
  const states = routeStates()
  const mainProv = cfg.main?.provider ?? ''
  const groups = new Map()

  for (const [route, rc] of cfg.routes) {
    if (!rc.provider || rc.provider === mainProv) {
      continue
    }

    const g = groups.get(rc.provider) ?? { models: new Set(), provider: rc.provider, routes: [], state: 'idle' }
    const st = states.get(route) ?? 'idle'

    g.models.add(rc.model)
    g.routes.push(route)
    g.state = st === 'active' || g.state === 'active' ? 'active' : st === 'failed' || g.state === 'failed' ? 'failed' : st === 'done' || g.state === 'done' ? 'done' : 'idle'
    groups.set(rc.provider, g)
  }

  return [...groups.values()].map(g => ({
    label: g.provider.replace(/^custom:/, ''),
    models: [...g.models],
    provider: g.provider,
    routes: g.routes.sort(),
    state: g.state
  }))
}

function routeConfig() {
  const now = Date.now()

  if (routeCfg && now - routeCfg.at < 10_000) {
    return routeCfg
  }

  const cfg = { at: now, byModel: new Map(), def: null, main: null, mtime: routeCfg?.mtime ?? 0, routes: new Map() }

  try {
    const fs = process.getBuiltinModule?.('node:fs')
    const home = process.env.HERMES_HOME?.trim() || `${process.env.HOME}/.hermes`
    const root = /\/profiles\/[^/]+\/?$/.test(home) ? home.replace(/\/profiles\/[^/]+\/?$/, '') : home
    const mtime = fs.statSync(`${root}/config.yaml`).mtimeMs

    if (routeCfg && mtime === routeCfg.mtime) {
      routeCfg.at = now

      return routeCfg
    }

    cfg.mtime = mtime
    const text = fs.readFileSync(`${root}/config.yaml`, 'utf8')
    cfg.main = modelOf(text)
    // The block ends at the next top-level KEY; column-0 comments inside it are fine in YAML.
    const block = text.match(/^delegation:\n([\s\S]*?)(?=^[^\s#])/m)?.[1] ?? ''
    const routesAt = block.indexOf('profile_routes:')

    if (routesAt >= 0 && /^\s+backend:\s*["']?profile_routes/m.test(block)) {
      cfg.def = block.slice(routesAt).match(/^\s+default:\s*["']?([\w.-]+)/m)?.[1] ?? null
    }

    const owners = new Map()

    for (const r of routesList()) {
      try {
        const pc = fs.readFileSync(`${root}/profiles/${r}/config.yaml`, 'utf8')
        const model = pc.match(/^model:\n(?:[ \t]+#.*\n)*[ \t]+(?:default|model):\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1]
        const route = modelOf(pc)

        if (route) {
          cfg.routes.set(r, route)
        }

        if (model) {
          owners.set(model, [...(owners.get(model) ?? []), r])
        }
      } catch {
        // a profile without a readable config simply has no model mapping
      }
    }

    for (const [model, rs] of owners) {
      if (rs.length === 1) {
        cfg.byModel.set(model, rs[0])
      }
    }
  } catch {
    // keep defaults: no default route, no model mapping
  }

  routeCfg = cfg

  return cfg
}

function routesList() {
  try {
    const fs = process.getBuiltinModule?.('node:fs')
    const home = process.env.HERMES_HOME?.trim() || `${process.env.HOME}/.hermes`
    const dir = /\/profiles\/[^/]+\/?$/.test(home) ? home.replace(/\/profiles\/[^/]+\/?$/, '/profiles') : `${home}/profiles`

    return fs ? fs.readdirSync(dir).filter(n => !n.startsWith('.')).sort() : []
  } catch {
    return []
  }
}

// The session the TUI shows right now (stored id first: that is what state.db knows).
const currentSid = ui => ui?.storedSid || ui?.info?.stored_session_id || ui?.sid || null

// ── claude-sub: Claude Code jobs (the coding hand behind the coder route) ─────────────────────────
// claude-sub (~/repos/hermes-claude-sub) keeps one dir per job under $CLAUDE_SUB_HOME/jobs (default
// ~/.cache/claude-sub): meta.json at start, out.jsonl while Claude streams, exit.json then summary.json
// at the end — summary.status is the same word claude_status reports. Read-only here; any read that
// fails leaves the last good state. Jobs are machine-wide (every session and profile shares the one
// Claude account), so this block is too.
const CLAUDE_JOBS = `${process.env.CLAUDE_SUB_HOME?.trim() || `${process.env.HOME}/.cache/claude-sub`}/jobs`
const CLAUDE_ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/
const CLAUDE_KEEP = 8 // newest job dirs read per poll
const CLAUDE_HISTORY_S = 24 * 3600 // finished jobs older than a day leave the history
const CLAUDE_BUSY_MS = 1_000
const CLAUDE_IDLE_MS = 4_000
const CLAUDE_SETTLE_S = 5 // exit.json without summary.json yet: the runner is still writing it
const CLAUDE_LIVE = new Set(['starting', 'running', 'cancelling'])
const claude = (globalThis.__hyClaudeState ??= { flash: null, jobs: [], prog: new Map(), rev: 0, sig: '', started: false, timer: null })
// A state object left by another build of this widget may lack a field: fill it in, never crash the poller.
claude.prog ??= new Map()
claude.jobs ??= []
claude.rev ??= 0

const readJson = (fs, p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

const pidAlive = pid => {
  if (!pid) {
    return false
  }

  try {
    process.kill(Number(pid), 0)

    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

// What a tool call works on, in a few words: the file for edits and reads, the command for Bash, the
// pattern for searches, the URL for fetches.
function toolTarget(input) {
  const a = input && typeof input === 'object' ? input : {}
  const file = a.file_path ?? a.notebook_path ?? a.path

  if (typeof file === 'string' && file) {
    return file.split('/').filter(Boolean).slice(-2).join('/')
  }

  const v = a.command ?? a.pattern ?? a.url ?? a.query ?? a.description ?? a.prompt

  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
}

// What a job did so far, read incrementally from its stream (only the new bytes each poll, so turn and
// denial counts stay exact on long jobs): assistant turns, the last tool it called, scope-gate denials.
function claudeProgress(fs, id, dir) {
  let st = claude.prog.get(id) ?? { denials: 0, lastDenial: '', off: 0, rest: '', say: '', target: '', tool: '', turns: 0 }
  let fd

  try {
    fd = fs.openSync(`${dir}/out.jsonl`, 'r')
    const size = fs.fstatSync(fd).size

    if (size < st.off) {
      st = { denials: 0, lastDenial: '', off: 0, rest: '', say: '', target: '', tool: '', turns: 0 } // rewritten: start over
    }

    const len = Math.min(size - st.off, 4 << 20)

    if (len > 0) {
      const buf = Buffer.alloc(len)
      const got = fs.readSync(fd, buf, 0, len, st.off)
      const lines = (st.rest + buf.toString('utf8', 0, got)).split('\n')

      st.off += got
      st.rest = lines.pop() ?? '' // a line Claude is still writing

      for (const line of lines) {
        let ev

        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }

        if (ev?.type === 'assistant') {
          st.turns++

          for (const part of ev.message?.content ?? []) {
            if (part?.type === 'tool_use') {
              st.tool = String(part.name ?? '')
              st.target = toolTarget(part.input)
            } else if (part?.type === 'text' && String(part.text ?? '').trim()) {
              st.say = String(part.text).replace(/\s+/g, ' ').trim().slice(0, 300)
            }
          }
        } else if (ev?.type === 'user') {
          for (const part of ev.message?.content ?? []) {
            let text = part?.content

            if (Array.isArray(text)) {
              text = text.map(x => x?.text ?? '').join(' ')
            }

            if (typeof text === 'string' && text.includes('[scope-gate]')) {
              st.denials++
              st.lastDenial = text.trim()
            }
          }
        }
      }
    }
  } catch {
    // no stream yet (job just created) or unreadable: keep what we had
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }

  claude.prog.set(id, st)

  return st
}

// One job → { id, status, task, startedAt, endedAt, elapsed, turns, tool, files, denials, lastDenial }.
// Status words and rules are claude-sub's own (server.py summarize): summary.json when it exists,
// else exit.json (+ cancelled marker), else the runner's pid decides running vs lost.
function readClaudeJob(fs, id) {
  const dir = `${CLAUDE_JOBS}/${id}`
  const meta = readJson(fs, `${dir}/meta.json`)

  if (!meta) {
    return null
  }

  const nowS = Date.now() / 1000
  const base = {
    effort: String(meta.effort ?? ''),
    id,
    model: String(meta.model ?? ''),
    resume: Boolean(meta.resume),
    startedAt: Number(meta.started_at || meta.created_at || 0),
    task: String(meta.task_head ?? '').replace(/\s+/g, ' ').trim()
  }
  const sum = readJson(fs, `${dir}/summary.json`)

  if (sum?.status) {
    claude.prog.delete(id)

    return {
      ...base,
      denials: Number(sum.denials) || 0,
      elapsed: Number(sum.elapsed_s) || 0,
      endedAt: Number(sum.ended_at) || 0,
      files: Number(sum.files) || 0,
      lastDenial: String(sum.last_denial ?? ''),
      say: String(sum.result_head ?? '').replace(/\s+/g, ' ').trim(),
      status: String(sum.status),
      turns: Number(sum.turns) || 0
    }
  }

  const cancelled = fs.existsSync(`${dir}/cancelled`)
  const exit = readJson(fs, `${dir}/exit.json`)
  const p = claudeProgress(fs, id, dir)
  const prog = { denials: p.denials, lastDenial: p.lastDenial, say: p.say, target: p.target, tool: p.tool, turns: p.turns }

  if (exit && nowS - Number(exit.ended_at || 0) >= CLAUDE_SETTLE_S) {
    // Finished without a summary (claude-sub before 0.2, or the summary failed): the same rules,
    // minus the usage-limit check, which needs the result text.
    const status = cancelled ? 'cancelled' : exit.timed_out ? 'timeout' : exit.code === 0 ? 'done' : 'error'

    return { ...base, ...prog, elapsed: Number(exit.elapsed_s) || 0, endedAt: Number(exit.ended_at) || 0, status }
  }

  if (exit || pidAlive(meta.runner_pid)) {
    return { ...base, ...prog, status: cancelled ? 'cancelling' : 'running' }
  }

  if (!meta.runner_pid && nowS - Number(meta.created_at || 0) < 15) {
    return { ...base, ...prog, status: 'starting' }
  }

  return { ...base, ...prog, status: 'lost' }
}

function startClaude() {
  if (claude.started) {
    return
  }

  claude.started = true

  const fs = process.getBuiltinModule?.('node:fs')

  if (!fs) {
    return
  }

  const run = () => {
    let busy = false

    try {
      const ids = fs.existsSync(CLAUDE_JOBS)
        ? fs.readdirSync(CLAUDE_JOBS).filter(n => CLAUDE_ID.test(n)).sort().slice(-CLAUDE_KEEP).reverse()
        : []
      const jobs = ids.map(id => readClaudeJob(fs, id)).filter(Boolean)

      busy = jobs.some(j => CLAUDE_LIVE.has(j.status))

      const sig = JSON.stringify(jobs.map(j => [j.id, j.status, j.turns, j.tool, j.target, j.say, j.denials]))

      if (sig !== claude.sig) {
        // A job that just finished flashes for FLASH_MS (green when done, red otherwise).
        for (const j of jobs) {
          const was = claude.jobs.find(x => x.id === j.id)

          if (was && CLAUDE_LIVE.has(was.status) && !CLAUDE_LIVE.has(j.status)) {
            claude.flash = { id: j.id, until: Date.now() + FLASH_MS }
            flashUntil = Math.max(flashUntil, Date.now() + FLASH_MS)
          }
        }

        claude.jobs = jobs
        claude.sig = sig
        claude.rev++
      }

      for (const id of claude.prog.keys()) {
        if (!ids.includes(id)) {
          claude.prog.delete(id)
        }
      }
    } catch {
      // keep the last good state
    }

    claude.timer = setTimeout(run, busy ? CLAUDE_BUSY_MS : CLAUDE_IDLE_MS)
    claude.timer.unref?.()
  }

  run()
}

function startLoader() {
  if (loader.started) {
    return
  }

  loader.started = true
  globalThis.__hyData ??= { data: null, routes: routesList(), sid: null }

  const run = async () => {
    const ui = bridge()?.ui.get()
    const sid = currentSid(ui)

    if (sid !== globalThis.__hyData.sid) {
      globalThis.__hyData = { data: null, routes: globalThis.__hyData.routes, sid }
    }

    const res = await readSession(sid)

    if (res) {
      globalThis.__hyData = { ...globalThis.__hyData, data: res }
    }

    const working = ui?.busy || subsOf(bridge()?.turn.get()).some(inFlight)

    loader.timer = setTimeout(run, working ? DB_BUSY_MS : DB_IDLE_MS)
    loader.timer.unref?.()
  }

  void run()

  // A tool or subagent finishing → refresh soon (skills, delegations, MCP calls, files).
  let n = -1
  const watch = () => {
    const b = bridge()

    if (!b) {
      return void setTimeout(watch, 500)
    }

    // Turn ended (busy → idle): children and tool results just landed in state.db.
    let wasBusy = false

    let lastSid = currentSid(b.ui.get())

    b.ui.listen(ui => {
      const sid = currentSid(ui)

      // Switched session (tab, ^X, /new): read the new one now, not at the next idle poll.
      if (sid !== lastSid) {
        lastSid = sid
        clearTimeout(loader.timer)
        loader.timer = setTimeout(run, 50)
        loader.timer.unref?.()
      } else if (wasBusy && !ui?.busy) {
        clearTimeout(loader.timer)
        loader.timer = setTimeout(run, 800)
        loader.timer.unref?.()
      }

      wasBusy = Boolean(ui?.busy)
    })

    const onWork = () => {
      const turn = b.turn.get()
      const k = (turn?.tools ?? []).length * 1000 + subsOf(turn).filter(inFlight).length

      if (k !== n) {
        clearTimeout(loader.timer)
        loader.timer = setTimeout(run, 500)
        loader.timer.unref?.()
      }

      n = k
    }

    b.turn.listen(onWork)
    // A background delegation starting or finishing after the turn ended.
    b.agents?.listen?.(onWork)
  }

  watch()
}

// Live subagent → route: match its goal against the delegate_task calls.
function routeOf(goal, data, model) {
  const g = String(goal ?? '')
  const list = data?.delegations ?? []

  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i]

    if (x.goal === g || x.goal.startsWith(g.slice(0, 40)) || g.startsWith(x.goal.slice(0, 40))) {
      return x.profile
    }
  }

  // Not in the DB yet (the delegate_task row lands a moment later): a model only one profile uses
  // names the route right away.
  return (model && routeConfig().byModel.get(model)) || null
}

// Route states for chips (both widgets): active > failed > done > idle.
function routeStates() {
  const hd = globalThis.__hyData ?? {}
  const state = new Map((hd.routes ?? []).map(r => [r, 'idle']))

  for (const k of hd.data?.kids ?? []) {
    if (state.has(k.profile)) {
      // No ended_at yet → running; a child silent for 30 min (crashed owner) counts as done.
      state.set(k.profile, !k.en && Date.now() / 1000 - (k.st ?? 0) < 1800 ? 'active' : 'done')
    }
  }

  for (const s of subsOf(bridge()?.turn.get())) {
    const r = routeOf(s.goal, hd.data, s.model)

    if (r && state.has(r)) {
      if (inFlight(s)) {
        state.set(r, 'active')
      } else if (state.get(r) !== 'active') {
        state.set(r, s.status === 'failed' || s.status === 'error' ? 'failed' : 'done')
      }
    }
  }

  return state
}

globalThis.__hyRouteStates = routeStates
globalThis.__hyProviderLines = providerLines
globalThis.__hyRouteOf = routeOf

// Section folding: key → collapsed? Only a header click folds a section; nothing folds by itself.
const collapsed = new Map()

// Hermes archives the todo list into the transcript when a turn ends; keep the
// last one per session so the sidebar still shows how far the plan got.
const lastTodos = new Map()

// "Just used" flash bookkeeping for skills.
const litAt = new Map()
let litSid = null
let litPrimed = false
let flashUntil = 0

export default function register(sdk) {
  const { Box, Text, React, defineWidgetApp, openWidget } = sdk

  if (!Box || !Text || !React || !defineWidgetApp || !openWidget) {
    return
  }

  const h = sdk.h ?? React.createElement
  const { useEffect, useRef, useState } = React
  const W = WIDTH - 2
  const EDGE = '\u258c' // ▌ a row's coloured edge (claude block, provider lines — same as the dock)

  // ── helpers ────────────────────────────────────────────────────────────
  const fit = (s, w) => {
    const str = String(s ?? '')

    return str.length > w ? str.slice(0, Math.max(0, w - 1)) + '…' : str
  }

  // Terminal cells of one code point: wide CJK / Hangul / fullwidth / emoji = 2, combining marks = 0.
  const cellW = cp =>
    (cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)
      ? 0
      : (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
          (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
          (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)
        ? 2
        : 1

  // Split text into at most `max` lines of `w` cells; the last line ends in … when text is left.
  const cellLines = (s, w, max) => {
    const lines = []
    let line = ''
    let lw = 0

    for (const ch of String(s ?? '')) {
      const cw = cellW(ch.codePointAt(0))

      if (lw + cw > w) {
        lines.push(line)
        line = ''
        lw = 0

        if (lines.length === max) {
          break
        }
      }

      line += ch
      lw += cw
    }

    if (lines.length < max && line) {
      lines.push(line)
    } else if (lines.length === max && (line || lines.join('').length < [...String(s ?? '')].join('').length)) {
      const last = [...lines[max - 1]]

      while (last.length && last.reduce((n, ch) => n + cellW(ch.codePointAt(0)), 0) > w - 1) {
        last.pop()
      }

      lines[max - 1] = last.join('') + '…'
    }

    return lines.length ? lines : ['']
  }

  const short = n => {
    const v = Number(n)

    if (n == null || Number.isNaN(v)) {
      return '–'
    }

    if (v >= 1e6) {
      return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
    }

    return v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(v))
  }

  const dur = ms => {
    const s = Math.max(0, Math.round(ms / 1000))

    if (s < 60) {
      return `${s}s`
    }

    return s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
  }

  const ago = sec => (sec ? dur(Date.now() - sec * 1000) : '')
  // "now", "5m", "3h" — how long ago a history row's job ended.
  const agoShort = sec => {
    if (!sec) {
      return ''
    }

    const d = Math.max(0, Date.now() / 1000 - sec)

    return d < 60 ? 'now' : d < 3600 ? `${Math.floor(d / 60)}m` : `${Math.floor(d / 3600)}h`
  }

  const tilde = p => {
    const home = process.env.HOME

    return home && String(p).startsWith(home) ? '~' + String(p).slice(home.length) : String(p)
  }

  const tail = (p, w) => {
    const s = tilde(p)

    if (s.length <= w) {
      return s
    }

    const parts = s.split('/')
    let out = parts.pop() ?? s

    while (parts.length && `…/${parts[parts.length - 1]}/${out}`.length <= w) {
      out = `${parts.pop()}/${out}`
    }

    return fit(`…/${out}`, w)
  }

  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const mixHex = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')

  // A band of light sweeping across text (working labels, live rows).
  const Glow = ({ text, base, glow, now, bold }) => {
    const chars = [...String(text)]
    const head = Math.floor(now / 70) % (chars.length + 8)

    return h(
      Text,
      { bold },
      ...chars.map((ch, i) => {
        const d = Math.abs(i - head + 4)

        return h(Text, { color: d > 3 ? base : mixHex(base, glow, 1 - d / 4), key: i }, ch)
      })
    )
  }

  // Eighth-block bar with a gradient across the filled part.
  const Bar = ({ pct, width, c0, c1, track }) => {
    const p = Math.max(0, Math.min(100, pct ?? 0))
    const cells = (p / 100) * width
    const full = Math.floor(cells)
    const e = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][Math.round((cells - full) * 7)]
    const out = []

    for (let i = 0; i < full; i++) {
      out.push(h(Text, { backgroundColor: track, color: mixHex(c0, c1, width > 1 ? i / (width - 1) : 1), key: i }, '█'))
    }

    if (full < width) {
      if (e) {
        out.push(h(Text, { backgroundColor: track, color: c1, key: 'e' }, e))
      }

      const rest = width - full - (e ? 1 : 0)

      if (rest > 0) {
        out.push(h(Text, { backgroundColor: track, key: 'r' }, ' '.repeat(rest)))
      }
    }

    return h(Text, null, ...out)
  }

  // Section header — Crush style: " ICON TITLE ──────────── right".
  const Head = ({ c, icon, title, right, rightColor, open, onToggle }) => {
    const chev = open == null ? '' : open ? '▾' : '▸'
    const label = `${chev || ' '} ${icon} ${title} `
    const r = right ? ` ${right}` : ''
    const fill = Math.max(2, W - label.length - r.length)
    const line = h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, { color: open ? c.accent : c.dim }, `${chev || ' '} `),
      h(Text, { bold: true, color: open === false ? c.dim : c.accent }, `${icon} ${title} `),
      h(Text, { color: c.line }, '─'.repeat(fill)),
      r ? h(Text, { bold: true, color: rightColor ?? c.dim }, r) : null
    )

    return onToggle ? h(Box, { onClick: onToggle }, line) : line
  }

  const Row = ({ c, edge, mark, markColor, text, color, right, rightColor, dim, bold, glowNow, strike }) => {
    const r = right ? ` ${right}` : ''
    const room = Math.max(4, W - 3 - r.length)
    const body = fit(text, room)

    return h(
      Text,
      { wrap: 'truncate-end' },
      edge ? h(Text, { color: edge }, EDGE) : h(Text, null, ' '),
      h(Text, { color: markColor }, `${mark} `),
      glowNow != null
        ? h(Glow, { base: color, bold, glow: '#FFFFFF', now: glowNow, text: body })
        : h(Text, { bold, color, dimColor: dim, strikethrough: strike }, body),
      h(Text, null, ' '.repeat(Math.max(0, room - body.length))),
      r ? h(Text, { color: rightColor ?? c.dim }, r) : null
    )
  }

  // A rounded pill (Nerd Font caps, like hy-tabs and the dock): ( text ). Width = text + 2.
  const Pill = ({ bg, bold = true, fg, text }) =>
    h(
      Text,
      null,
      h(Text, { color: bg }, '\u{e0b6}'),
      h(Text, { backgroundColor: bg, bold, color: fg }, text),
      h(Text, { color: bg }, '\u{e0b4}')
    )

  // An edged line (the say / denial / goal lines under a row): coloured edge, then the text.
  const Edged = ({ edge, color, italic, key, text }) =>
    h(Text, { key, wrap: 'truncate-end' }, h(Text, { color: edge }, EDGE), h(Text, { color, italic }, text))

  const Chips = ({ items }) =>
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, null, ' '),
      ...items.flatMap((it, i) => [
        h(Text, { backgroundColor: it.bg, bold: it.bold, color: it.fg, key: `c${i}` }, ` ${it.text} `),
        h(Text, { key: `s${i}` }, ' ')
      ])
    )

  // Wrap chip items into rows of at most W cells.
  const chipRows = (items, keyp, maxRows = 99) => {
    const out = []
    let line = []
    let w = 1

    for (const it of items) {
      const cw = it.text.length + 3

      if (w + cw > W && line.length) {
        out.push(line)
        line = []
        w = 1

        if (out.length >= maxRows) {
          break
        }
      }

      line.push(it)
      w += cw
    }

    if (line.length && out.length < maxRows) {
      out.push(line)
    }

    return out.map((ln, i) => h(Chips, { items: ln, key: `${keyp}${i}` }))
  }

  // ── panel ──────────────────────────────────────────────────────────────
  // Height of the rail this widget sits in: walk up from our root to the rail box (the build clips
  // it with overflow: hidden) and read its laid-out height. 0 = unknown (older build / not mounted).
  // Inline rendering (no alternate screen: HERMES_TUI_NATIVE, HERMES_TUI_INLINE, Termux default) lets
  // the rail grow with its content, so its height says nothing about the room left — don't measure.
  const on = v => /^(1|true|yes|on)$/i.test(String(v ?? '').trim())
  const off = v => /^(0|false|no|off)$/i.test(String(v ?? '').trim())
  const INLINE =
    on(process.env.HERMES_TUI_NATIVE) ||
    on(process.env.HERMES_TUI_INLINE) ||
    (!off(process.env.HERMES_TUI_INLINE) && !off(process.env.HERMES_TUI_TERMUX_MODE) &&
      (Boolean(process.env.TERMUX_VERSION) || String(process.env.PREFIX ?? '').includes('com.termux')))

  const railHeight = node => {
    if (INLINE) {
      return 0
    }

    for (let n = node?.parentNode, i = 0; n && i < 8; n = n.parentNode, i++) {
      const st = n.style ?? {}

      if ((st.overflow === 'hidden' || st.overflowY === 'hidden') && n.yogaNode) {
        const hgt = Math.floor(n.yogaNode.getComputedHeight?.() ?? 0)

        return Number.isFinite(hgt) && hgt > 0 ? hgt : 0
      }
    }

    return 0
  }

  function Sidebar() {
    const [, force] = useState(0)
    const rootRef = useRef(null)
    const [railH, setRailH] = useState(0)

    // After every paint: follow the rail's real height (terminal resize, docks appearing below).
    useEffect(() => {
      const hgt = railHeight(rootRef.current)

      if (hgt && hgt !== railH) {
        setRailH(hgt)
      }
    })

    // An idle sidebar does not repaint by itself: re-measure when the terminal is resized.
    useEffect(() => {
      const onResize = () => setTimeout(() => force(n => n + 1), 50)

      process.stdout.on?.('resize', onResize)

      return () => process.stdout.off?.('resize', onResize)
    }, [])
    const b = bridge()

    useEffect(() => {
      if (!b) {
        return
      }

      startLoader()
      startClaude()

      // Store events (every streamed token) and the animation clock share ONE tick: a repaint that
      // just happened satisfies both, so the panel never paints more than once per ANIM_MS.
      let pending = null
      let lastPaint = 0
      const paint = () => {
        lastPaint = Date.now()
        force(n => n + 1)
      }
      const bump = () => {
        pending ??= setTimeout(() => {
          pending = null
          paint()
        }, Math.max(0, ANIM_MS - (Date.now() - lastPaint)))
      }

      const offTurn = b.turn.listen(bump)
      const offUi = b.ui.listen(bump)
      const offAgents = b.agents?.listen?.(bump)
      let lastData = null
      let lastClaude = -1
      const clock = setInterval(() => {
        const ui = b.ui.get()
        const turn = b.turn.get()
        const anim =
          ui.busy || Date.now() < flashUntil || (turn.tools ?? []).length || subsOf(turn).some(inFlight) ||
          claude.jobs.some(j => CLAUDE_LIVE.has(j.status))

        const fresh = globalThis.__hyData?.data !== lastData || claude.rev !== lastClaude

        if ((anim && !pending && Date.now() - lastPaint >= ANIM_MS - 10) || fresh) {
          lastData = globalThis.__hyData?.data
          lastClaude = claude.rev
          paint()
        }
      }, ANIM_MS)

      return () => {
        offTurn()
        offUi()
        offAgents?.()
        clearInterval(clock)
        clearTimeout(pending)
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

    const c = theme()
    const info = ui.info ?? {}
    const usage = { ...(info.usage ?? {}), ...(ui.usage ?? {}) }
    const hd = globalThis.__hyData ?? {}
    const data = hd.data
    const now = Date.now()
    const spin = SPIN[Math.floor(now / 90) % SPIN.length]
    // Rail height = terminal rows minus the bottom chrome (2 powerline rows, the
    // prompt row(s), the tabs dock) and a safety line — overflowing the rail makes
    // Ink paint sections over each other, so the budget errs on the short side.
    // The measured rail height when we have it; otherwise the old estimate.
    const rows = railH > 0 ? railH : Math.max(8, (process.stdout.rows || 40) - 9)
    const nodes = []
    const nodeLines = []
    const nodeTrim = [] // per node: (maxLines) => smaller node | null, for sections that can shed rows
    let used = 0
    const push = (node, lines, trim = null) => {
      nodes.push(node)
      nodeLines.push(lines)
      nodeTrim.push(trim)
      used += lines
    }

    const isOpen = (key, autoCollapsed = false) => !(collapsed.has(key) ? collapsed.get(key) : autoCollapsed)

    // A section: header (click to fold/unfold) + rows. Folded → the header alone, its
    // right-hand summary still says what is inside.
    const section = (key, head, body, autoCollapsed = false) => {
      if (!body.length) {
        return
      }

      const open = isOpen(key, autoCollapsed)
      const hd = React.cloneElement(head, {
        onToggle: () => {
          collapsed.set(key, open)
          force(n => n + 1)
        },
        open
      })

      // flexShrink 0: when the rail is short, Ink must clip the last section, never squeeze
      // sections into each other (that paints one section's lines over another's).
      const build = rows => h(Box, { flexDirection: 'column', flexShrink: 0, key, marginTop: 1 }, hd, ...rows)
      // Shed rows when the rail is short: keep the header, as many rows as fit, and a "…+N" line.
      const trim = max => {
        const n = max - 3 // margin + header + the "…" line

        return open && n >= 1 && n < body.length
          ? build([...body.slice(0, n), h(Text, { color: c.comment, key: `${key}-more` }, ` …+${body.length - n}`)])
          : null
      }

      push(build(open ? body : []), open ? body.length + 2 : 2, trim)
    }

    // ── title block ──
    const title = ui.sessionTitle || info.title || 'new session'
    const pct = usage.context_percent ?? (usage.context_used && usage.context_max ? (usage.context_used / usage.context_max) * 100 : null)
    const end = pct >= 85 ? c.red : pct >= 60 ? c.orange : c.cyan
    const status = ui.busy
      ? h(Text, null, h(Text, { color: c.orange }, `${spin} `), h(Glow, { base: c.orange, bold: true, glow: c.yellow, now, text: 'working' }))
      : h(Text, { color: c.green }, '● idle')
    const stats = [
      usage.calls ? `${usage.calls} calls` : '',
      usage.total ? `${short(usage.total)} tok` : '',
      usage.cache_hit_pct != null ? `cache ${Math.round(usage.cache_hit_pct)}%` : '',
      usage.cost_usd ? `$${Number(usage.cost_usd).toFixed(2)}` : ''
    ].filter(Boolean)

    const titleLines = cellLines(title, W, 2)

    push(
      h(
        Box,
        { flexDirection: 'column', flexShrink: 0, key: 'title' },
        h(
          Text,
          { wrap: 'truncate-end' },
          h(Text, { backgroundColor: c.accent, bold: true, color: c.deeper }, ' ☤ hermes '),
          h(Text, { backgroundColor: c.line, color: c.fg }, ` ${fit(info.profile_name || 'default', 12)} `),
          h(Text, { color: c.line }, '\u{e0b0} '),
          status
        ),
        ...titleLines.map((line, i) => h(Text, { bold: true, color: c.fg, key: `t${i}`, wrap: 'truncate-end' }, line)),
        h(
          Text,
          { color: c.dim, wrap: 'truncate-end' },
          `${IC.model} `,
          h(Text, { color: c.cyan }, fit(info.model || '?', 24)),
          info.reasoning_effort ? ` · ${info.reasoning_effort}` : ''
        ),
        // Before the first API call there is no context figure: say so instead of an empty gauge.
        pct == null
          ? h(Text, { color: c.idle ?? c.dim, wrap: 'truncate-end' }, '○ fresh session · no calls yet')
          : h(
              Text,
              { wrap: 'truncate-end' },
              h(Bar, { c0: c.accent, c1: end, pct, track: c.surface, width: W - 17 }),
              h(Text, { bold: true, color: end }, ` ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`),
              h(Text, { color: c.dim }, ` ${short(usage.context_used)}/${short(usage.context_max)}`)
            ),
        stats.length ? h(Text, { color: c.comment, wrap: 'truncate-end' }, stats.join(' · ')) : null
      ),
      3 + titleLines.length + (stats.length ? 1 : 0)
    )

    // ── TODO ── (live list, else the last one this session had, dimmed)
    const liveTodos = turn.todos ?? []
    // Keyed by the session on screen — hd.sid lags behind a switch until the DB reload lands.
    const nowSid = currentSid(ui)

    if (liveTodos.length && nowSid) {
      lastTodos.set(nowSid, liveTodos)
    }

    const todos = liveTodos.length ? liveTodos : (lastTodos.get(nowSid) ?? [])
    const todoStale = !liveTodos.length

    if (todos.length) {
      const done = todos.filter(x => x.status === 'completed').length
      // Cancelled items are listed (struck through) but not counted — same figure as the bar.
      const total = Math.max(1, todos.filter(x => x.status !== 'cancelled').length)
      const body = [
        h(
          Text,
          { key: 'tb', wrap: 'truncate-end' },
          h(Text, null, ' '),
          h(Bar, { c0: c.cyan, c1: c.accent, pct: (done / total) * 100, track: c.surface, width: W - 9 }),
          h(Text, { bold: true, color: done === total ? c.green : c.orange }, ` ${Math.round((done / total) * 100)}%`)
        )
      ]
      // keep the in-progress item in view
      const at = Math.max(0, todos.findIndex(x => x.status === 'in_progress'))
      const from = Math.max(0, Math.min(at - 3, todos.length - 8))
      const shown = todos.slice(from, from + 8)

      for (const x of shown) {
        const st = x.status

        body.push(
          h(Row, {
            bold: st === 'in_progress',
            c,
            color: st === 'completed' ? c.dim : st === 'cancelled' ? c.comment : c.fg,
            glowNow: st === 'in_progress' && ui.busy ? now : null,
            key: `t${x.id}`,
            mark: st === 'completed' ? '✓' : st === 'in_progress' ? '▶' : st === 'cancelled' ? '×' : '○',
            markColor: st === 'completed' ? c.green : st === 'in_progress' ? c.orange : st === 'cancelled' ? c.comment : c.dim,
            strike: st === 'cancelled',
            text: x.content
          })
        )

        // Task flow: work delegated while this step runs hangs under it.
        if (st === 'in_progress') {
          for (const sa of subsOf(turn).filter(inFlight).slice(0, 3)) {
            const startMs = sa.startedAt ? (sa.startedAt < 1e12 ? sa.startedAt * 1000 : sa.startedAt) : 0

            body.push(
              h(
                Text,
                { key: `tf${sa.id}`, wrap: 'truncate-end' },
                h(Text, { color: c.comment }, '   ↳ '),
                h(Text, { color: c.orange }, `${spin} `),
                h(Text, { bold: true, color: c.pink }, `${routeOf(sa.goal, data, sa.model) ?? 'task'} `),
                h(Text, { color: c.dim }, fit(sa.goal, Math.max(6, W - 22))),
                h(Text, { color: c.comment }, startMs ? `  ${dur(now - startMs)}` : '')
              )
            )
          }
        }
      }

      if (todos.length > shown.length) {
        body.push(h(Text, { color: c.comment, key: 'tm' }, ` …and ${todos.length - shown.length} more`))
      }

      section(
        'todo',
        h(Head, {
          c,
          icon: IC.todo,
          right: `${todoStale ? 'last turn · ' : ''}${done}/${total}`,
          rightColor: done === total ? c.green : todoStale ? c.dim : c.orange,
          title: 'TODO'
        }),
        body
      )
    }

    // ── SUBAGENTS: route chips + live tasks + finished tasks ──
    const states = routeStates()
    const subs = subsOf(turn)
    const kids = data?.kids ?? []

    if (states.size || subs.length || kids.length) {
      const chip = (r, st) =>
        st === 'active'
          ? { bg: Math.floor(now / 300) % 2 ? c.orange : c.yellow, bold: true, fg: c.deeper, text: `${spin} ${r}` }
          : st === 'done'
            ? { bg: c.line, bold: true, fg: c.green, text: `✓ ${r}` }
            : st === 'failed'
              ? { bg: c.line, bold: true, fg: c.red, text: `× ${r}` }
              : { bg: c.surface, fg: c.idle, text: `· ${r}` }
      const body = chipRows([...states].map(([r, st]) => chip(r, st)), 'rc')
      const live = subs.slice(-5)

      for (const s of live) {
        const r = routeOf(s.goal, data, s.model) ?? 'task'
        const running = inFlight(s)
        const bad = s.status === 'failed' || s.status === 'error' || s.status === 'interrupted'
        const startMs = s.startedAt ? (s.startedAt < 1e12 ? s.startedAt * 1000 : s.startedAt) : 0
        const right = running
          ? `${s.toolCount ? `${s.toolCount}⚒ ` : ''}${startMs ? dur(now - startMs) : ''}`.trim()
          : s.durationSeconds
            ? dur(s.durationSeconds * 1000)
            : ''

        body.push(
          h(Row, {
            bold: running,
            c,
            color: running ? c.fg : c.dim,
            glowNow: running ? now : null,
            key: `ls${s.id}`,
            mark: running ? spin : s.status === 'completed' ? '✓' : bad ? '×' : '○',
            markColor: running ? c.orange : s.status === 'completed' ? c.green : bad ? c.red : c.dim,
            right,
            rightColor: running ? c.orange : c.comment,
            text: `${r} › ${s.goal}`
          })
        )
      }

      // Finished = the child session has ended and isn't one of the live rows above.
      const liveKey = g => String(g ?? '').slice(0, 24).toLowerCase()
      const liveGoals = new Set(live.map(q => liveKey(q.goal)))
      const finished = kids.filter(k => k.en && !liveGoals.has(liveKey(k.goal))).slice(-3)

      for (const k of finished) {
        const bad = k.endReason && !/close|complete|done|stop|finish/i.test(k.endReason)

        body.push(
          h(Row, {
            c,
            color: c.dim,
            key: `k${k.id}`,
            mark: bad ? '×' : '✓',
            markColor: bad ? c.red : c.green,
            right: k.en && k.st ? dur((k.en - k.st) * 1000) : '',
            rightColor: c.comment,
            text: `${k.profile} › ${k.goal}`
          })
        )
      }

      // Tasks in flight (same count as the bar's task cell); routes lit by DB children only when the
      // roster has none (e.g. right after a reload).
      const activeN = subs.filter(inFlight).length || [...states.values()].filter(x => x === 'active').length

      section(
        'subs',
        h(Head, { c, icon: IC.team, right: activeN ? `${activeN} running` : kids.length ? `${kids.length} done` : 'unused', rightColor: activeN ? c.orange : c.dim, title: 'SUBAGENTS' }),
        body
      )
    }

    // ── RUNNING tools ──
    const running = (turn.tools ?? []).filter(x => x?.name && x.name !== 'skill_view')

    if (running.length) {
      section(
        'run',
        h(Head, { c, icon: IC.run, right: `${running.length}`, rightColor: c.cyan, title: 'RUNNING' }),
        running.slice(0, 4).map(tool => {
          const server = mcpServer(tool.name) ?? mcpServer(tool.context)

          return h(Row, {
            c,
            color: c.fg,
            glowNow: now,
            key: tool.id ?? tool.name,
            mark: spin,
            markColor: server ? c.pink : c.cyan,
            right: tool.startedAt ? dur(now - tool.startedAt) : '',
            text: server ? `${server} › ${String(tool.name).split('__').pop()}` : `${tool.name}${tool.context ? `  ${tool.context}` : ''}`
          })
        })
      )
    }

    // ── MCP rows (built first: their height is reserved before the skill wall) ──
    const servers = Array.isArray(info.mcp_servers) ? info.mcp_servers : []
    const mcpUse = data?.mcp ?? new Map()
    const mcpLive = new Set((turn.tools ?? []).map(x => mcpServer(x?.name) ?? mcpServer(x?.context)).filter(Boolean))
    const mcpRows = servers.map(m => {
      const name = String(m.name ?? '?')
      const up = m.connected || m.status === 'connected'
      const lazy = m.status === 'lazy' || m.status === 'configured'
      const inUse = mcpLive.has(name)
      const u = mcpUse.get(name)
      const word = inUse ? 'calling' : up ? 'online' : lazy ? 'standby' : m.status === 'connecting' ? 'connecting' : m.status === 'disabled' ? 'off' : 'error'
      const dot = inUse ? c.orange : up ? c.green : lazy ? c.dim : m.status === 'connecting' ? c.yellow : m.status === 'disabled' ? c.comment : c.red

      return h(Row, {
        bold: inUse,
        c,
        color: up || lazy || inUse ? c.fg : c.dim,
        glowNow: inUse ? now : null,
        key: `m${name}`,
        mark: inUse ? spin : '●',
        markColor: dot,
        right: u ? `${word} · ${u.n}× ${ago(u.at)}` : word,
        rightColor: inUse ? c.orange : u ? c.cyan : dot === c.red ? c.red : c.comment,
        text: name
      })
    })

    // ── SKILLS: used list + wall ──
    const live = new Map()

    for (const tool of turn.tools ?? []) {
      if (tool?.name === 'skill_view') {
        const raw = String(tool.context || tool.verboseArgs || '')
        const name = raw.match(/["']?name["']?\s*[:=]\s*["']([^"']+)/)?.[1] ?? raw.replace(/^[\s"'{]+|[\s"'}]+$/g, '')

        live.set(name || 'skill', tool.startedAt ?? now)
      }
    }

    if (hd.sid !== litSid) {
      litSid = hd.sid
      litAt.clear()
      litPrimed = false
    }

    const usedKeys = new Set([...(data?.skills?.keys() ?? [])].map(skillKey))
    const liveKeys = new Set([...live.keys()].map(skillKey))

    if (data) {
      for (const k of usedKeys) {
        if (!litAt.has(k)) {
          litAt.set(k, litPrimed ? now : 0)

          if (litPrimed) {
            flashUntil = Math.max(flashUntil, now + FLASH_MS)
          }
        }
      }

      litPrimed = true
    }

    const skillBody = []

    const catalog = []
    const seen = new Set()

    for (const names of Object.values(info.skills ?? {})) {
      for (const n of Array.isArray(names) ? names : []) {
        const k = skillKey(n)

        if (k && !seen.has(k)) {
          seen.add(k)
          catalog.push(String(n))
        }
      }
    }

    // Skills used/loading that the catalog doesn't list still get a tile.
    for (const n of [...live.keys(), ...(data?.skills?.keys() ?? [])]) {
      const k = skillKey(n)

      if (k && !seen.has(k)) {
        seen.add(k)
        catalog.push(String(n).split(':').pop())
      }
    }

    // Compact: at most 2 rows of tiles. Loading skills first (pulsing), then the
    // ones used this session (most recent first, lit), then the rest dimmed.
    // Nothing folds by itself — sections stay open until the user clicks a header.
    const mcpOpen = isOpen('mcp')
    const filesN = Math.min(6, data?.files?.size ?? 0)
    const reserve = (mcpRows.length ? (mcpOpen ? mcpRows.length + 2 : 2) : 0) + (filesN ? filesN + 2 : 0) + 3 // + footer
    const room = Math.max(0, Math.min(2, rows - used - 3 - reserve))
    const recent = [...(data?.skills?.keys() ?? [])].map(skillKey).reverse()
    const rank = name => {
      const k = skillKey(name)

      return liveKeys.has(k) ? 0 : usedKeys.has(k) ? 1 + recent.indexOf(k) / 1000 : 2
    }
    const pulse = Math.floor(now / 260) % 2
    const tiles = [...catalog].sort((a, b) => rank(a) - rank(b)).map(name => {
      const k = skillKey(name)
      const label = fit(name.split(':').pop(), W - 6)
      const age = now - (litAt.get(k) ?? 0)

      if (liveKeys.has(k)) {
        return { bg: pulse ? c.orange : c.yellow, bold: true, fg: c.deeper, text: `${spin} ${label}` }
      }

      if (usedKeys.has(k) && (litAt.get(k) ?? 0) > 0 && age < FLASH_MS) {
        const f = age / FLASH_MS

        return f < 0.4
          ? { bg: c.green, bold: true, fg: c.deeper, text: label }
          : f < 0.75
            ? { bg: mixHex(c.green, c.line, 0.6), bold: true, fg: c.deeper, text: label }
            : { bg: c.line, bold: true, fg: c.green, text: label }
      }

      return usedKeys.has(k) ? { bg: c.line, bold: true, fg: c.green, text: `✓ ${label}` } : { bg: c.surface, fg: c.idle, text: label }
    })
    const wall = room > 0 ? chipRows(tiles, 'w', room) : []
    const wallShown = wall.reduce((n, el) => n + (el.props?.items?.length ?? 0), 0)

    skillBody.push(...wall)

    if (catalog.length > wallShown) {
      skillBody.push(h(Text, { color: c.comment, key: 'wm' }, ` +${catalog.length - wallShown} skill · /skills`))
    }

    const usedN = usedKeys.size + [...liveKeys].filter(k => !usedKeys.has(k)).length

    section(
      'skills',
      h(Head, { c, icon: IC.puzzle, right: `${usedN} used · ${catalog.length || '–'}`, rightColor: liveKeys.size ? c.orange : usedN ? c.green : c.dim, title: 'SKILLS' }),
      skillBody
    )

    // ── MCP ──
    const upN = servers.filter(m => m.connected || m.status === 'connected').length
    const callsN = [...mcpUse.values()].reduce((n, u) => n + u.n, 0)

    section(
      'mcp',
      h(Head, {
        c,
        icon: IC.mcp,
        right: mcpLive.size ? `${mcpLive.size} calling` : `${upN}/${servers.length}${callsN ? ` · ${callsN} calls` : ''}`,
        rightColor: mcpLive.size ? c.orange : upN === servers.length ? c.green : c.yellow,
        title: 'MCP'
      }),
      mcpRows
    )

    // ── FILES ──
    if (filesN) {
      section(
        'files',
        h(Head, { c, icon: IC.file, right: `${data.files.size}`, title: 'FILES' }),
        [...data.files]
          .reverse()
          .slice(0, filesN)
          .map(([p, f]) =>
            h(Row, {
              c,
              color: c.fg,
              key: p,
              mark: f.created && f.n === 1 ? '+' : '~',
              markColor: f.created && f.n === 1 ? c.green : c.orange,
              right: f.sub ? 'subagent' : f.n > 1 ? `${f.n}×` : '',
              rightColor: c.comment,
              text: tail(p, W - 14)
            })
          )
      )
    }

    // ── claude-sub block (pinned in the footer, under the cwd line) ──
    // Lit while Claude Code works (pulsing chip, glowing row, turns · last tool · time); a job that just
    // ended flashes green/red; history of the last day with each outcome; a scope-gate denial in red.
    const claudeParts = (() => {
      const jobs = claude.jobs
      const nowS = now / 1000
      const live = jobs.filter(j => CLAUDE_LIVE.has(j.status))
      const hist = jobs.filter(j => !CLAUDE_LIVE.has(j.status) && nowS - (j.endedAt || j.startedAt) < CLAUDE_HISTORY_S)
      const histMax = 3
      const parts = { deny: null, head: null, hist: [], live: [], prov: [], say: null }
      const flashing = claude.flash && now < claude.flash.until ? jobs.find(j => j.id === claude.flash.id) : null
      const OUTCOME = {
        cancelled: { color: c.dim, label: 'cancelled', mark: '⊘' },
        done: { color: c.green, label: '', mark: '✓' },
        error: { color: c.red, label: 'error', mark: '×' },
        lost: { color: c.red, label: 'lost', mark: '?' },
        rate_limited: { color: c.yellow, label: 'limit', mark: '◔' },
        timeout: { color: c.orange, label: 'timeout', mark: '◷' }
      }
      const outcome = st => OUTCOME[st] ?? { color: c.dim, label: st, mark: '·' }
      const todayN = hist.length
      const deniedN = jobs.reduce((n, j) => n + (nowS - (j.endedAt || j.startedAt || nowS) < CLAUDE_HISTORY_S ? j.denials : 0), 0)
      let chip
      let tail = ''
      let tailColor = c.dim

      // Which Claude: model · effort of the newest job (claude-sub's own settings, so a change shows up).
      const top = live[0] ?? jobs[0]
      const who = top?.model ? `${top.model.replace(/^claude-/, '')}${top.effort ? `·${top.effort}` : ''}` : ''

      if (live.length) {
        const j = live[0]
        const startMs = j.startedAt ? j.startedAt * 1000 : now

        chip = { bg: Math.floor(now / 300) % 2 ? c.orange : c.yellow, fg: c.deeper, text: `${spin} claude` }
        tail = [who, dur(now - startMs), live.length > 1 ? `${live.length} jobs` : j.status === 'cancelling' ? 'cancelling' : j.status === 'starting' ? 'starting' : '']
          .filter(Boolean).join(' · ')
        tailColor = c.orange
      } else if (flashing) {
        const o = outcome(flashing.status)

        chip = { bg: flashing.status === 'done' ? c.green : o.color, fg: c.deeper, text: `${o.mark} claude` }
        tail = [who, flashing.status === 'done' ? 'done' : o.label].filter(Boolean).join(' · ')
        tailColor = o.color
      } else {
        chip = { bg: c.surface, fg: c.idle, text: '✻ claude' }
        tail = [who, todayN ? `${todayN} today` : 'idle'].filter(Boolean).join(' · ')
      }

      parts.head = (
        h(
          Text,
          { key: 'cl-h', wrap: 'truncate-end' },
          h(Pill, { bg: chip.bg, fg: chip.fg, text: chip.text }),
          h(Text, { color: tailColor }, ` ${fit(tail, W - chip.text.length - 4 - (deniedN ? 4 : 0))}`),
          deniedN ? h(Text, { bold: true, color: c.red }, ` ✗${deniedN}`) : null
        )
      )

      // Live jobs: the task, then what Claude is doing right now (tool → its file / command / pattern)
      // and, for the first job, the last thing it said — so a working Claude is visibly working.
      // Each live line carries a rank for shedding: 0 the task, 1 what it is doing, 2 its last words.
      live.slice(0, 2).forEach((j, i) => {
        parts.live.push(
          { rank: 0, node: h(Row, {
            bold: true,
            c,
            color: c.fg,
            edge: c.orange,
            glowNow: now,
            key: `cl-l${j.id}`,
            mark: spin,
            markColor: c.orange,
            right: `${j.resume ? '↻ ' : ''}${j.denials ? `✗${j.denials} ` : ''}`.trim(),
            rightColor: j.denials ? c.red : c.comment,
            text: j.task || j.id
          }) }
        )

        const doing = j.tool ? `${j.tool}${j.target ? ` ${j.target}` : ''}` : j.status === 'starting' ? 'starting Claude Code…' : 'thinking…'

        parts.live.push({
          rank: 1,
          node: h(Row, { c, color: c.orange, edge: c.orange, key: `cl-a${j.id}`, mark: '›', markColor: c.orange, right: j.turns ? `turn ${j.turns}` : '', rightColor: c.comment, text: doing })
        })

        if (i === 0 && j.say) {
          parts.live.push({ rank: 2, node: h(Edged, { color: c.dim, edge: c.orange, italic: true, key: `cl-s${j.id}`, text: `  “${fit(j.say, W - 6)}”` }) })
        }
      })

      // The job that just ended: what Claude reported (first words of its result).
      const ended = flashing ?? (hist[0] && nowS - hist[0].endedAt < 120 ? hist[0] : null)

      if (!live.length && ended?.say) {
        parts.say = h(Edged, { color: c.dim, edge: outcome(ended.status).color, italic: true, key: 'cl-r', text: `  “${fit(ended.say, W - 6)}”` })
      }

      // Other providers the routes run on (Coarena for researcher today): model(s) and routes read from
      // the configs, lit while one of those routes works, with the goal it is working on.
      for (const g of globalThis.__hyProviderLines?.() ?? []) {
        const on = g.state === 'active'
        const gchip = on
          ? { bg: Math.floor(now / 300) % 2 ? c.purple : c.cyan, fg: c.deeper, text: `${spin} ${g.label}` }
          : g.state === 'done'
            ? { bg: c.line, fg: c.green, text: `✓ ${g.label}` }
            : g.state === 'failed'
              ? { bg: c.line, fg: c.red, text: `× ${g.label}` }
              : { bg: c.surface, fg: c.idle, text: `◇ ${g.label}` }

        parts.prov.push(
          h(
            Text,
            { key: `pv-${g.provider}`, wrap: 'truncate-end' },
            h(Pill, { bg: gchip.bg, fg: gchip.fg, text: gchip.text }),
            h(Text, { bold: on, color: on ? c.fg : c.dim }, ` ${fit(g.models.join(', '), W - gchip.text.length - 4)}`),
            h(Text, { color: c.comment }, fit(` · ${g.routes.join(', ')}`, Math.max(0, W - gchip.text.length - 4 - g.models.join(', ').length - 1)))
          )
        )

        if (on) {
          const sub = subs.find(x => inFlight(x) && g.routes.includes(routeOf(x.goal, data, x.model) ?? ''))

          if (sub?.goal) {
            parts.prov.push(h(Edged, { color: c.purple, edge: c.purple, key: `pv-g${g.provider}`, text: `› ${fit(sub.goal, W - 5)}` }))
          }
        }
      }

      for (const j of hist.slice(0, histMax)) {
        const o = outcome(j.status)
        const flash = flashing?.id === j.id

        parts.hist.push(
          h(Row, {
            bold: flash,
            c,
            color: flash ? c.fg : c.dim,
            edge: o.color,
            key: `cl-d${j.id}`,
            mark: o.mark,
            markColor: o.color,
            // ✗N denials · outcome word (how long it ran, for done) · how long ago it ended
            right: [j.denials ? `✗${j.denials}` : '', o.label || (j.elapsed ? dur(j.elapsed * 1000) : ''), agoShort(j.endedAt || j.startedAt)]
              .filter(Boolean).join(' · '),
            rightColor: j.denials || j.status === 'error' || j.status === 'lost' ? c.red : c.comment,
            text: j.task || j.id
          })
        )
      }

      // The newest job that was refused something: what the guard said (rule · path), in red.
      const refused = [...live, ...hist.slice(0, histMax)].find(j => j.denials && j.lastDenial)

      if (refused) {
        const why = refused.lastDenial.replace(/^.*?\[scope-gate\]\s*(stopped:\s*)?/, '').replace(/\s+—.*$/, '')

        parts.deny = h(Edged, { color: c.red, edge: c.red, key: 'cl-x', text: `✗ ${fit(why, W - 4)}` })
      }

      return parts
    })()

    const cp = claudeParts
    const claudeFull = 1 + cp.live.length + cp.prov.length + cp.hist.length + (cp.deny ? 1 : 0) + (cp.say ? 1 : 0)
    // At most n lines, kept by priority — header, the live tasks, the denial line, what each live job
    // is doing, the other providers, Claude's last words, the last result, history (oldest goes first) —
    // and shown in reading order: Claude first, the other providers under it.
    const claudeBlock = n => {
      let room = Math.max(0, n - 1)
      const take = list => {
        const got = list.slice(0, Math.max(0, room))
        room -= got.length

        return got
      }
      const kept = new Set()
      const keep = list => take(list).forEach(x => kept.add(x))

      keep(cp.live.filter(x => x.rank === 0))
      const deny = take(cp.deny ? [cp.deny] : [])
      keep(cp.live.filter(x => x.rank === 1))
      const prov = take(cp.prov)
      keep(cp.live.filter(x => x.rank === 2))
      const say = take(cp.say ? [cp.say] : [])
      const hist = take(cp.hist)
      const live = cp.live.filter(x => kept.has(x)).map(x => x.node)

      return [cp.head, ...live, ...say, ...hist, ...deny, ...prov]
    }

    // Fit the rail: drop whole sections from the bottom (files, MCP, skills …) until the rest and
    // the footer (cwd, the claude block, the hint line) fit; the title block, TODO and SUBAGENTS come
    // first and stay longest.
    let claudeN = Math.min(claudeFull, Math.max(1, Math.floor(rows / 3)))
    let FOOT = 3 + claudeN

    while (used + FOOT > rows && nodes.length > 1) {
      const lines = nodeLines.pop()
      const trim = nodeTrim.pop()
      nodes.pop()
      used -= lines

      // The section that crosses the line sheds rows instead of disappearing whole.
      const room = rows - FOOT - used
      const smaller = trim && room >= 4 ? trim(room) : null

      if (smaller) {
        push(smaller, room)
        break
      }
    }

    // Still too tall with only the title block left (a very short rail): the claude block shrinks
    // toward its header line before the footer gives up.
    if (used + FOOT > rows) {
      claudeN = Math.max(1, rows - used - 3)
      FOOT = 3 + claudeN
    }

    const footOn = used + FOOT <= rows

    // Room to spare on a measured rail (it runs the full height of the screen): the claude block
    // takes what it can still show, and the footer sits at the bottom of the rail.
    let footGap = 0

    if (footOn && railH > 0) {
      const grow = Math.min(rows - used - FOOT, claudeFull - claudeN)

      if (grow > 0) {
        claudeN += grow
        FOOT += grow
      }

      footGap = Math.max(0, rows - used - FOOT)
    }

    const claudeRows = claudeBlock(claudeN)

    // ── pinned footer: cwd · branch ──
    footOn && nodes.push(
      h(
        Box,
        { flexDirection: 'column', flexShrink: 0, key: 'foot', marginTop: 1 + footGap },
        info.cwd
          ? h(
              Text,
              { color: c.dim, wrap: 'truncate-end' },
              `${IC.folder} ${tail(info.cwd, W - (info.branch ? 18 : 4))}`,
              info.branch ? h(Text, { color: c.accent }, `  ${IC.branch} ${fit(info.branch, 12)}`) : null
            )
          : null,
        ...claudeRows,
        h(Text, { color: c.comment }, '/hy-sidebar · ^X sessions · /hy-tabs')
      )
    )

    // key = rail height: when the rail resizes, remount the panel so Ink paints it fresh. Otherwise
    // Ink blits unchanged rows from the previous frame at their old offsets — rows that were clipped
    // a moment ago come back as stale, overlapping text.
    return h(Box, { flexDirection: 'column', flexShrink: 0, key: `rail-${rows}`, ref: rootRef, width: W }, ...nodes)
  }

  let app

  try {
    app = defineWidgetApp({
      help: 'hy sidebar — live session panel: context, subagents, todo, tools, skills, MCP, files',
      id: ID,
      init: () => ({ v: 1 }),
      mode: 'ambient',
      reduce: (state, input) => (input?.key?.escape ? null : state),
      render: () => h(Sidebar),
      width: WIDTH,
      zone: 'top-right'
    })
  } catch {
    return
  }

  // ── auto open on wide terminals / auto hide on narrow ones ──
  const isOpen = b => (b.overlay.get().ambient ?? []).some(a => a.appId === ID)
  let userChoice = null
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

  if (!globalThis.__hySidebarBooted) {
    globalThis.__hySidebarBooted = true

    let tries = 0
    const boot = () => {
      if (bridge()) {
        startLoader() // tabs use the data even with the sidebar closed
        startClaude() // the powerline's claude cell reads it while the sidebar is closed

        if (process.env.HY_SIDEBAR !== '0') {
          sync()
          process.stdout.on?.('resize', () => setTimeout(sync, 60))
        }
      } else if (++tries < 20) {
        setTimeout(boot, 250)
      }
    }

    setTimeout(boot, 300)
  }
}
