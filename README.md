# hermes-powerline

A powerline-style status bar and prompt for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) TUI that survives `hermes update`.

```
 ! YOLO >> ready >> model >> 42k/200k ████░░░░ 21% >> 52 t/s >> cache 87% >> 3.2s        << ~/proj << main << 12m 04s
 user >> host >> hermes                                    << cpu 7% << gpu 8% << 14.6/32G << 176/245G << 36°C
 ❯ Ask me anything…
```

- Grey ramp, dark → light, white text, a green `>` band between segments (all configurable).
- Row 1: status, model, context meter, tokens/s, cache hit, latency · folder, git branch, session clock.
- Row 2: user / host / agent · CPU, GPU, RAM, disk, temperature.
- Narrow terminals shed segments whole instead of clipping them.

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

`install.sh` symlinks this checkout into `~/.hermes/powerline` and `~/.local/bin`, so updating is `git pull`. Remove with `./uninstall.sh`.

## How it works, and why updates don't break it

Hermes has no plugin API for the status bar, but it does support running a prebuilt TUI from `$HERMES_TUI_DIR`. `hermes-powerline`:

1. copies the Hermes TUI source to a staging dir **outside** the Hermes checkout (Hermes' own files are never modified, so `hermes update` never conflicts);
2. appends three source files to it and renames the stock components they replace;
3. builds that into `~/.hermes/powerline/tui` and launches Hermes pointing at it.

The build is stamped with the Hermes commit and source state. After `hermes update` the next launch rebuilds by itself (a few seconds). Four layers keep a Hermes update from leaving you with a broken TUI:

| Layer | Catches | Result |
| --- | --- | --- |
| Anchor check at inject time | upstream renamed or removed a component or helper we use | stock TUI, with a message naming what changed |
| Typecheck of our code | a helper still exists but changed shape | stock TUI |
| Build failure | anything else at build time | stock TUI; not retried until something changes |
| React error boundary | a runtime error while rendering | that piece falls back to the stock component |

`hermes-powerline doctor` runs the first three in a throwaway directory and reports. The `compat` workflow in this repo runs it daily against Hermes `main`.

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

## Known limits

- The YOLO segment reflects the mode Hermes was started in; toggling it mid-session doesn't update it.
- Hermes forces 256 colours inside tmux. The default palette uses exact xterm-256 colours, so it looks the same there.
- Tested on macOS. The launcher avoids macOS-only tools, but Linux has only been exercised by CI's build check.

## License

MIT
