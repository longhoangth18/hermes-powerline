# hermes-powerline

A powerline status bar and prompt, an editor-grade code / diff / table view, an OpenCode-style live sidebar, session tabs and a matching theme for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) TUI — one look for every way you open Hermes, and it survives `hermes update`.

```
 ╭ ⚑ hermes  default  ⠹ working ╮                           ┃ ▍ CONTEXT 3%
 │ ▌ python · app/rate_limit.py                    12 lines ┃  ▉░░░░░░░░░░░░░░  28k/1M
 │   1 │ @dataclass                                         ┃  deepseek-v4.1-flash · high
 │   2 │ class Bucket:                                      ┃ ▍ SKILLS 2
 │   3 │     """Token bucket — refills per second."""       ┃  ⠼ superpowers:brainstorming 2s
 │ ▌ app/rate_limit.py                              +2 −1   ┃  ✓ hermes-lcm
 │  12 12      def take(self, n: int = 1) -> bool:          ┃ ▍ RUNNING 1
 │  13    −        now = time.time()                        ┃  ⠼ terminal  pytest -q        4s
 │     13 +        now = time.monotonic()                   ┃ ▍ TODO 1/3   ▍ FILES 2   ▍ MCP 7/8
 ! YOLO › ready › model › 42k/1M ▉▉░░ 4% › 52 t/s › 3.2s            ‹ ~/proj ‹ main ‹ 12m 04s
 user › host › hermes                              ‹ cpu 7% ‹ gpu 8% ‹ 14.6/32G ‹ 176/245G ‹ 36°C
 ❯ Ask me anything…
 ⌂ ( ✓ 1 refactor rate limiter ) ( ⠼ 2 pentest notes ) ( ✓ 3 docs )              ^X switch · /new
```

| Piece | What you get |
| --- | --- |
| **Status bar + prompt** | Two powerline rows; every bar dark at the screen edge → lighter toward the middle (Dracula canvas tones on truecolor, exact xterm greys at 256 colours); thin `›` chevrons; before the clock, a git cell for the working tree (`±3 ?1 ↑2`, `✓` when clean). A **claude** cell lights up while Claude Code (the claude-sub MCP server behind the coder route) works — pulsing, spinner, time, `✗N` for scope-gate denials, and when the row has room a running-text line of what it does right now (`Edit parser/tok.py · turn 3 · “its last words”`, scrolling when longer than the room) — and flashes green/red for 4 s when the job ends; next to it a **provider** cell (`◇ coarena ⠋ kimi-k3-1-pro`, model read from the profile configs, so a model change shows up by itself) pulses while a route on another provider works. Both show with or without the sidebar and hide when idle (`HERMES_POWERLINE_CLAUDE=0` turns them off). The processes / live-agents dock above the bar is restyled (`src/dock.tsx`; `HERMES_POWERLINE_DOCK=0` → stock): a dark band (xterm 235 — stock's green tint turns into a light grey slab on 256-colour terminals such as Termius), powerline headers like the bar (`PROCESSES › 2 running · 2 done`, keycap hints), a state-coloured edge per row, each process named by its own `echo "[tag] text"` with the tag as a rounded pill (else the command minus its `cd dir &&`), spinner while it runs, last output in italics, and on the right the folder, run time, or the exit verdict as a green/red pill ([screenshot](docs/img/dock.png)). With the hy sidebar open, its rail runs the **full height** of the screen and everything below the transcript (goal bar, dock, both bar rows, input, tabs) sits to its left, so nothing is ever drawn under or across the rail; the rail's footer (cwd, claude block) sits at its bottom, next to the bar (`HERMES_POWERLINE_RAIL_FULL=0` → stock layout). While the hy sidebar is open, cells it already shows (model, context, cache, title/folder/branch, subagents) leave the bar — no duplicated information. |
| **Code view** | Editor panel per fenced block: language chip + icon (`lang:path` shows the file), line numbers, soft-wrap, multi-line tokenizer for ~30 languages with the Dracula spec mapping (keywords pink, strings yellow, numbers orange, functions green, types cyan italic, constants purple italic, decorators green italic, comments `#6272A4` italic). |
| **Diff view** | Unified diffs and Hermes' inline `patch`/`write_file` diffs: per-file header with `+N −M`, old/new line numbers, `#1A3A1A`/`#3A1A1A` rows, code highlighted by file type. |
| **Markdown** | Dracula markdown: H1 band, `▍` H2, `◆` H3, bold orange, italic yellow, inline code as green chips, `▌` yellow quotes, coloured bullets / numbers / task boxes, `─ ◆ ─` rules, bordered tables. Final answers a plugin coloured with ANSI stay markdown (stock Hermes renders them raw). |
| **Result cards** | Background results Hermes injects as messages (`[ASYNC DELEGATION BATCH COMPLETE …]` etc.) become a card: status chip, timing, one line per task (✓/✗, goal, calls, time), JSON summaries as `key: value`, the rest as markdown, transcript path; the instruction paragraph meant for the model is hidden. |
| **hy sidebar** | Right rail (auto ≥ 112 cols, `/hy-sidebar`): title · model · context gauge · calls/tokens/cache · **TODO** with progress bar and the task flow (subagents working on the current step hang under it) · **SUBAGENTS** — one chip per route (`~/.hermes/profiles/*`) lit while active, ✓ when it ran, plus live and finished tasks with route › goal and timers · RUNNING tools · compact **SKILLS** (2 rows: loading ones pulse, used ones lit and first, `+N`) · **MCP** servers with health, *calling* while in use, calls this session and when · **FILES** written/patched (subagent-tagged) · cwd/branch pinned at the bottom, and right under it the **claude** block: a chip with the model·effort lit while Claude Code works (spinner · time), per live job the task, a `› Tool file-or-command  turn N` row and Claude's last words in quotes, the result's first words for a job that just ended, the last day's jobs (`✓` done `×` error `◔` usage limit `◷` timeout `⊘` cancelled `?` lost, with run time and age), a red `✗` line naming what the scope-gate refused, and under it one line per other provider the routes run on (`◇ coarena  kimi-k3-1-pro · researcher`, lit with the goal while that route works). As the rail gets short it sheds history first; the live task and the denial line go last. Click a header to fold/unfold a section (nothing folds by itself). |
| **hy tabs** | Every live session as a pill (current = green; working = spinner + glow; `?` = waiting); click to switch, `×` to close (a red `⊘` when another window owns it), `+` for a new session; subagent route chips on the right. |
| **hy-dracula theme** | TUI skin + web dashboard theme: Dracula spec canvas (`#282A36`, legible `#9AA5CE` muted text) with a jade-green accent. `hy-jade` (graphite + jade) ships as an alternative. |
| **One look everywhere** | zsh hook: `hermes`, `hermes --yolo`, `hermes -p <profile>`, `hermes chat`, `hermes dashboard` (web chat runs the same TUI build) and `hy` share one build. Admin subcommands and `-z` go straight to the real binary. |

📖 Full guide (install, architecture, customising, testing, troubleshooting, design references): [docs/GUIDE.md](docs/GUIDE.md)

## Requirements

- Hermes Agent installed from source in `~/.hermes/hermes-agent` (the default installer layout), with its node dependencies.
- `node` (the version your Hermes needs; 26+ for current Hermes), `python3`, `rsync`, `git`, `bash`.
- A [Nerd Font](https://www.nerdfonts.com) in your terminal. The regular (non-"Mono") variant draws the icons larger; `hermes-powerline bigicons off` tightens the spacing for the Mono variant.
- Optional, macOS: [`macmon`](https://github.com/vladkens/macmon) for GPU and temperature. Without it the bar shows CPU, RAM and disk only.

## Install

```sh
git clone https://github.com/longhoangth18/hermes-powerline.git
cd hermes-powerline
./install.sh
hermes-powerline run        # instead of `hermes`
```

Options: `--shell` adds the zsh hook so plain `hermes` uses the same build (recommended), `--keep-skin` leaves your `display.skin` / `dashboard.theme` alone, `--copy` copies instead of symlinking.

`install.sh` symlinks this checkout into place, so updating is `git pull`:

| From this repo | Goes to | Used by |
| --- | --- | --- |
| `src/*.tsx`, `src/*.ts` | `~/.hermes/powerline/` | the build (injected into a staged copy of the Hermes TUI) |
| `bin/hermes-powerline` | `~/.local/bin/` | launcher / builder |
| `plugin/powerline-net` | `~/.hermes/plugins/` | real per-call t/s, TTFT, API errors |
| `plugin/plan-auto` | `~/.hermes/plugins/` (linked, **not** enabled) | opt-in: every file edit waits for an approved plan ([details](docs/GUIDE.md#plan-auto-plan-before-any-edit)) |
| `widgets/hy-*.mjs` | `~/.hermes/tui-widgets/` and every `~/.hermes/profiles/*/tui-widgets/` | sidebar + tabs (Hermes' official user-widget slot) |
| `skins/hy-jade.yaml` | `~/.hermes/skins/` (+ profiles) | TUI / CLI skin |
| `dashboard-themes/hy-jade.yaml` | `~/.hermes/dashboard-themes/` | web dashboard + web chat |
| `shell/hermes-powerline.zsh` | sourced from `~/.zshrc` (`--shell`) | routes interactive `hermes` launches |

Remove everything with `./uninstall.sh` (it also resets `display.skin` / `dashboard.theme` if they were `hy-jade`).

## How it works, and why updates don't break it

Hermes has no plugin API for the status bar, but it does support running a prebuilt TUI from `$HERMES_TUI_DIR`. `hermes-powerline`:

1. copies the Hermes TUI source to a staging dir **outside** the Hermes checkout (Hermes' own files are never modified, so `hermes update` never conflicts);
2. appends our source files to it and renames the stock components they replace (see *What gets injected*);
3. builds that into `~/.hermes/powerline/tui` and launches Hermes pointing at it.

The build is stamped with the Hermes commit and source state. After `hermes update` the next launch rebuilds by itself (a few seconds). Four layers keep a Hermes update from leaving you with a broken TUI:

| Layer | Catches | Result |
| --- | --- | --- |
| Anchor check at inject time | upstream renamed or removed a component or helper we use | stock TUI, with a message naming what changed |
| Typecheck of our code (appended modules and every inserted line) | a helper changed shape, or an insert names something renamed upstream | optional pieces with errors are dropped and the build retried once; a required piece → stock TUI |
| Build failure | anything else at build time | stock TUI; not retried until something changes |
| React error boundary | a runtime error while rendering | that piece falls back to the stock component |

`hermes-powerline doctor` runs the first three in a throwaway directory and reports. The `compat` workflow in this repo runs it daily against Hermes `main`.

### What gets injected — required vs optional

| Target in the Hermes TUI | Our file | How | If an update breaks the anchor |
| --- | --- | --- | --- |
| `components/appChrome.tsx` | `powerline.tsx` | rename `StatusRule` → `StatusRuleClassic`, append | **required** → stock TUI |
| `lib/prompt.ts` | `prompt.ts` | rename `composerPromptText`, append | **required** → stock TUI |
| `components/appLayout.tsx` | `promptPrefix.tsx` | rename `PromptPrefix`, append, one insert above the input rows | **required** → stock TUI |
| `components/markdown.tsx` | `codeview.tsx` | rename `renderTable` → `renderTableClassic`, append, 9 one-line inserts (code fence, heading, rule, bullet, number, quote, inline code, bold, italic) | optional → stock markdown, bar unaffected |
| `components/messageLine.tsx` | — | two inserts: injected notices → result card; ANSI-coloured final answers → markdown | optional → raw notice / raw final text |
| `app/overlayStore.ts` | `bridge.ts` | append (publishes `globalThis.__hy` for the widgets) | optional → widgets stay hidden |
| `app/liveSessions.ts`, `app/useMainApp.ts` | — | session roster; activate / close / new-session actions for the tabs | optional → tabs stay hidden |

Optional pieces are skipped one by one with a `skipped (optional): …` line; the rest still builds. At runtime every piece has its own guard: `HERMES_CODEVIEW=0` restores stock code/tables, `HY_SIDEBAR=0` / `HY_TABS=0` keep the widgets closed, and the widgets render nothing when the bridge is absent (plain stock Hermes), so installing the widgets can never clutter an un-powerlined TUI. Widget errors are caught by Hermes' own widget error boundary; a broken code panel falls back to the stock renderer for that block.

## Cost on the machine

Measured on an M-series Mac, TUI idle for 30 s: 0.29 s CPU with sidebar + tabs, 0.26 s without (≈ 1 % of one core either way). The widgets only repaint on store changes or while something animates; `state.db` is read (read-only) every 3 s while busy, 15 s idle; the inbox alarm runs `hermes inbox --json` once a minute.

## Commands

```
hermes-powerline run [hermes args…]   launch (default)
hermes-powerline doctor               dry-run compatibility check
hermes-powerline rebuild | status

palette mono|dracula|skin    edge '#RRGGBB'|off    style arrow|round|slant|flame
icons on|off    bigicons on|off    prompt on|off    cap slant|flat|round
twoline on|off  sys on|off         on|off
```

`HERMES_POWERLINE=0 hermes-powerline run` gives the classic bar for one launch.

In Hermes: `/hy-sidebar` and `/hy-tabs` toggle the widgets; `^X` is the session switcher.

| Setting | Where | Effect |
| --- | --- | --- |
| `"inbox": false` | `~/.hermes/powerline/config.json` | no inbox alarm cell |
| `"edgeThin": false` | same | bold 2-cell separators instead of the thin chevron |
| `HERMES_CODEVIEW=0` | env | stock code blocks / diffs / tables |
| `HY_SIDEBAR=0`, `HY_TABS=0` | env | widgets closed at start (toggle still works) |
| `command hermes …` | shell | bypass the zsh hook once |

## What the numbers mean

| Segment | Source | Meaning |
| --- | --- | --- |
| context `42k/200k 21%` | Hermes | tokens in the last prompt / the model's context window. A leading `~` means Hermes estimated it rather than getting it from the provider. |
| `52 t/s` | `powerline-net` plugin | generation speed of the **last** API call: its output tokens (reasoning included) ÷ the time from its first streamed chunk to its end. Nothing is averaged or summed across calls, and a delegate's calls never count toward the parent session. A call that was not streamed has no first-chunk time, so its figure is end-to-end and carries `≈`. Calls under 24 tokens or 0.4 s keep the previous figure (a tool call that arrives in one burst would otherwise read as thousands of t/s). Without the plugin: Hermes' own figure, shown as `≈52 t/s` — output ÷ wall time over the last 10 calls, wall time including the wait for the first token, so it reads low on long contexts. |
| latency `3.2s` | `powerline-net` plugin | time to first token of the last call (queue + prefill) — the part the t/s figure leaves out. Without the plugin: `≈`, Hermes' mean wall time per call. |
| API error `503 overload ↻2/3` | `powerline-net` plugin | an API call failed: HTTP status (or `timeout` / `conn` / `net` when there is none), Hermes' classified reason, and which attempt of the retry budget it was. Red = 5xx / overloaded, orange = 429, purple = other 4xx, rust = timeout / network. Pinned, never squeezed out. When a retry succeeds it turns into a dim `↺ 503 overload` for a minute; an unrecovered error disappears after 15 minutes of idleness. |
| cache `87%` | Hermes | cache-read tokens ÷ prompt tokens, whole session. |
| CPU / GPU | `macmon` | share of time the cores were active during a 0.7 s sample, every 3 s. Comparable to `top`'s 100 − idle. Without macmon: CPU from Node's counters between ticks, no GPU. |
| RAM `14.6/32G` | `macmon`, else `vm_stat` / `/proc/meminfo` | app + wired + compressed memory, the figure Activity Monitor calls "Memory Used". Binary units (GiB). |
| disk `176/245G` | `statfs` | total − available on the data volume, refreshed every 30 s. Decimal units (GB), like the size on the box. Matches `df`; Finder shows a little more free space because it also counts purgeable space. |
| temperature | `macmon` | the hotter of the CPU and GPU averages. |

Values turn orange, then red, at: CPU/GPU 70/90 %, RAM 75/90 %, disk 85/95 %, temperature 70/85 °C, context 75/90 %.

## Developing and testing

- `hermes-powerline doctor` — inject + typecheck + build in a throwaway dir.
- Simulate a Hermes update: copy the Hermes TUI to a scratch dir (symlink `node_modules`, `apps/shared`), edit an anchor there, and run `HERMES_AGENT_DIR=<copy> hermes-powerline doctor`. Breaking `markdown.tsx` or `liveSessions.ts` must print `skipped (optional)` and still build; breaking `StatusRule` must report *not compatible* and `ensure` must exit non-zero (the launcher then runs stock `hermes`).
- Visual checks: run the TUI in `tmux` (`COLORTERM=truecolor`), `tmux capture-pane -e`, render the ANSI to PNG. Quit test TUIs with `/quit` — killing them leaves orphaned live sessions in the gateway until it restarts. Mouse: send SGR sequences as literal keys (`ESC[<0;x;yM` then `ESC[<0;x;ym`).
- Widgets: the installed files are symlinks, so editing the repo does not trigger Hermes' directory watcher — run `/widgets-reload` in the TUI (or restart it).
- Design references: OpenCode and Crush sidebars, the Dracula spec (draculatheme.com/spec) and its VS Code / Vim themes (256-colour codes), WCAG contrast (muted text `#9AA5CE` ≈ 5.9:1 on `#282A36`; `#6272A4` only for rules/hints).

## Known limits

- The YOLO segment reflects the mode Hermes was started in; toggling it mid-session doesn't update it.
- Hermes forces 256 colours inside tmux. The default palette uses exact xterm-256 colours, so it looks the same there.
- Tested on macOS. The launcher avoids macOS-only tools, but Linux has only been exercised by CI's build check.

## License

MIT
