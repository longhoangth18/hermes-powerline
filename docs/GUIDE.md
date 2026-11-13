# hermes-powerline — Complete guide

Everything about the "hy" interface for Hermes Agent: what it is made of, how to install it, how it runs, why `hermes update` does not break it, where to change things, how to test, and where the design comes from. Enough to rebuild it from scratch on a new machine.

---

## 1. What it is made of

| Piece | Files | What it does |
| --- | --- | --- |
| Powerline status bar (2 rows) | `src/powerline.tsx`, `src/prompt.ts`, `src/promptPrefix.tsx` | Row 1: YOLO · status · **todo** (`󰝖 2/5 · step in progress`; orange while working, green when all done, dim for 60 s after the turn, dim `—` with no list) · **tasks** (`󰀎 1 task · goal` — subagents in flight, in-turn **and** background delegations that outlive the turn; dim `0 tasks` when idle; `HERMES_POWERLINE_TODO=0` hides both) · model · context · t/s · cache · latency … folder · branch · **git tree state** (`±changed ?untracked !conflicts ↑ahead ↓behind`, or `✓`; `git status` every 8 s, hidden outside a repo, `HERMES_POWERLINE_GIT=0` turns it off) · **Coarena budget** (`$1.21/5` spent today of the free-tier $/day, orange from 50 %, red from 85 % or after a refusal; `/api/v1/usage` every 5 min with `COARENA_API_KEY`; hidden without a key; `HERMES_POWERLINE_QUOTA=0` turns it off) · clock. Row 2: user · host · agent … CPU · GPU · RAM · disk · temperature. Every bar is **dark at the screen edge → lighter toward the middle** (mirrored left/right), thin `›` chevrons between cells. While the sidebar is open, cells it already shows (model, context, cache, title/folder/branch) leave the bar, and the todo/task cells keep only their counts. On a narrow row the step/goal text goes first, then idle todo/task cells, then the title/folder cell is shortened. |
| Shared palette | `src/prompt.ts` (`HY`, `PL_GRAYS`) | Dracula on truecolor terminals; dracula/vim's xterm codes at 256 colours. Every other piece reads it. |
| Code / diff / table view | `src/codeview.tsx` | Editor panel per fenced block (language chip + icon, line numbers, soft-wrap) with a multi-line tokenizer for ~30 languages; unified diffs with per-file `+N −M`, old/new line numbers, tinted rows and highlighted code; bordered tables with right-aligned numeric columns. |
| Markdown | `src/codeview.tsx` ("markdown" part) | H1 band, H2 `▍` (green), H3 `◆` (cyan), **bold orange**, *italic yellow*, `inline code` as green chips, `▌` yellow quotes, coloured bullets / numbers / task boxes, `─ ◆ ─` rules. A final answer that a plugin coloured with ANSI (e.g. hermes-axioma's signal tags) is still rendered as markdown — stock Hermes would print it raw, which made a nicely streamed reply turn into raw markdown when it completed. |
| Result cards | `src/codeview.tsx` ("system notice cards") | Background results Hermes injects into the transcript as user-role messages (`[ASYNC DELEGATION BATCH COMPLETE — …]` and friends) become a card: status chip, timing, one line per task (✓/✗, goal, calls, duration), JSON summaries as `key: value`, everything else as markdown, transcript path. The instruction paragraph meant for the model is hidden. |
| Widget bridge | `src/bridge.ts` | Publishes the TUI stores and the palette on `globalThis.__hy` for the widgets. |
| Right sidebar | `widgets/hy-sidebar.mjs` | Title · model · context gauge · calls/tokens/cache → **TODO** (progress bar, ▶ current step, **task flow**: subagents running for that step hang under it as `↳ ⠼ coder goal 12s`; the last list stays visible after the turn as "last turn") → **SUBAGENTS** (one chip per route: pulsing while active, ✓ once it ran, dim when unused; live and finished tasks as `route › goal`) → RUNNING tools → **SKILLS** (compact: two rows of tiles, loading ones pulse, used ones lit and first, `+N`) → **MCP** (health dot + word, *calling* while in use, calls this session and how long ago) → **FILES** (written/patched, tagged when a subagent did it) → cwd · branch pinned at the bottom. The panel fits the rail's real height (measured after every paint and on resize; the rail itself clips, so nothing is drawn over the docks or the bar): sections that don't fit go from the bottom, the one at the edge keeps its header plus a `…+N` line. Counts match the bar (cancelled todos are not counted; SUBAGENTS counts tasks in flight, background delegations included). **Click a section header** to fold/unfold it (`▾`/`▸`; a folded header keeps its summary) Nothing folds by itself — every section starts open. |
| Session tabs | `widgets/hy-tabs.mjs` | Every live session as a pill — click to switch, **`×` to close**, **`+` for a new session**; current one green, working ones spin and glow; a `×` on a session another window owns flashes a red `⊘` (Hermes only lets the owning window close it); subagent route chips on the right. |
| TUI theme | `skins/hy-dracula.yaml` (default), `skins/hy-jade.yaml` (alternative) | Dracula spec canvas `#282A36` with a **jade-green accent** (`#50FA7B`) instead of Dracula's purple; muted text `#9AA5CE` (5.9:1); green → cyan logo. |
| Web dashboard theme | `dashboard-themes/hy-dracula.yaml` (+ `hy-jade.yaml`) | Same palette for `hermes dashboard` and its web chat; JetBrainsMono Nerd Font as the mono font so the web chat draws the icons. |
| Metrics plugin | `plugin/powerline-net/` | Hermes plugin that records the real per-call tokens/s, time to first token and API errors (4xx/5xx/timeouts). |
| Plan before edits (opt-in) | `plugin/plan-auto/` | Companion of the `plan-mode` plugin: the first file edit or coder delegation of a request without an approved plan turns plan mode on. See [plan-auto](#plan-auto-plan-before-any-edit). |
| zsh hook | `shell/hermes-powerline.zsh` | Makes `hermes`, `hermes --yolo`, `hermes -p <profile>`, `hermes chat`, `hermes dashboard` and `hy` share **one** build. |
| Launcher / builder | `bin/hermes-powerline` | Builds the injected TUI, rebuilds when Hermes changes, falls back to the stock TUI when it no longer fits. |

**Colour depth.** Hermes prints 24-bit colour on terminals that advertise it (iTerm2, Ghostty, WezTerm, VS Code, `COLORTERM=truecolor`) and clamps to 256 colours inside tmux and in Apple Terminal without `COLORTERM`. A tinted dark such as `#282A36` rounds to cube colour 59 (`#5f5f5f`) there, so `HY` switches backgrounds to neutral greys and accents to dracula/vim's codes: backgrounds 236/235/234, foreground 253, green 84, pink 212, purple 141, cyan 117, orange 215, yellow 228, red 203, comment 61. The detection mirrors `hermes-ink/colorize.ts`.

---

## 2. Install on a new machine

Requirements: Hermes Agent installed from source in `~/.hermes/hermes-agent` (the installer's default), `node` (≥ 26 for current Hermes), `python3`, `rsync`, `git`, `bash`, and a **Nerd Font** in the terminal (JetBrainsMono Nerd Font recommended). On macOS, `macmon` adds GPU and temperature.

```sh
git clone https://github.com/longhoangth18/hermes-powerline.git ~/repos/hermes-powerline
cd ~/repos/hermes-powerline
./install.sh --shell          # install + zsh hook so every hermes launch looks the same
exec zsh
hermes                         # or: hy   (= hermes --yolo)
```

What `install.sh` does (everything is a symlink, so updating is `git pull`):

1. Links `src/*` → `~/.hermes/powerline/` and `bin/hermes-powerline` → `~/.local/bin/`.
2. Links the `powerline-net` plugin into `~/.hermes/plugins/` and enables it. Links `plan-auto` too, but leaves it disabled (opt-in).
3. Links `widgets/*.mjs` into `~/.hermes/tui-widgets/` **and** every `~/.hermes/profiles/*/tui-widgets/`.
4. Links the skins into `~/.hermes/skins/` (and every profile) and the dashboard themes into `~/.hermes/dashboard-themes/`.
5. Sets `display.skin: hy-dracula` (default + every profile) and `dashboard.theme: hy-dracula` — skip with `--keep-skin`.
6. `--shell`: appends **one** `source …/shell/hermes-powerline.zsh` line to `~/.zshrc` (idempotent).
7. Runs `hermes-powerline doctor` against the installed Hermes.

Uninstall with `./uninstall.sh`: removes the links, disables the plugin, resets skin/theme to `default` if they were an `hy-*` one, and reminds you to drop the `~/.zshrc` line.

---

## 3. One look for every launch

The `hermes` function in `shell/hermes-powerline.zsh` routes by subcommand:

| You type | Goes through | Result |
| --- | --- | --- |
| `hermes`, `hermes --yolo`, `hermes -p coder`, `hermes --resume <id>`, `hermes chat`, `hermes -m kimi --yolo` | `hermes-powerline run …` | powerline + code view + sidebar + tabs + skin |
| `hermes dashboard` (web chat) | `hermes-powerline run dashboard` | the dashboard inherits `HERMES_TUI_DIR`, so the TUI embedded in the web chat is **the same build**; the web UI uses the `hy-dracula` theme |
| `hy …` | `hermes-powerline run --yolo …` | the same, in YOLO mode |
| `hermes config …`, `gateway`, `plugins`, `sessions`, `-z "…"`, `--version`, `inbox` … | the real binary | no build check, no overhead |

- Scripts and cron jobs never see the function (it only exists in interactive zsh), so they always call the binary.
- Bypass once: `command hermes …`. Classic bar for one launch: `HERMES_POWERLINE=0 hermes`.
- If `hermes-powerline` is missing from `PATH`, the function calls the binary — it can never break the `hermes` command.

Profiles: widgets and skins are linked into every `~/.hermes/profiles/<name>/`, so `hermes -p coder` looks exactly like the default profile.

---

## 4. Why `hermes update` does not break it

Hermes has **no plugin API for the status bar**, but it can run a prebuilt TUI from `$HERMES_TUI_DIR`. `hermes-powerline`:

1. copies the Hermes TUI source to a staging dir `~/.hermes/powerline/.stage` (**files in `~/.hermes/hermes-agent` are never modified**, so `hermes update` never conflicts);
2. injects our code into the copy (table below), typechecks our part with tsc, and builds `~/.hermes/powerline/tui`;
3. runs `hermes` with `HERMES_TUI_DIR` pointing at that build.

The build is stamped with the Hermes commit, our sources, node and the dependency state. After `hermes update` the next launch rebuilds by itself (1–3 s).

### What gets injected — required vs optional

| Hermes file | Our file | How | If an update breaks the anchor |
| --- | --- | --- | --- |
| `components/appChrome.tsx` | `powerline.tsx` | rename `StatusRule` → `StatusRuleClassic`, append | **required** → stock TUI + a message |
| `lib/prompt.ts` | `prompt.ts` | rename `composerPromptText`, append | **required** |
| `components/appLayout.tsx` | `promptPrefix.tsx` | rename `PromptPrefix`, append, one insert | **required** |
| `components/markdown.tsx` | `codeview.tsx` | rename `renderTable` → `renderTableClassic`, append, 9 one-line inserts (code fence, heading, rule, bullet, number, quote, inline code, bold, italic) | optional → stock markdown, bar unaffected |
| `components/messageLine.tsx` | — | two inserts: injected notices → result card; ANSI-coloured final answers → markdown | optional → raw notice / raw final text |
| `app/overlayStore.ts` | `bridge.ts` | append | optional → widgets stay hidden |
| `app/liveSessions.ts`, `app/useMainApp.ts` | — | session roster; switch / close / new-session actions | optional → tabs stay hidden |

Safety layers:

| Layer | Catches | Result |
| --- | --- | --- |
| Anchor check at inject time | Hermes renamed or removed something we use | required piece → stock TUI; optional piece → that piece is skipped (`skipped (optional): …`) |
| Typecheck of our code — appended modules **and** every inserted line | a helper still exists but changed shape, or an inserted line names something upstream renamed | errors only in optional pieces → those pieces are dropped and the build is retried once (`retrying without …`); an error in a required piece → stock TUI |
| Build failure | anything else | stock TUI; `.failed-stamp` stops retrying until something changes (`hermes-powerline rebuild` forces it) |
| Runtime | a render error | React error boundary → stock component; widget errors → Hermes' widget error chip; a code panel error → stock rendering for that block |
| Widgets without the bridge | plain `hermes` not through powerline | widgets never open and render nothing |

Verified against a **fake Hermes copy**: breaking the `markdown.tsx` / `messageLine.tsx` / `liveSessions.ts` anchors prints `skipped (optional)` and still builds; breaking `StatusRule` makes doctor report *not compatible*, `ensure` exits 1 and the launcher runs stock `hermes`.

CI (`.github/workflows/compat.yml`) runs `doctor` daily against Hermes `main`, plus shell and widget syntax checks.

---

## 5. Commands and settings

```
hermes-powerline run [hermes args…]   launch (the zsh hook calls this)
hermes-powerline doctor               compatibility check in a throwaway dir
hermes-powerline rebuild | status
palette mono|dracula|skin   edge '#RRGGBB'|off   style arrow|round|slant|flame
icons on|off   bigicons on|off   prompt on|off   cap slant|flat|round
twoline on|off sys on|off        on|off
```

Inside Hermes: `/hy-sidebar` toggles the sidebar, `/hy-tabs` the tabs, `^X` opens the session switcher, `/new` starts a session, `/widgets-reload` reloads the widgets.

| Want | Do |
| --- | --- |
| No inbox alarm cell | `~/.hermes/powerline/config.json`: `"inbox": false` |
| Bold 2-cell separators | `config.json`: `"edgeThin": false` |
| Stock code / tables / markdown | `HERMES_CODEVIEW=0` |
| Widgets closed at startup | `HY_SIDEBAR=0`, `HY_TABS=0` |
| Graphite + jade look instead of Dracula | `hermes config set display.skin hy-jade` and `hermes config set dashboard.theme hy-jade` |
| Force 24-bit colour | `HERMES_TUI_TRUECOLOR=1` (Hermes' own switch; `HY` follows it) |

### plan-auto: plan before any edit

The [`plan-mode`](https://github.com/100yenadmin/hermes-plan-mode) plugin only turns on with `/plan`, `/planmode on` or when the agent calls `plan_mode(on)` itself — and in practice models skip that even when the system prompt tells them to. `plan-auto` turns it on for the agent **at the moment it first tries to change something**: the first `write_file` / `patch`, or `delegate_task` to the `coder` route (including tasks with no `profile`, which `delegation.backends.profile_routes.default` sends there), in a request with no approved plan is blocked, plan mode goes on through plan-mode's own command path, and the block message carries plan-mode's planning note — the agent plans and asks for approval in the same turn.

- **Enable:** `hermes plugins enable plan-auto` (needs `plan-mode` enabled; hot-loads, no restart). **Disable:** `hermes plugins disable plan-auto`, or `HERMES_PLAN_AUTO=0` for one launch.
- **No cost for questions.** A request that changes nothing never touches plan mode — no extra model round-trip. (The first version switched plan mode on at the start of every turn; the agent then spent one call on `plan_mode off` for every question: 7–10 s of dead air before the answer streamed.)
- **Only an approved plan opens the gate.** The agent switching plan mode off itself does not; a small follow-up edit after an approved plan, in the same turn, passes; the next request plans again.
- **Not gated:** `terminal` and `execute_code` (cannot be told apart from reads; SOUL routes code to `coder` anyway).
- **Skipped:** delegated children (the coder doing approved work), cron, one-shot runs (`-z`, `-q/--query`, `--query-file`, `-Q`), non-terminal surfaces (messaging platforms, desktop), and requests with `làm luôn`, `không cần plan`, `skip plan`, `no plan`. Hermes' own injected turns (`[ASYNC DELEGATION …]`) keep the user's request and its opt-out.
- **Trace:** one line per decision in `~/.cache/plan-auto/trace.log` (rotates at 512 KB; `HERMES_PLAN_AUTO_TRACE=0` turns it off).
- **Editing it:** the gateway keeps plugin code loaded; after a change run `hermes plugins disable plan-auto && hermes plugins enable plan-auto` to load the new code.
- **System prompt.** Say the same thing in your `SOUL.md`, e.g. *"Any request that edits files is planned (plan_mode on → plan → submit) and approved before the change; questions, research and running things never need plan mode. If a write is blocked with a `[plan-auto]` note, plan and submit — do not turn plan mode off."*

---

## 6. Where to change things

| Change | Where |
| --- | --- |
| Palette (all surfaces) | `HY` in `src/prompt.ts` — truecolor and 256-colour values side by side; `HY.accent` is the one accent colour (green). |
| Edge → middle bar shading | `plEdgeGray(d, n)` in `src/prompt.ts` (`d` = distance from the bar's outer edge, `n` = cells in the bar) over `PL_GRAYS`. |
| Thin separators | `PL_LOOK.thin` / `thinOf()` in `src/prompt.ts`; drawn by `sepR` and `arrow` in `powerline.tsx` and two spots in `promptPrefix.tsx`. The thin glyph is the solid glyph's codepoint + 1. |
| Duplicates hidden while the sidebar is open | `PL_SIDEBAR_DUPES` in `powerline.tsx`. |
| Code panel colours | `PL_CV_DARK` / `PL_CV_LIGHT` in `src/codeview.tsx`. |
| Add a highlighted language | `PL_LANGS` (definition), `PL_ALIAS` (other names), `PL_CV_ICON` (icon) in `codeview.tsx`. C-family languages use `PL_C_LIKE`; line-shaped ones (yaml/ini/docker/make) use `family`. |
| Markdown styling | `__plMd()` and the `__plHeading` / `__plRule` / `__plBullet…` / `__plInlineCode` helpers in `codeview.tsx`. |
| Result cards | `__plNoticeCardImpl()` in `codeview.tsx`; the notice format comes from Hermes' `tools/process_registry_notifications.py`. |
| Icons | Look the codepoint up in the font: fontTools on `JetBrainsMonoNerdFontMono-Regular.ttf` → `getBestCmap()`, search for `md-…` names. Only use looked-up codepoints. |
| A new sidebar section | `Sidebar()` in `widgets/hy-sidebar.mjs`: `section(key, h(Head, …), rows)`. Data: `b.ui.get()` (info, usage, sid), `b.turn.get()` (tools, subagents, todos), state.db through `readSession()` (skills, delegations, subagent sessions, MCP calls, files). |
| More data for the widgets | a getter in `src/bridge.ts`, or a new optional entry in the `INSERTS` table of `bin/hermes-powerline`. |
| A new injection point | `SPECS` / `INSERTS` in `bin/hermes-powerline`. The anchor must occur **exactly once**; mark it optional unless the bar cannot work without it. |

The installed widgets are symlinks to the repo, so editing them does **not** trigger Hermes' directory watcher — run `/widgets-reload` (or restart). For `src/*`, run `hermes-powerline rebuild` (or just relaunch; the stamp changes).

Data notes the widgets rely on:
- MCP tools are named `mcp__<server>__<tool>` and usually run through the deferred `tool_call` wrapper (`{name, arguments}` or `{calls: [...]}`).
- Subagent sessions have `parent_session_id` = the parent's stored session id and the title `Subagent: <goal>`; their route comes from the `profile` field of the matching `delegate_task` task.
- Hermes archives the todo list into the transcript when a turn ends; the sidebar keeps the last one per session.

---

## 7. Test before pushing

1. `hermes-powerline doctor` → `typecheck: 0 error(s) … build: ok`.
2. `node --check widgets/*.mjs`, `bash -n bin/hermes-powerline install.sh uninstall.sh`, `zsh -n shell/hermes-powerline.zsh`.
3. Simulate a Hermes update: copy `~/.hermes/hermes-agent/ui-tui` to a scratch dir (symlink `node_modules` and `apps/shared`, copy `scripts/build` and `package*.json`), change an anchor there, run `HERMES_AGENT_DIR=<copy> hermes-powerline doctor`.
4. Look at it for real: run the TUI in tmux (`env -u TMUX COLORTERM=truecolor tmux new-session -d -s <name> -x 200 -y 60 'hermes-powerline run'`), drive it with `tmux send-keys`, capture with `tmux capture-pane -p -e`, render the ANSI to PNG (Pillow + JetBrainsMono Nerd Font). **Quit with `/quit`** — killing a TUI leaves an orphaned live session in the gateway until it restarts — and kill only your named tmux session (never `tmux kill-server`).
5. Mouse: tmux cannot click, but SGR mouse sequences can be sent as literal keys: press `ESC [ < 0 ; x ; y M`, release `ESC [ < 0 ; x ; y m` (1-based column/row).
6. Idle CPU: `ps -o cputime= -p <node pid>` before/after 30 s (measured: ~0.29 s per 30 s with widgets, ~0.26 s without).
7. Install/uninstall in a fake home: `HERMES_HOME=/tmp/x ZDOTDIR=/tmp/x HERMES_POWERLINE_BIN=/tmp/x/bin ./install.sh --shell`, then `./uninstall.sh`.

---

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Stock bar plus "using the stock Hermes TUI" | Hermes changed something we rely on. `hermes-powerline doctor` names it; fix the anchor in `bin/hermes-powerline`, then `hermes-powerline rebuild`. |
| Stock markdown/code but the bar is fine | An optional piece was skipped after an update; `doctor` prints `skipped (optional): …`. |
| No sidebar | Terminal narrower than 112 columns (auto-hidden), toggled off with `/hy-sidebar`, `HY_SIDEBAR=0`, or launched with `command hermes`. |
| No tabs | The `liveSessions.ts` insert was skipped, or `HY_TABS=0`. |
| Ghost tabs | Orphaned sessions from killed TUIs. Close with the tab's `×` / `^X` → `Ctrl+D` (only works for sessions this window owns), or `hermes gateway stop` (closes **every** session). |
| Widget edits not visible | Symlinked files don't trigger the watcher — `/widgets-reload`. |
| Icons as boxes | The terminal / browser is not using a Nerd Font. |
| Washed-out colours in tmux | Expected 256-colour fallback; when adding colours, check how chalk rounds them (`round(v / 51)` per channel). |

---

## 9. Where things live after install

```
~/repos/hermes-powerline/                 ← repo (source of truth)
~/.local/bin/hermes-powerline             → repo/bin/hermes-powerline
~/.hermes/powerline/                      ← linked sources + config.json + build (tui/) + .stage/
~/.hermes/plugins/powerline-net           → repo/plugin/powerline-net
~/.hermes/plugins/plan-auto               → repo/plugin/plan-auto   (opt-in; trace in ~/.cache/plan-auto/)
~/.hermes/tui-widgets/hy-*.mjs            → repo/widgets/   (and ~/.hermes/profiles/*/tui-widgets/)
~/.hermes/skins/hy-*.yaml                 → repo/skins/     (and every profile)
~/.hermes/dashboard-themes/hy-*.yaml      → repo/dashboard-themes/
~/.zshrc                                  ← one line sourcing repo/shell/hermes-powerline.zsh
~/.hermes/config.yaml                     ← display.skin: hy-dracula, dashboard.theme: hy-dracula,
                                            display.sections.thinking: expanded (reasoning stays open)
```

---

## 10. Design references

- Sidebars: OpenCode (42 columns; Context → MCP → Todo; cwd:branch pinned at the bottom) and Crush (`TITLE ─────` headers, status dot + word, "…and N more") — github.com/anomalyco/opencode, github.com/charmbracelet/crush.
- Dracula: draculatheme.com/spec (palette, syntax); markdown colours from the Dracula VS Code theme; 256-colour codes from `dracula/vim`; diff tints from OpenCode's Dracula theme.
- Contrast (WCAG 2.1): `#6272A4` on `#282A36` is only 3:1 → rules, hints and code comments only; muted labels use `#9AA5CE` (5.9:1). State is always a glyph or word as well as a colour.
- Status bar vs sidebar: details live in the sidebar; the bar keeps only what the sidebar does not show.

### Design acceptance — contrast audit (WCAG 2.1)

Every colour pair the UI draws, measured on the truecolor palette (256-colour fallbacks checked for the idle pair too). Text needs ≥ 4.5:1; hints, rules and de-emphasised idle states ≥ 3:1.

| Pair | Ratio | |
| --- | --- | --- |
| body text `#F8F8F2` on canvas `#282A36` | 13.36 | ✓ |
| muted labels `#9AA5CE` on canvas | 5.86 | ✓ |
| green headers `#50FA7B` / cyan / orange / pink / red on canvas | 10.38 / 10.29 / 8.36 / 5.97 / 4.53 | ✓ |
| hints `#6272A4` on canvas | 3.03 | ✓ (hints only) |
| idle chips & tiles `#8A95C0` on surface `#343746` (256: `#8787AF` on `#3A3A3A`) | 4.01 (3.31) | ✓ — was 2.51 with `#6272A4`, fixed |
| used chips / inline code: green on `#44475A` | 6.67 | ✓ |
| current tab: `#191A21` on green; active chips on orange / yellow | 12.63 / 10.18 / 15.52 | ✓ |
| code text / comments / line numbers on panel `#21222C` | 14.81 / 3.36 / 3.36 | ✓ |
| diff rows: text on `#1A3A1A` / `#3A1A1A` | 11.84 / 14.67 | ✓ |

State is never colour alone: every status also has a glyph or word (✓ × · ⠋ ▶ ○, `online` / `calling` / `off` / `error`).
