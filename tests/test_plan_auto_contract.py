"""Contract checks: plan-auto against the REAL plan-mode plugin, not a fake.

Run: python3 -I tests/test_plan_auto_contract.py plugin/plan-auto ~/.hermes/plugins/plan-mode

Why. plan-auto drives plan-mode through private names — the ``PlanModePlugin`` class name, its
``_lock`` / ``_state_for_hook`` / ``_run_command``, the module's ``derive_session_identity`` /
``_delegated_child`` / ``_cron_session_is_active``, the ``SessionIdentity`` fields, the
``"Plan mode is on"`` reply and the ``active`` / ``phase == "executing"`` state keys. test_plan_auto.py
proves plan-auto's logic against a fake that has all of them by construction, so a plan-mode update
that renames one would pass it while plan-auto silently stops gating (every failure path fails open
into the trace log). This file checks the real thing.

Read-only by design: nothing here resolves a session, turns plan mode on or writes plan state. The
plugin is registered into an in-memory ctx, and every check is on names, signatures and source text.
Exit 0 with "ALL PASS"; exit 2 when the plan-mode path is missing (nothing to check against).
"""
import ast
import dataclasses
import importlib
import importlib.util
import inspect
import os
import sys
import textwrap
import types

if len(sys.argv) < 3:
    print("usage: test_plan_auto_contract.py <plan-auto dir> <plan-mode dir>")
    sys.exit(2)
PLAN_AUTO, PLAN_MODE = sys.argv[1], os.path.expanduser(sys.argv[2])
if not os.path.isfile(os.path.join(PLAN_MODE, "plan_mode", "plugin.py")):
    print(f"SKIP plan-mode not found at {PLAN_MODE}")
    sys.exit(2)

fails = []


def check(name, got, want=True):
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  got={got!r} want={want!r}"))
    if not ok:
        fails.append(name)


def binds(fn, *args, **kwargs):
    try:
        inspect.signature(fn).bind(*args, **kwargs)
        return True
    except TypeError:
        return False


# ── load the real plan-mode package ───────────────────────────────────────────────────────────
sys.path.insert(0, PLAN_MODE)
pm = importlib.import_module("plan_mode.plugin")
sys.path.remove(PLAN_MODE)


# ── register it into an in-memory ctx: no Hermes, no disk ─────────────────────────────────────
class MemState:
    def __init__(self):
        self.data = {}

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value


class FakeCtx:
    def __init__(self):
        self.hooks = {}
        self.state = MemState()
        self._manager = None

    def register_hook(self, name, cb):
        self.hooks.setdefault(name, []).append(cb)

    def __getattr__(self, name):  # register_command, register_tool, …: accepted and ignored
        if name.startswith("register_"):
            return lambda *a, **k: None
        raise AttributeError(name)


ctx = FakeCtx()
cls = getattr(pm, "PlanModePlugin", None)
check("plan_mode.plugin still defines PlanModePlugin (plan-auto matches it by class name)", cls is not None)
if cls is None:
    print("1 FAILED")
    sys.exit(1)
cls(ctx).register()

# ── 1. plan-auto finds plan-mode the way it does at runtime: through the live hook registry ───
manager = types.SimpleNamespace(_hooks=ctx.hooks)
fake_plugins = types.ModuleType("hermes_cli.plugins")
fake_plugins.get_plugin_manager = lambda: manager
sys.modules.setdefault("hermes_cli", types.ModuleType("hermes_cli"))
sys.modules["hermes_cli.plugins"] = fake_plugins

spec = importlib.util.spec_from_file_location("plan_auto", os.path.join(PLAN_AUTO, "__init__.py"))
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)

inst, mod = pa._plan_mode()
check("plan-auto's _plan_mode() finds the real PlanModePlugin via pre_tool_call", type(inst).__name__, "PlanModePlugin")
check("…and the module it returns is plan_mode.plugin", getattr(mod, "__name__", None), "plan_mode.plugin")

# ── 2. every private name plan-auto calls exists with a shape plan-auto's call binds to ───────
check("module: derive_session_identity(platform)", callable(getattr(pm, "derive_session_identity", None))
      and binds(pm.derive_session_identity, ""))
check("module: _delegated_child()", callable(getattr(pm, "_delegated_child", None)) and binds(pm._delegated_child))
check("module: _cron_session_is_active()", callable(getattr(pm, "_cron_session_is_active", None))
      and binds(pm._cron_session_is_active))
fields = {f.name for f in dataclasses.fields(pm.SessionIdentity)} if dataclasses.is_dataclass(pm.SessionIdentity) else set()
check("SessionIdentity has key/surface/unsupported/non_cli_without_key",
      {"key", "surface", "unsupported", "non_cli_without_key"} <= fields)
lock = getattr(inst, "_lock", None)
check("instance: _lock is a context manager", hasattr(lock, "__enter__") and hasattr(lock, "__exit__"))
state_for_hook = getattr(inst, "_state_for_hook", None)
run_command = getattr(inst, "_run_command", None)
check("instance: _state_for_hook(identity)", callable(state_for_hook)
      and binds(state_for_hook, pm.SessionIdentity(key="ui:contract")))
check("instance: _run_command('on', task, entered_by='agent')", callable(run_command)
      and binds(run_command, "on", "task", entered_by="agent"))

# ── 3. the strings and state keys plan-auto reads ─────────────────────────────────────────────
run_src = inspect.getsource(run_command) if callable(run_command) else ""


def string_heads(src):
    """The leading literal text of every string / f-string in a function's (dedented) source."""
    out = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.append(node.value)
        elif isinstance(node, ast.JoinedStr) and node.values and isinstance(node.values[0], ast.Constant):
            out.append(str(node.values[0].value))
    return out


heads = string_heads(textwrap.dedent(run_src))
on_heads = [h for h in heads if h.startswith("Plan mode is on")]
check("_run_command's success reply starts with 'Plan mode is on'", any(h.startswith("Plan mode is on for this session") for h in on_heads))
check("no refusal from _run_command starts with 'Plan mode is on' (it would read as success)",
      [h for h in on_heads if not h.startswith("Plan mode is on for this session")], [])
plugin_src = inspect.getsource(pm)
check("state key 'active' is still read by plan-mode", 'state.get("active")' in plugin_src)
check("phase 'executing' is still how plan-mode marks an approved run", 'get("phase") == "executing"' in plugin_src)

# ── 4. what the gate looks like end to end when no session can be resolved (no Hermes here) ───
# Outside Hermes there is no session context: plan-auto must step aside, not raise or block.
check("no Hermes session context → write_file is not blocked, nothing raised",
      pa.pre_tool_call("write_file", {"path": "x"}), None)

print("ALL PASS" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
