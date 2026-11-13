#!/usr/bin/env python3
"""hy-sidebar's claude-sub block, rendered for real (Ink + React from the Hermes install) over fake job dirs.

Run: python3 -I tests/test_sidebar_claude.py        (expect: ALL PASS)
Skips (exit 0) when Hermes' node_modules (ink, react) are not there.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "sidebar_claude_harness.mjs"
AGENT = Path(os.environ.get("HERMES_AGENT_DIR") or Path.home() / ".hermes" / "hermes-agent")
fails = 0


def check(name: str, ok: bool, frame: str = "") -> None:
    global fails
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails += 1
        print(frame)


def render(rows: int, scenario: str) -> str:
    with tempfile.TemporaryDirectory(prefix="hy-claude-") as tmp:
        env = dict(os.environ, CLAUDE_SUB_HOME=f"{tmp}/state", HERMES_HOME=f"{tmp}/hh", HERMES_AGENT_DIR=str(AGENT))
        out = subprocess.run(["node", str(HARNESS), str(rows), scenario], capture_output=True, text=True, env=env, timeout=60)
        return out.stdout + out.stderr


def raw_footer(frame: str) -> list[str]:
    lines = [l[1:] for l in frame.splitlines() if l.startswith("|")]
    start = next((i for i, l in enumerate(lines) if "\U000f0770" in l), len(lines))
    return lines[start:]


def footer(frame: str) -> list[str]:
    """The footer with its decoration read as spaces: pill caps ( ) and the row edge ▌ — so the
    text checks below read the same words in the same columns."""
    return [l.replace("\ue0b6", " ").replace("\ue0b4", " ").replace("\u258c", " ") for l in raw_footer(frame)]


def main() -> int:
    if not (AGENT / "node_modules" / "ink").is_dir() or not (AGENT / "node_modules" / "react").is_dir():
        print("SKIP: no Hermes node_modules (ink, react) at", AGENT)
        return 0

    f = render(50, "live")
    foot = footer(f)
    check("block sits right under the 󰝰 cwd line", len(foot) > 1 and "claude" in foot[1], f)
    check("live: header lit with a spinner, the model·effort and the run time", any("claude  opus-5-5·high · 1m13" in l for l in foot), f)
    check("live: an activity row says what Claude does now (tool, file, turn)",
          any(l.lstrip().startswith("› Edit parser/tokenizer.py") and l.rstrip().endswith("turn 3") for l in foot), f)
    check("live: Claude's last words, quoted", any("“The tokenizer drops trailing comm" in l for l in foot), f)
    check("the other provider's line sits under the claude block, model from the config",
          foot[-2].strip() == "◇ coarena  kimi-k3-1-pro · researcher", f)
    check("live: the running job's row carries resume ↻ and its denial ✗1", any("refactor parser" in l and "↻ ✗1" in l for l in foot), f)
    check("history: done row shows run time and age", any("✓ fib.py + unittest" in l and "14s · " in l for l in foot), f)
    check("history: a dead runner reads lost, not running", any(l.lstrip().startswith("? runner killed") and "lost" in l for l in foot), f)
    check("history: error row shows ✗ denials and the word error", any("× write /etc file" in l and "✗1 · error" in l for l in foot), f)
    check("denial line names the rule and path", any(l.strip().startswith("✗ write@system for /etc/x") for l in foot), f)
    check("jobs older than a day are left out", "very old job" not in f, f)
    check("header counts the day's denials", any("claude" in l and l.rstrip().endswith("✗2") for l in foot[:3]), f)
    check("no line is wider than the rail (40 cells)", all(len(l) <= 40 for l in foot), f)
    raw = raw_footer(f)
    check("style: the claude chip is a rounded pill", any(l.startswith("\ue0b6") and "claude\ue0b4" in l for l in raw), f)
    check("style: live, history and denial rows carry the coloured edge ▌",
          all(any(l.startswith("\u258c") and key in l for l in raw) for key in ("refactor parser", "Edit parser", "fib.py", "write@system")), f)

    f = render(20, "live")
    foot = footer(f)
    check("short rail: history goes first, live task and denial stay (denial outlasts the activity row)",
          any("refactor parser" in l for l in foot) and any("write@system" in l for l in foot) and not any("fib.py" in l for l in foot), f)

    f = render(14, "live")
    foot = footer(f)
    check("tiny rail: only the header line is left, footer still shown",
          len(foot) == 3 and "claude" in foot[1] and "/hy-sidebar" in foot[2], f)

    f = render(40, "idle")
    foot = footer(f)
    check("idle: dim chip, the model last used, today's count", any("✻ claude  opus-5-5·high · 4 today" in l for l in foot), f)

    f = render(40, "empty")
    foot = footer(f)
    check("never used: just ✻ claude idle, then the idle provider line",
          len(foot) == 4 and foot[1].strip() == "✻ claude  idle" and foot[2].strip().startswith("◇ coarena"), f)

    f = render(40, "busy")
    foot = footer(f)
    check("busy: the researcher route at work lights coarena with its model and routes",
          any("coarena  kimi-k3-1-pro · researcher" in l and not l.lstrip().startswith("◇") for l in foot), f)
    check("busy: the goal the coarena route works on, under it", foot[-2].strip() == "› compare three MCP SDKs", f)
    check("busy: no line is wider than the rail (40 cells)", all(len(l) <= 40 for l in foot), f)

    f = render(40, "finish")
    foot = footer(f)
    check("finish: the chip flashes done", any("✓ claude  opus-5-5·high · done" in l for l in foot), f)
    check("finish: the job moves to history as 'now'", any("refactor parser" in l and l.rstrip().endswith("now") for l in foot), f)

    print("ALL PASS" if not fails else f"{fails} FAILED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
