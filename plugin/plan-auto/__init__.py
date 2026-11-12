"""plan-auto: plan mode ON by default for every interactive user turn.

The plan-mode plugin has no "default on" setting: it turns on only via /plan, /planmode on or the
agent calling plan_mode(on) itself, and models skip that. This companion hook does the agent's
call for it at the start of each fresh user turn, through plan-mode's own ``_run_command`` (the
same path its tool uses), so all of plan-mode's guards, state and notes stay in charge.

* Activation is agent-owned (``entered_by="agent"``): for a request that changes nothing — a
  question, inspection, research, security ops — the agent may call ``plan_mode`` action ``off``
  and carry on. Once the user answers a plan card it becomes user-owned, as plan-mode decides.
* The ``on`` result (planning note + agent note, exactly what the agent would get from calling
  ``plan_mode on``) is returned as this turn's context, so hook order does not matter.
* Skipped: plan mode already on or executing an approved plan; subagents/curator; cron; one-shot
  (-z); non-terminal surfaces (messaging platforms); slash commands; injected messages
  ("[ASYNC ...]", plan-mode's own implement turn); and opt-outs ("làm luôn", "không cần plan",
  "skip plan", "no plan"). ``HERMES_PLAN_AUTO=0`` disables it.

Never raises: any failure returns None and leaves the turn untouched.
"""
from __future__ import annotations

import logging
import os
import re
import sys
from typing import Any

log = logging.getLogger("plan-auto")

_SURFACES = {"", "cli", "terminal", "tui", "local"}  # TUI turns derive surface "local"
_SKIP_PLATFORMS = {"subagent", "curator", "cron"}
_OPT_OUT = re.compile(
    r"l[àa]m\s+lu[ôo]n|kh[ôo]ng\s+c[ầa]n\s+plan|b[ỏo]\s+qua\s+plan|skip\s+(the\s+)?plan|no\s+plan|"
    r"kh[ôo]ng\s+c[ầa]n\s+l[ậa]p\s+k[ếe]\s+ho[ạa]ch",
    re.IGNORECASE,
)
_INJECTED = re.compile(r"^\s*\[[A-Z/][^\]\n]{0,120}\]")
_IMPLEMENT_PREFIX = "Implement the approved plan at "



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
    argv = sys.argv[1:]
    return any(a in ("-z", "--oneshot") or a.startswith("--oneshot=") for a in argv)


_TRACE = os.path.expanduser("~/.cache/plan-auto/trace.log")


def _trace(line: str) -> None:
    """One line per decision; HERMES_PLAN_AUTO_TRACE=0 turns it off."""
    if os.environ.get("HERMES_PLAN_AUTO_TRACE", "1") == "0":
        return
    try:
        import time
        os.makedirs(os.path.dirname(_TRACE), exist_ok=True)
        if os.path.exists(_TRACE) and os.path.getsize(_TRACE) > 512_000:
            os.replace(_TRACE, _TRACE + ".1")
        with open(_TRACE, "a", encoding="utf-8") as fh:
            fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} pid={os.getpid()} {line}\n")
    except Exception:
        pass


def _skip(reason: str) -> None:
    _trace(f"skip: {reason}")
    return None


def pre_llm_call(**kwargs: Any) -> dict[str, str] | None:
    try:
        _trace(f"hook: platform={kwargs.get('platform')!r}")
        if os.environ.get("HERMES_PLAN_AUTO", "1").strip() in {"0", "false", "off", "no"}:
            return None
        platform = str(kwargs.get("platform") or "").strip().lower()
        if platform in _SKIP_PLATFORMS or kwargs.get("parent_session_id") or _oneshot():
            return _skip(f"platform={platform!r} parent={bool(kwargs.get('parent_session_id'))} oneshot={_oneshot()}")
        text = _user_text(kwargs.get("user_message")).strip()
        if (not text or text.startswith("/") or text.startswith(_IMPLEMENT_PREFIX)
                or _INJECTED.match(text) or _OPT_OUT.search(text)):
            return _skip("message is a command, injected turn or opt-out")

        inst, mod = _plan_mode()
        if inst is None:
            return _skip("plan-mode instance not found")
        if mod._cron_session_is_active():
            return _skip("cron")
        identity = mod.derive_session_identity(platform)
        if identity.unsupported or identity.non_cli_without_key or not identity.key:
            return _skip(f"no session identity ({identity!r})")
        if (identity.surface or "").strip().lower() not in _SURFACES:
            return _skip(f"surface={identity.surface!r}")
        with inst._lock:
            _key, state = inst._state_for_hook(identity)
        if state.get("active") or state.get("phase") == "executing":
            return _skip("already planning/executing")

        result = inst._run_command("on", text[:500], entered_by="agent")
        message = result.get("message", "") if isinstance(result, dict) else str(result or "")
        if not message.startswith("Plan mode is on"):
            return _skip(f"plan-mode refused: {message[:200]!r}")
        _trace("on: plan mode turned on for this turn")
        return {
            "context": (
                "[plan-auto] Plan mode was turned ON automatically for this request (the user's default).\n"
                + message
                + "\nIf this request changes nothing (a question, research, inspecting or running things, "
                "security work), call plan_mode with action \"off\" first and then do it. Any request that "
                "creates or edits files — however small — is planned and submitted for approval."
            )
        }
    except Exception as exc:  # never break a turn
        _trace(f"error: {exc!r}")
        return None


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", pre_llm_call)
