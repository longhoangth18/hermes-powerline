"""Unit checks for plan-auto against a fake plan-mode.

Run: python3 -I tests/test_plan_auto.py plugin/plan-auto   (CI does, see .github/workflows/compat.yml)
"""
import importlib.util
import sys
import threading
import types

spec = importlib.util.spec_from_file_location("plan_auto", sys.argv[1] + "/__init__.py")
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
check("top-level profile coder is blocked", blocked("delegate_task", {"goal": "y", "profile": "coder"}), True)
reset("đọc file")
check("read tools never blocked", blocked("read_file", {"path": "x"}), False)
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

print("ALL PASS" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
