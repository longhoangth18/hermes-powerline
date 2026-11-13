// Test harness for hy-sidebar's claude-sub block: fake bridge + fake job dirs, one real Ink render,
// the frame printed as plain text. Driven by tests/test_sidebar_claude.py (needs Hermes' node_modules).
// argv: <terminal rows> <scenario: live | idle | empty | finish>; env CLAUDE_SUB_HOME = a scratch dir.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
const HA = (process.env.HERMES_AGENT_DIR || process.env.HOME + '/.hermes/hermes-agent') + '/'
const require = createRequire(HA + 'package.json')
const React = require('react')
const ink = await import(HA + 'node_modules/ink/build/index.js')
const [, , rowsArg, scenario] = process.argv
Object.defineProperty(process.stdout, 'rows', { configurable: true, value: Number(rowsArg) })
Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 140 })

// ── fake jobs ──
const home = process.env.CLAUDE_SUB_HOME, J = home + '/jobs'
fs.rmSync(home, { force: true, recursive: true }); fs.mkdirSync(J, { recursive: true })
const now = Date.now() / 1000
const sleeper = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); sleeper.unref()
let seq = 0
const job = (agoS, meta, files = {}) => {
  const d = new Date((now - agoS) * 1000), p = n => String(n).padStart(2, '0')
  const id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${(0xa00000 + seq++).toString(16)}`
  fs.mkdirSync(`${J}/${id}`); fs.writeFileSync(`${J}/${id}/meta.json`, JSON.stringify({ created_at: now - agoS, started_at: now - agoS, ...meta }))
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(`${J}/${id}/${k}`, typeof v === 'string' ? v : JSON.stringify(v))
}
const sum = (status, endAgo, extra = {}) => ({ 'summary.json': { status, ended_at: now - endAgo, elapsed_s: 14, turns: 4, files: 2, denials: 0, last_denial: '', ...extra }, 'exit.json': { code: 0, ended_at: now - endAgo } })
const ev = o => JSON.stringify(o) + '\n'
const stream = ev({ type: 'system' }) + ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }) +
  ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write' }] } }) +
  ev({ type: 'user', message: { content: [{ type: 'tool_result', content: '[scope-gate] stopped: write@system for /etc/x — a protected path (…)' }] } }) +
  ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] } }) + '{"type":"assist'
if (scenario !== 'empty') {
  job(90000, { task_head: 'very old job' }, sum('done', 90000))
  job(4000, { task_head: 'add retry to uploader' }, sum('rate_limited', 3600))
  job(3000, { task_head: 'write /etc file (guard test)' }, sum('error', 2900, { denials: 1, last_denial: '[scope-gate] stopped: write@system for /etc/sg-test — a protected path' }))
  job(2000, { task_head: 'runner killed mid-way', runner_pid: 999999 })
  job(400, { task_head: 'fib.py + unittest' }, sum('done', 300))
  if (scenario !== 'idle') job(72, { task_head: 'refactor parser and add tests for the tokenizer edge cases', runner_pid: sleeper.pid, resume: 'abc' }, { 'out.jsonl': stream })
}

// ── fake bridge + sdk ──
const store = v => ({ get: () => v, listen: () => () => {} })
globalThis.__hy = { ui: store({ busy: false, info: { cwd: process.env.HOME + '/repos/hermes-powerline', branch: 'main', model: 'deepseek-v4.1-flash' }, usage: {} }),
  turn: store({ tools: [], subagents: [] }), overlay: store({ ambient: [] }), patchOverlay() {}, agents: store({}) }
let app
const mod = await import(new URL('../widgets/hy-sidebar.mjs', import.meta.url).href)
mod.default({ Box: ink.Box, Text: ink.Text, React, h: React.createElement, defineWidgetApp: cfg => (app = cfg), openWidget() {} })
let out = ''
const stdout = { columns: 42, rows: Number(rowsArg), write: s => { if (String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim()) out = s; return true }, on() {}, off() {}, isTTY: false }
const inst = ink.render(React.createElement(ink.Box, { width: 42, flexDirection: 'column' }, app.render()), { stdout, debug: true, patchConsole: false, exitOnCtrlC: false })
await new Promise(r => setTimeout(r, 1500))   // loader + claude poller + a few paints
if (scenario === 'finish') {
  const live = fs.readdirSync(J).sort().pop()
  console.log('BEFORE:', out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').find(l => l.includes('claude')))
  fs.writeFileSync(`${J}/${live}/exit.json`, JSON.stringify({ code: 0, ended_at: Date.now() / 1000 }))
  fs.writeFileSync(`${J}/${live}/summary.json`, JSON.stringify({ status: 'done', ended_at: Date.now() / 1000, elapsed_s: 73, turns: 5, files: 3, denials: 1, last_denial: '[scope-gate] stopped: write@system for /etc/x — p' }))
  await new Promise(r => setTimeout(r, 1500))
}
inst.unmount()
const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
console.log(plain.split('\n').map(l => '|' + l).join('\n'))
console.log(`(lines=${plain.split('\n').length}, budget=${Number(rowsArg) - 9})`)
try { process.kill(-sleeper.pid) } catch {} ; try { sleeper.kill() } catch {}
process.exit(0)
