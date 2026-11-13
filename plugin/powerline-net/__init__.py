"""powerline-net: per-request speed + API errors for the hermes-powerline status bar.

Why. Hermes' own ``avg_tps`` is sum(output) / sum(latency) over the last 10 calls, and each
latency includes the wait for the first token (prefill of a long context, queueing at the
provider). That is a blended throughput, not the speed the model is generating at, and it
mixes ten different requests together. The TUI also gets no structured event when an API call
fails (HTTP 4xx/5xx, timeout) — only free-form status text.

What. Two observer hooks, both fired by Hermes itself with exact timings:

* ``post_api_request`` — one successful call: ``started_at``, ``first_chunk_at`` (first streamed
  chunk), ``ended_at`` and the provider's ``usage``. Speed = output tokens of THIS call /
  (ended_at - first_chunk_at); TTFT = first_chunk_at - started_at. Nothing averaged.
* ``api_request_error`` — one failed attempt: HTTP status, Hermes' classified reason, retry n/max.

Each update is written atomically to ``~/.cache/hermes-powerline/net/<id>.json``, keyed by the
TUI's wire session id (looked up in ``tui_gateway.server._sessions``) and by the agent's
session id. Only calls made by the agent that owns a TUI session are attributed to it, so a
subagent's (delegate's) calls never mix into the parent's bar.

Observer only: never raises, never returns a value, adds no work to the token path.
"""
from __future__ import annotations

import json
import logging
import os
import pathlib
import sys
import tempfile
import threading
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

VERSION = 1
DIR = pathlib.Path(os.environ.get("HERMES_POWERLINE_NET_DIR") or (pathlib.Path.home() / ".cache" / "hermes-powerline" / "net"))

# Below these a rate is noise: a 12-token tool call that arrives in one burst would read as
# 3000 t/s. Such calls still update TTFT and the call counter, but keep the previous speed.
MIN_GEN_S = 0.4
MIN_OUT_TOKENS = 24
# An error older than this is history: a success after it is not a "recovery" (matches the TUI's
# stale window), so it is dropped instead of flashing a "recovered" badge.
RECOVER_WINDOW_S = 15 * 60
# In-memory states kept per gateway process; older ones are dropped (their files stay on disk).
MAX_STATES = 64

_lock = threading.Lock()  # guards _state only — never held across file I/O
_state: Dict[str, Dict[str, Any]] = {}  # session_id -> state
_write_locks: Dict[str, threading.Lock] = {}  # session_id -> serialises that session's writes


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _tui_sids(session_id: str) -> list[str]:
    """TUI wire session ids whose OWN agent is ``session_id`` (never a delegate's)."""
    srv = sys.modules.get("tui_gateway.server")
    sessions = getattr(srv, "_sessions", None) if srv else None
    if not isinstance(sessions, dict) or not session_id:
        return []
    try:
        items = list(sessions.items())
    except RuntimeError:  # resized while copying; next call will catch up
        return []
    out = []
    for sid, sess in items:
        if not isinstance(sess, dict):
            continue
        agent = sess.get("agent")
        if getattr(agent, "session_id", None) == session_id or sess.get("session_key") == session_id:
            out.append(str(sid))
    return out


def _write(session_id: str, seq: int, st: Dict[str, Any]) -> None:
    """Write a snapshot of one session's state; a slower writer never overwrites a newer snapshot."""
    with _lock:
        wl = _write_locks.setdefault(session_id, threading.Lock())
    with wl:
        if seq < int(_written.get(session_id, -1)):
            return
        _written[session_id] = seq
        _write_files(session_id, st)


_written: Dict[str, int] = {}


def _write_files(session_id: str, st: Dict[str, Any]) -> None:
    sids = _tui_sids(session_id)
    st["sid"] = sids[0] if sids else None
    data = json.dumps(st, ensure_ascii=False, separators=(",", ":"))
    DIR.mkdir(parents=True, exist_ok=True)
    _maybe_sweep()
    for key in dict.fromkeys([*sids, session_id]):
        safe = "".join(c for c in key if c.isalnum() or c in "-_.")[:120]
        if not safe:
            continue
        fd, tmp = tempfile.mkstemp(dir=DIR, prefix=".tmp-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(data)
            os.replace(tmp, DIR / f"{safe}.json")
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def _get(session_id: str) -> Dict[str, Any]:
    """Caller holds _lock."""
    st = _state.get(session_id)
    if st is None:
        if len(_state) >= MAX_STATES:  # drop the least recently touched sessions
            for sid, _ in sorted(_state.items(), key=lambda kv: kv[1].get("_t", 0))[: len(_state) - MAX_STATES + 1]:
                _state.pop(sid, None)
                _write_locks.pop(sid, None)
                _written.pop(sid, None)
        st = _state[session_id] = {"v": VERSION, "session_id": session_id, "calls": 0, "errors": 0,
                                   "last": None, "err": None, "recovered": None, "_seq": 0}
    st["_t"] = time.time()
    st["_seq"] = int(st.get("_seq") or 0) + 1
    return st


def _snapshot(st: Dict[str, Any]) -> tuple[int, Dict[str, Any]]:
    """Caller holds _lock. Copy without the private bookkeeping keys."""
    return int(st["_seq"]), {k: (dict(v) if isinstance(v, dict) else v) for k, v in st.items() if not k.startswith("_")}


def on_post_api_request(**kw: Any) -> None:
    try:
        session_id = str(kw.get("session_id") or "")
        if not session_id:
            return
        usage = kw.get("usage") if isinstance(kw.get("usage"), dict) else {}
        out = int(usage.get("output_tokens") or 0)
        reasoning = int(usage.get("reasoning_tokens") or 0)
        started = _num(kw.get("started_at"))
        ended = _num(kw.get("ended_at"))
        first = _num(kw.get("first_chunk_at"))
        dur = _num(kw.get("api_duration"))
        now = time.time()

        ttft = first - started if first is not None and started is not None and first >= started else None
        gen = ended - first if first is not None and ended is not None and ended > first else None
        streamed = gen is not None
        if gen is None and dur:
            gen = dur  # not streamed: only end-to-end time exists

        with _lock:
            st = _get(session_id)
            prev = st.get("last") or {}
            tps = out / gen if gen and gen >= MIN_GEN_S and out >= MIN_OUT_TOKENS else None
            st["last"] = {
                "at": now,
                "dur": round(dur, 3) if dur is not None else None,
                "gen": round(gen, 3) if gen is not None else None,
                "out": out,
                "reasoning": reasoning,
                "streamed": streamed,
                "ttft": round(ttft, 3) if ttft is not None else None,
                # Speed of THIS call. A call too short to measure keeps the previous speed,
                # marked stale, rather than inventing a number.
                "tps": round(tps, 2) if tps is not None else prev.get("tps"),
                "tps_at": now if tps is not None else prev.get("tps_at"),
                # Whether the shown speed came from a streamed call (generation only) or is end-to-end.
                "tps_streamed": streamed if tps is not None else prev.get("tps_streamed"),
                "model": kw.get("response_model") or kw.get("model"),
            }
            st["calls"] = int(st.get("calls") or 0) + 1
            err = st.get("err")
            if err:
                # Only a recent failure was "recovered" by this call; an old one is just over.
                st["recovered"] = {**err, "ok_at": now} if now - float(err.get("at") or 0) < RECOVER_WINDOW_S else None
                st["err"] = None
            seq, snap = _snapshot(st)
        _write(session_id, seq, snap)
    except Exception:
        logger.debug("powerline-net: post_api_request failed", exc_info=True)


def on_api_request_error(**kw: Any) -> None:
    try:
        session_id = str(kw.get("session_id") or "")
        if not session_id:
            return
        err = kw.get("error") if isinstance(kw.get("error"), dict) else {}
        code = kw.get("status_code")
        try:
            code = int(code) if code is not None else None
        except (TypeError, ValueError):
            code = None
        now = time.time()
        with _lock:
            st = _get(session_id)
            prev_err = st.get("err") or {}
            fresh = now - float(prev_err.get("at") or 0) < RECOVER_WINDOW_S
            streak = (int(prev_err.get("n") or 0) if fresh else 0) + 1
            st["err"] = {
                "at": now,
                "code": code,
                "max": kw.get("max_retries"),
                "msg": str(err.get("message") or "")[:300],
                "n": streak,
                "reason": kw.get("reason") or None,
                "retry": kw.get("retry_count"),
                "retryable": kw.get("retryable"),
                "type": err.get("type") or None,
                "after_s": round(float(kw.get("api_duration") or 0), 2),
            }
            st["errors"] = int(st.get("errors") or 0) + 1
            seq, snap = _snapshot(st)
        _write(session_id, seq, snap)
    except Exception:
        logger.debug("powerline-net: api_request_error failed", exc_info=True)


_last_sweep = 0.0


def _maybe_sweep() -> None:
    """A gateway runs for days and loads the plugin once: sweep again at most once an hour."""
    global _last_sweep
    now = time.time()
    if now - _last_sweep > 3600:
        _last_sweep = now
        _sweep()


def _sweep() -> None:
    """Drop files from sessions idle for more than two days."""
    try:
        cutoff = time.time() - 2 * 86400
        for p in DIR.glob("*.json"):
            if p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
        for p in DIR.glob(".tmp-*"):
            if p.stat().st_mtime < time.time() - 600:
                p.unlink(missing_ok=True)
    except Exception:
        pass


def register(ctx) -> None:
    global _last_sweep
    _last_sweep = time.time()
    _sweep()
    ctx.register_hook("post_api_request", on_post_api_request)
    ctx.register_hook("api_request_error", on_api_request_error)
