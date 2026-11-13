"""plan-auto: file edits in an interactive session wait for an approved plan.

The plan-mode plugin has no "default on" setting: it turns on only via /plan, /planmode on or the
agent calling plan_mode(on) itself, and models skip that. plan-auto turns it on for the agent —
lazily, at the moment the agent first tries to change something:

* ``pre_tool_call``: the first ``write_file`` / ``patch``, or a ``delegate_task`` to the ``coder``
  route, in a session with no plan running is blocked, and plan mode is turned on through
  plan-mode's own ``_run_command`` (the same path its ``plan_mode`` tool uses). The block message
  carries plan-mode's planning note, so the agent plans in the same turn and submits it for the
  approval card. After approval plan-mode's executing phase lets the edits through.
* ``pre_llm_call`` only remembers, per session, whether the user's message opted out
  ("làm luôn", "không cần plan", "skip plan", "no plan") and what the request was (the plan's task).

Why lazy: turning plan mode on at the start of every turn cost one extra model round-trip
(``plan_mode off``) on every question or command — 7-10 s of dead air before the answer. Now a
request that changes nothing never touches plan mode.

Gated: ``write_file``, ``patch``, and ``delegate_task`` to the code route — including tasks with no
``profile``, which ``delegation.backends.profile_routes.default`` (coder) receives. Not gated (cannot
be told apart from reads): ``terminal`` and ``execute_code``; SOUL routes code to the coder anyway.

Skipped: plan mode already on or executing an approved plan; a turn that already went through a
plan (a small follow-up edit after the last todo does not re-arm it); delegated children (the coder
doing approved work); cron; one-shot runs (-z, -q/--query/--query-file, -Q); non-terminal surfaces
(messaging platforms, desktop); opted-out turns. ``HERMES_PLAN_AUTO=0`` disables it.
Never raises: any failure leaves the tool call alone.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from collections import OrderedDict
from typing import Any

_SURFACES = {"", "cli", "terminal", "tui", "local"}  # TUI turns derive surface "local"
_SKIP_PLATFORMS = {"subagent", "curator", "cron"}
_OPT_OUT = re.compile(
    r"l[àa]m\s+lu[ôo]n|kh[ôo]ng\s+c[ầa]n\s+plan|b[ỏo]\s+qua\s+plan|skip\s+(the\s+)?plan|no\s+plan|"
    r"kh[ôo]ng\s+c[ầa]n\s+l[ậa]p\s+k[ếe]\s+ho[ạa]ch",
    re.IGNORECASE,
)
# Turns Hermes injects on its own (delegation results, background notices, /plan's wrapper) keep
# the user's request; everything else the user typed — even "/Users/…" or "[WIP] …" — is a new one.
_INJECTED = re.compile(r"^\s*\[(?:ASYNC |BACKGROUND |SYSTEM|/plan\b)")
_IMPLEMENT_PREFIX = "Implement the approved plan at "
_EDIT_TOOLS = {"write_file", "patch"}
_CODE_ROUTE = "coder"
_ONESHOT_FLAGS = {"-z", "--oneshot", "-q", "--query", "--query-file", "-Q", "--quiet-query"}
_route_cache: dict[str, Any] = {"mtime": None, "default": _CODE_ROUTE}

_TRACE = os.path.expanduser("~/.cache/plan-auto/trace.log")
_turns: "OrderedDict[str, dict[str, Any]]" = OrderedDict()  # identity key → {"optout", "task"}
_lock = threading.Lock()


def _trace(line: str) -> None:
    """One line per decision; HERMES_PLAN_AUTO_TRACE=0 turns it off."""
    if os.environ.get("HERMES_PLAN_AUTO_TRACE", "1") == "0":
        return
    try:
        os.makedirs(os.path.dirname(_TRACE), exist_ok=True)
        if os.path.exists(_TRACE) and os.path.getsize(_TRACE) > 512_000:
            os.replace(_TRACE, _TRACE + ".1")
        with open(_TRACE, "a", encoding="utf-8") as fh:
            fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} pid={os.getpid()} {line}\n")
    except Exception:
        pass


def _disabled() -> bool:
    return os.environ.get("HERMES_PLAN_AUTO", "1").strip().lower() in {"0", "false", "off", "no"}


def _plan_mode() -> tuple[Any, Any] | tuple[None, None]:
    """plan-mode's PlanModePlugin instance whose hooks are registered right now, and its module.

    Looked up on every call from the live hook registry (cheap), so a plugin reload — which builds a
    new instance — never leaves us driving a stale one."""
    try:
        from hermes_cli.plugins import get_plugin_manager
        hooks = getattr(get_plugin_manager(), "_hooks", {}) or {}
    except Exception:
        return None, None
    for cb in reversed(list(hooks.get("pre_tool_call", []))):
        owner = getattr(cb, "__self__", None)
        if type(owner).__name__ == "PlanModePlugin":
            mod = sys.modules.get(type(owner).__module__)
            if mod is not None and hasattr(mod, "derive_session_identity"):
                return owner, mod
    return None, None


def _user_text(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, list):  # multimodal content parts
        return " ".join(str(p.get("text", "")) for p in message if isinstance(p, dict))
    return ""


def _oneshot() -> bool:
    """A run that answers and exits — nobody is there to approve a plan."""
    return any(a in _ONESHOT_FLAGS or a.split("=", 1)[0] in _ONESHOT_FLAGS for a in sys.argv[1:])


def _default_route() -> str:
    """Where a delegate_task without ``profile`` goes: delegation.backends.profile_routes.default."""
    try:
        home = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
        path = os.path.join(home, "config.yaml")
        mtime = os.path.getmtime(path)
        if _route_cache["mtime"] != mtime:
            import yaml  # Hermes depends on PyYAML

            with open(path, encoding="utf-8") as fh:
                cfg = yaml.safe_load(fh) or {}
            d = (cfg.get("delegation") or {})
            route = (((d.get("backends") or {}).get("profile_routes") or {}).get("default")
                     if d.get("backend") == "profile_routes" else None)
            _route_cache.update(mtime=mtime, default=str(route or "").strip())
        return str(_route_cache["default"] or "")
    except Exception:
        return _CODE_ROUTE


def _identity(mod: Any, platform: str) -> Any:
    """The session identity plan-mode itself would use, or None outside an interactive terminal."""
    identity = mod.derive_session_identity(platform)
    if identity.unsupported or identity.non_cli_without_key or not identity.key:
        return None
    if (identity.surface or "").strip().lower() not in _SURFACES:
        return None
    return identity


def _wants_edit(tool_name: str, args: Any) -> bool:
    """Does this call change files: an edit tool, or code work handed to the coder route?"""
    a = args if isinstance(args, dict) else {}
    if tool_name in _EDIT_TOOLS:
        return True
    if tool_name == "delegate_task":
        tasks = a.get("tasks")
        if isinstance(tasks, str):  # Hermes accepts a JSON-array string too
            try:
                tasks = json.loads(tasks)
            except ValueError:
                tasks = None
        # A legacy top-level `goal` is wrapped into one task WITHOUT any profile (a top-level `profile`
        # is ignored by Hermes), so it runs on the default route.
        if not isinstance(tasks, list):
            tasks = [{"goal": a.get("goal")}]

        def route(t: Any) -> str:
            own = str(t.get("profile") or "").strip() if isinstance(t, dict) else ""
            return own or _default_route()

        return any(route(t) == _CODE_ROUTE for t in tasks)
    if tool_name == "tool_call":  # Tool Search's dispatcher: judge the inner calls
        calls = a.get("calls") if isinstance(a.get("calls"), list) else []
        return any(
            isinstance(c, dict) and _wants_edit(str(c.get("name") or ""), c.get("arguments") or {}) for c in calls
        )
    return False


def pre_llm_call(**kwargs: Any) -> None:
    """Remember the request and its opt-out for this session's tool calls. Returns nothing."""
    try:
        if _disabled():
            return None
        platform = str(kwargs.get("platform") or "").strip().lower()
        if platform in _SKIP_PLATFORMS or kwargs.get("parent_session_id"):
            return None
        text = _user_text(kwargs.get("user_message")).strip()
        # Injected turns (delegation results, plan-mode's implement turn) keep the user's request.
        if text.startswith(_IMPLEMENT_PREFIX) or _INJECTED.match(text):
            return None
        _inst, mod = _plan_mode()
        if mod is None:
            return None
        identity = _identity(mod, platform)
        if identity is None:
            return None
        with _lock:
            _turns.pop(identity.key, None)
            _turns[identity.key] = {"optout": bool(_OPT_OUT.search(text)), "planned": False, "task": text[:500]}
            while len(_turns) > 256:
                _turns.popitem(last=False)
    except Exception as exc:
        _trace(f"error in pre_llm_call: {exc!r}")
    return None


def pre_tool_call(tool_name: str = "", args: Any = None, **kwargs: Any) -> dict[str, str] | None:
    try:
        if _disabled() or not _wants_edit(tool_name, args):
            return None
        if _oneshot():
            return None
        inst, mod = _plan_mode()
        if inst is None:
            return None
        if getattr(mod, "_delegated_child", lambda: False)() or mod._cron_session_is_active():
            return None
        # pre_tool_call gets no platform kwarg; plan-mode resolves the session from Hermes' context.
        identity = _identity(mod, "")
        if identity is None:
            return None
        with inst._lock:
            _key, state = inst._state_for_hook(identity)
        planning = state.get("active") or state.get("phase") == "executing"
        with _lock:
            entry = _turns.get(identity.key)
            # Only an APPROVED plan (executing) counts — the agent switching plan mode off itself
            # must not open the gate.
            if state.get("phase") == "executing" and entry is not None:
                entry["planned"] = True
            turn = dict(entry or {})
        if planning:
            return None  # plan-mode's own guard (planning) or its approved run (executing) is in charge
        if turn.get("optout"):
            _trace(f"skip: {tool_name} — user opted out of planning")
            return None
        if turn.get("planned"):
            _trace(f"skip: {tool_name} — this request's plan was approved earlier in the turn")
            return None

        result = inst._run_command("on", str(turn.get("task") or ""), entered_by="agent")
        message = result.get("message", "") if isinstance(result, dict) else str(result or "")
        if not message.startswith("Plan mode is on"):
            _trace(f"skip: plan-mode refused activation: {message[:200]!r}")
            return None
        _trace(f"on: {tool_name} blocked, plan mode turned on")
        return {
            "action": "block",
            "message": (
                f"[plan-auto] `{tool_name}` was blocked: this request changes files, and the user's rule is "
                "that every change gets a plan they approve first. Plan mode is now ON. Do not turn it off. "
                "Write the plan for the user's request, show it, call plan_mode action \"submit\" and wait "
                "for approval; after approval, carry out the plan (code goes to the coder route).\n" + message
            ),
        }
    except Exception as exc:  # never break a tool call
        _trace(f"error in pre_tool_call: {exc!r}")
        return None


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", pre_llm_call)
    ctx.register_hook("pre_tool_call", pre_tool_call)
