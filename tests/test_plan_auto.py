"""Unit checks for plan-auto against a fake plan-mode.

Run: python3 -I tests/test_plan_auto.py plugin/plan-auto   (CI does, see .github/workflows/compat.yml)
"""
import importlib.util
import sys
import threading
import types

PLUGIN_DIR = sys.argv[1]  # saved: a check below rewrites sys.argv to simulate a one-shot run
spec = importlib.util.spec_from_file_location("plan_auto", PLUGIN_DIR + "/__init__.py")
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)


class Ident:
    def __init__(self, key="ui:abc", surface="local"):
        self.key, self.surface, self.unsupported, self.non_cli_without_key = key, surface, False, False


class FakeMod:
    child = False
    cron = False
    surface = "local"

    def derive_session_identity(self, platform):
        return Ident(surface=self.surface)

    def _delegated_child(self):
        return self.child

    def _cron_session_is_active(self):
        return self.cron


class FakeInst:
    def __init__(self):
        self._lock = threading.RLock()
        self.state = {}
        self.calls = []

    def _state_for_hook(self, identity):
        return identity.key, self.state

    def _run_command(self, action, task, entered_by="user"):
        self.calls.append((action, task, entered_by))
        self.state = {"active": True, "entered_by": entered_by}
        return "Plan mode is on for this session. NOTE"


mod, inst = FakeMod(), FakeInst()
pa._plan_mode = lambda: (inst, mod)
pa._default_route = lambda: "coder"
pa._trace = lambda line: None
fails = []


def check(name, got, want):
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  got={got!r} want={want!r}"))
    if not ok:
        fails.append(name)


def reset(msg):
    inst.state, inst.calls = {}, []
    pa._turns.clear()
    pa.pre_llm_call(platform="tui", user_message=msg)


def blocked(tool, args=None):
    r = pa.pre_tool_call(tool, args or {})
    return bool(r and r.get("action") == "block")


reset("thêm hàm sub")
check("write_file without plan is blocked", blocked("write_file", {"path": "x"}), True)
check("activation is agent-owned with the task", inst.calls[-1], ("on", "thêm hàm sub", "agent"))
check("while planning plan-mode is in charge", blocked("write_file"), False)

reset("refactor X")
check("delegate without profile → default coder → blocked", blocked("delegate_task", {"tasks": [{"goal": "refactor"}]}), True)
reset("research Y")
check("delegate to researcher passes", blocked("delegate_task", {"tasks": [{"goal": "y", "profile": "researcher"}]}), False)
reset("research Y")
check("legacy top-level goal runs on the default route → blocked", blocked("delegate_task", {"goal": "y"}), True)
reset("research Y")
check("top-level profile is ignored by Hermes → still default coder → blocked",
      blocked("delegate_task", {"goal": "y", "profile": "researcher"}), True)
reset("research Y")
check("tasks as a JSON string, researcher → passes",
      blocked("delegate_task", {"tasks": '[{"goal": "y", "profile": "researcher"}]'}), False)
reset("research Y")
check("tasks as a JSON string, no profile → coder → blocked", blocked("delegate_task", {"tasks": '[{"goal": "y"}]'}), True)
reset("đọc file")
check("read tools never blocked", blocked("read_file", {"path": "x"}), False)
reset("thêm hàm sub")
check("claude-sub claude_code without a plan is blocked", blocked("mcp__claude_sub__claude_code", {"task": "x", "cwd": "/p"}), True)
reset("thêm hàm sub")
check("claude_status only reads a job → passes", blocked("mcp__claude_sub__claude_status", {"job_id": "j"}), False)
check("claude_cancel only stops a job → passes", blocked("mcp__claude_sub__claude_cancel", {"job_id": "j"}), False)
check("a look-alike name is not claude_code", blocked("mcp__x__claude_code_docs", {}), False)
reset("thêm hàm sub")
check("claude_code inside Tool Search's tool_call is judged too",
      blocked("tool_call", {"calls": [{"name": "mcp__claude_sub__claude_code", "arguments": {"task": "x"}}]}), True)
check("terminal not gated", blocked("terminal", {"command": "ls"}), False)

reset("làm luôn: sửa lỗi")
check("opt-out passes", blocked("patch"), False)
pa.pre_llm_call(platform="tui", user_message="/Users/me/x.py sửa lỗi này")
check("opt-out does not leak into a '/path' message", blocked("patch"), True)
reset("làm luôn: sửa lỗi")
pa.pre_llm_call(platform="tui", user_message="[ASYNC DELEGATION BATCH COMPLETE — d1] done")
check("injected turn keeps the user's opt-out", blocked("patch"), False)
reset("làm luôn")
pa.pre_llm_call(platform="tui", user_message="[WIP] sửa tiếp")
check("'[WIP] …' typed by the user is a new request", blocked("patch"), True)

reset("thêm tính năng")
inst.state = {"active": False, "phase": "executing"}
check("approved plan executing passes", blocked("write_file"), False)
inst.state = {}
check("follow-up edit after the approved plan, same turn, passes", blocked("write_file"), False)
pa.pre_llm_call(platform="tui", user_message="sửa thêm chỗ khác")
check("next request needs a new plan", blocked("write_file"), True)

reset("thêm tính năng")
check("first write blocked", blocked("write_file"), True)
inst.state = {}  # agent switched plan mode off itself, no approval
check("agent turning plan mode off does not open the gate", blocked("write_file"), True)

reset("x")
mod.child = True
check("delegated child (coder doing approved work) passes", blocked("write_file"), False)
mod.child = False
mod.cron = True
check("cron passes", blocked("write_file"), False)
mod.cron = False
mod.surface = "telegram"
check("messaging surface passes", blocked("write_file"), False)
mod.surface = "local"
sys.argv = ["hermes", "chat", "-q", "do it"]
check("one-shot -q passes", blocked("write_file"), False)
sys.argv = ["hermes"]
check("interactive again blocked", blocked("write_file"), True)

# ── branches the checks above never reached ──────────────────────────────────────────────────
import os  # noqa: E402

reset("y")
os.environ["HERMES_PLAN_AUTO"] = "0"
check("HERMES_PLAN_AUTO=0 disables the gate", blocked("write_file"), False)
os.environ["HERMES_PLAN_AUTO"] = "off"
check("HERMES_PLAN_AUTO=off disables it too", blocked("write_file"), False)
del os.environ["HERMES_PLAN_AUTO"]

reset("y")
real_run = FakeInst._run_command
FakeInst._run_command = lambda self, a, t, entered_by="user": "Plan mode activation was refused: no session"
check("plan-mode refusing activation lets the call through (no block without a plan mode)", blocked("write_file"), False)
FakeInst._run_command = lambda self, a, t, entered_by="user": {"message": "Plan mode is on for this session. NOTE"}
check("a dict-shaped activation reply is understood", blocked("write_file"), True)
inst.state = {}


def _boom(self, *a, **k):
    raise RuntimeError("plan-mode broke")


FakeInst._run_command = _boom
check("an exception inside plan-mode never escapes the hook", pa.pre_tool_call("write_file", {"path": "x"}), None)
FakeInst._run_command = real_run

inst.state, inst.calls = {}, []
pa._turns.clear()
pa.pre_llm_call(platform="subagent", user_message="làm luôn")
check("pre_llm_call ignores subagent turns (no entry recorded)", len(pa._turns), 0)
pa.pre_llm_call(platform="tui", user_message="làm luôn", parent_session_id="parent-1")
check("pre_llm_call ignores child sessions (parent_session_id)", len(pa._turns), 0)
pa.pre_llm_call(platform="tui", user_message=[{"type": "text", "text": "sửa giúp, làm luôn"}, {"type": "image_url"}])
check("opt-out is read from multimodal text parts", blocked("write_file"), False)

pa._turns.clear()
for i in range(300):
    pa._turns[f"k{i}"] = {"optout": False, "planned": False, "task": ""}
pa.pre_llm_call(platform="tui", user_message="z")
check("per-session memory stays bounded at 256 entries", len(pa._turns) <= 256, True)
check("the newest session survives the trim", "ui:abc" in pa._turns, True)

# ── _default_route, the real one (the checks above stub it to "coder") ──────────────────────
# It must read config.yaml through Hermes' own loader: the gateway has no PyYAML, and the old
# `import yaml` made every profile-less delegation the coder route whatever the config said.
import json  # noqa: E402
import tempfile  # noqa: E402

spec_real = importlib.util.spec_from_file_location("plan_auto_route", PLUGIN_DIR + "/__init__.py")
real = importlib.util.module_from_spec(spec_real)
spec_real.loader.exec_module(real)
home = tempfile.mkdtemp(prefix="plan-auto-route-")
cfg_path = os.path.join(home, "config.yaml")


def write_cfg(backend, default, stamp):
    with open(cfg_path, "w", encoding="utf-8") as fh:  # JSON is valid YAML
        json.dump({"delegation": {"backend": backend, "backends": {"profile_routes": {"default": default}}}}, fh)
    os.utime(cfg_path, (stamp, stamp))


fake_yaml = types.ModuleType("hermes_yaml")
fake_yaml.safe_load = lambda stream: json.load(stream)
sys.modules["hermes_yaml"] = fake_yaml
os.environ["HERMES_HOME"] = home
write_cfg("profile_routes", "researcher", 1_000_000)
check("default route is read from config.yaml via hermes_yaml", real._default_route(), "researcher")
write_cfg("profile_routes", "secops", 1_000_100)
check("a changed config.yaml is re-read (mtime cache)", real._default_route(), "secops")
write_cfg("default", "secops", 1_000_200)
check("no profile_routes backend → no default route", real._default_route(), "")
write_cfg("profile_routes", "researcher", 1_000_300)
real._plan_mode, real._trace = (lambda: (inst, mod)), (lambda line: None)
inst.state, inst.calls = {}, []
real._turns.clear()
real.pre_llm_call(platform="tui", user_message="viết test")
r = real.pre_tool_call("delegate_task", {"tasks": [{"goal": "research"}]})
check("profile-less delegation on a researcher default is not gated", bool(r and r.get("action") == "block"), False)
del sys.modules["hermes_yaml"]
sys.modules["yaml"] = None  # neither loader importable
real._route_cache.update(mtime=None, default="")
check("no YAML loader at all → falls back to the coder route", real._default_route(), "coder")
del sys.modules["yaml"]
del os.environ["HERMES_HOME"]

print("ALL PASS" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
