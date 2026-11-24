"""Run: python3 -m unittest tools/claude-code-live/test_claude_live.py

The event sequence mirrors payloads recorded from Claude Code 2.1.331 hooks
(same keys and ordering), with synthetic values.
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import claude_live as cl  # noqa: E402

S, P, A = "11111111-2222-3333-4444-555555555555", "pppp-0001", "agent0001"
BASE = {"session_id": S, "prompt_id": P, "cwd": "/repo", "permission_mode": "auto"}
SUB = {"agent_id": A, "agent_type": "Explore"}

EVENTS = [
    ("SessionStart", {"source": "startup"}),
    ("UserPromptSubmit", {"prompt": "fix the bug"}),
    ("PreToolUse", {"tool_name": "Bash", "tool_use_id": "t1", "tool_input": {"command": "ls"}}),
    ("PostToolUse", {"tool_name": "Bash", "tool_use_id": "t1", "tool_input": {"command": "ls"},
                     "tool_response": {"stdout": "a"}, "duration_ms": 5}),
    ("PreToolUse", {"tool_name": "Agent", "tool_use_id": "t2",
                    "tool_input": {"description": "look", "prompt": "x", "subagent_type": "Explore"}}),
    ("SubagentStart", SUB),
    ("PreToolUse", {**SUB, "tool_name": "Bash", "tool_use_id": "t3", "tool_input": {"command": "ls /nope"}}),
    ("PostToolUseFailure", {**SUB, "tool_name": "Bash", "tool_use_id": "t3", "tool_input": {"command": "ls /nope"},
                            "error": "Exit code 1", "is_interrupt": False, "duration_ms": 9}),
    ("PreToolUse", {**SUB, "tool_name": "Write", "tool_use_id": "t4",
                    "tool_input": {"file_path": "/repo/x", "content": "secret" * 100}}),
    ("PostToolUse", {**SUB, "tool_name": "Write", "tool_use_id": "t4",
                     "tool_input": {"file_path": "/repo/x", "content": "secret" * 100}, "tool_response": "ok"}),
    ("SubagentStop", {**SUB, "last_assistant_message": "done"}),
    ("PostToolUse", {"tool_name": "Agent", "tool_use_id": "t2", "tool_input": {}, "tool_response": {"agentId": A}}),
    ("PermissionRequest", {"tool_name": "Bash", "tool_input": {"command": "rm x"}}),
    ("Stop", {"last_assistant_message": "fixed", "background_tasks": []}),
    ("SessionEnd", {"reason": "exit"}),
]


def run(events, upto=None):
    out, states = [], []
    t = cl.Tracker(out.append)
    for i, (ev, extra) in enumerate(events[:upto]):
        t.handle({**BASE, "hook_event_name": ev, **extra}, 1_000_000_000 * (i + 1))
        states.append(t.snapshot()[S].get("state"))
    return t, out, states


class TrackerTest(unittest.TestCase):
    def test_states_follow_events(self):
        _, _, states = run(EVENTS)
        self.assertEqual(states[:4], ["idle", "thinking", "tool_running", "thinking"])
        self.assertEqual(states[-3:], ["awaiting_permission", "idle", "ended"])

    def test_subagent_state_tracked_separately(self):
        t, _, _ = run(EVENTS, upto=7)
        agent = t.snapshot()[S]["agents"][A]
        self.assertEqual((agent["state"], agent["tool"]), ("tool_running", "Bash"))

    def test_paths_are_consistent(self):
        _, out, _ = run(EVENTS)
        for s in out:
            ids, names = s["attrs"]["lmnr.span.ids_path"], s["attrs"]["lmnr.span.path"]
            self.assertEqual(len(ids), len(names))
            self.assertEqual(ids[-1], cl.span_uuid(s["span_hex"]))
            if len(ids) > 1:
                self.assertEqual(ids[-2], cl.span_uuid(s["parent_hex"]))

    def test_subagent_hangs_under_agent_tool(self):
        _, out, _ = run(EVENTS)
        failed = next(s for s in out if s["error"])
        self.assertEqual(failed["attrs"]["lmnr.span.path"][1:], ["Agent", "Subagent: Explore", "Bash"])

    def test_ids_are_deterministic(self):
        _, a, _ = run(EVENTS)
        _, b, _ = run(EVENTS)
        self.assertEqual([s["span_hex"] for s in a], [s["span_hex"] for s in b])
        self.assertEqual(len({s["trace_hex"] for s in a}), 1)

    def test_root_closes_once_with_prompt(self):
        _, out, _ = run(EVENTS)
        roots = [s for s in out if not s["parent_hex"]]
        self.assertEqual(len(roots), 1)
        self.assertIn("fix the bug", roots[0]["attrs"]["lmnr.span.input"])

    def test_file_content_redacted(self):
        _, out, _ = run(EVENTS)
        write = next(s for s in out if s["name"] == "Write")
        self.assertNotIn("secret", write["attrs"]["lmnr.span.input"])
        self.assertIn("<600 chars>", write["attrs"]["lmnr.span.input"])

    def test_clip_limits_size(self):
        self.assertLess(len(cl.clip("x" * 10_000)), cl.MAX_CHARS + 40)

    def test_failure_becomes_exception_event(self):
        _, out, _ = run(EVENTS)
        span = cl.otlp_span(next(s for s in out if s["error"]))
        self.assertEqual(span["events"][0]["name"], "exception")
        self.assertEqual(span["status"]["code"], 2)
        arr = next(a for a in span["attributes"] if a["key"] == "lmnr.span.ids_path")
        self.assertIn("arrayValue", arr["value"])

    def test_bad_event_is_ignored(self):
        t = cl.Tracker(lambda s: None)
        t.handle({"hook_event_name": "PreToolUse"}, 1)  # no session_id
        t.handle({**BASE, "hook_event_name": "PostToolUse", "tool_use_id": "zz"}, 2)  # Post without Pre
        self.assertIn(S, t.snapshot())


if __name__ == "__main__":
    unittest.main()
