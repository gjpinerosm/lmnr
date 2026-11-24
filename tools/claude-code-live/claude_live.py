#!/usr/bin/env python3
"""Live Claude Code agent state for a self-hosted Laminar.

Receives Claude Code hooks over HTTP, keeps per-session/per-agent state in
memory, and streams OTLP spans to a separate Laminar project so the trace view
updates while a turn is still running.

    claude_live.py serve [--record]   run the daemon (foreground)
    claude_live.py status             print current state
    claude_live.py stop               stop the daemon
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("CLAUDE_LIVE_PORT", "47821"))
STATE_DIR = Path(os.environ.get("CLAUDE_LIVE_STATE_DIR", Path.home() / ".claude/state/claude-live"))
CONFIG = Path(os.environ.get("CLAUDE_LIVE_CONFIG", Path.home() / ".config/lmnr/claude-live.json"))
PIDFILE = STATE_DIR / "daemon.pid"
LOGFILE = STATE_DIR / "daemon.log"
RECORDFILE = STATE_DIR / "record.jsonl"


MAX_CHARS = int(os.environ.get("CLAUDE_LIVE_MAX_CHARS", "2048"))
FLUSH_SECONDS = 0.3
# Tool inputs whose bulk is file content: keep the shape, drop the text.
REDACT_FIELDS = {"content", "old_string", "new_string", "new_source", "edits"}


def log(msg: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with LOGFILE.open("a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}\n")


# --------------------------------------------------------------------------- ids


def hex_id(*parts: str, nbytes: int = 8) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[: nbytes * 2]


def span_uuid(span_hex: str) -> str:
    """How Laminar stores an 8-byte OTLP span id; ids_path must use this form."""
    return f"00000000-0000-0000-{span_hex[:4]}-{span_hex[4:]}"


def clip(value, limit: int = MAX_CHARS) -> str:
    if isinstance(value, dict):
        value = {k: (f"<{len(v)} chars>" if k in REDACT_FIELDS and isinstance(v, str) else
                     f"<{len(v)} items>" if k in REDACT_FIELDS and isinstance(v, list) else v)
                 for k, v in value.items()}
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[:limit] + f"… <+{len(s) - limit} chars>"


# --------------------------------------------------------------------------- tracker


class Node:
    """A span that has children before it is closed: turn root, Agent tool, subagent."""

    def __init__(self, span_hex: str, name: str, chain: list["Node"]):
        self.span_hex = span_hex
        self.name = name
        self.chain = chain  # ancestors, root first

    def path(self) -> list["Node"]:
        return [*self.chain, self]


class Turn:
    def __init__(self, session_id: str, prompt_id: str, start_ns: int):
        self.session_id = session_id
        self.prompt_id = prompt_id
        self.trace_hex = hex_id(session_id, prompt_id, nbytes=16)
        self.start_ns = start_ns
        self.prompt: str | None = None
        self.closed = False
        self.cwd = ""
        # Delegation graph for Laminar's trace-view graph panel: agent_id ("" = main) -> label/parent,
        # and per-agent tool counts [calls, errors].
        self.graph_agents: dict[str, dict] = {"": {"label": "Main", "parent": None}}
        self.tool_counts: dict[tuple[str, str], list[int]] = {}
        self.root = Node(hex_id(self.trace_hex, "root"), f"Claude Code - Live ({session_id[:8]})", [])


GRAPH_SKIP_TOOLS = {"Agent", "SubagentHandback"}  # shown as delegation edges instead


def turn_graph(turn: Turn) -> dict:
    """The turn's agents and tools in the LangGraph shape Laminar's trace view renders as a graph."""
    project = os.path.basename(turn.cwd.rstrip("/")) if turn.cwd else ""
    nodes = [{"id": "__start__", "type": "schema", "data": "__start__"}]
    edges = [{"source": "__start__", "target": "main"}]
    for aid, a in turn.graph_agents.items():
        nid = aid or "main"
        label = f"Main · {project}" if not aid and project else a["label"]
        nodes.append({"id": nid, "type": "runnable", "data": label})
        if aid:
            edges.append({"source": a["parent"] or "main", "target": nid, "data": "Agent"})
    for (aid, tool), (n, err) in sorted(turn.tool_counts.items()):
        nid = f"{aid or 'main'}:{tool}"
        nodes.append({"id": nid, "type": "runnable", "data": f"{tool} ×{n}" + (f" · ✕{err}" if err else "")})
        edges.append({"source": aid or "main", "target": nid})
    nodes.append({"id": "__end__", "type": "schema", "data": "__end__"})
    edges.append({"source": "main", "target": "__end__"})
    return {"lmnr.association.properties.langgraph.nodes": json.dumps(nodes, ensure_ascii=False),
            "lmnr.association.properties.langgraph.edges": json.dumps(edges, ensure_ascii=False)}


class Tracker:
    """Hook events in, OTLP spans out. All state is in memory and best-effort."""

    def __init__(self, emit):
        self.emit = emit
        self.lock = threading.Lock()
        self.turns: dict[tuple[str, str], Turn] = {}
        self.sessions: dict[str, dict] = {}
        self.tools: dict[str, tuple[int, Node | None]] = {}  # tool_use_id -> (start, Agent node)
        self.agents: dict[str, Node] = {}  # agent_id -> subagent node
        self.agent_start: dict[str, int] = {}
        # Agent tool calls waiting for their SubagentStart, per (session, launching agent).
        self.launches: dict[tuple[str, str], list[tuple[str, str, Node]]] = {}

    # -- state ---------------------------------------------------------------

    def _session(self, p: dict, ts: int) -> dict:
        s = self.sessions.setdefault(p["session_id"], {"agents": {}})
        for k in ("cwd", "permission_mode", "prompt_id"):
            if p.get(k):
                s[k] = p[k]
        s["updated_ns"] = ts
        return s

    def _set_state(self, p: dict, ts: int, state: str, **extra) -> None:
        s = self._session(p, ts)
        aid = p.get("agent_id") or ""
        if aid:
            a = s["agents"].setdefault(aid, {"type": p.get("agent_type", "")})
            a.update(state=state, since_ns=ts, **extra)
        else:
            s.update(state=state, since_ns=ts, **extra)

    def snapshot(self) -> dict:
        with self.lock:
            return json.loads(json.dumps(self.sessions, default=str))

    # -- turns and chains ----------------------------------------------------

    @staticmethod
    def _key(p: dict) -> tuple[str, str]:
        return p["session_id"], p.get("prompt_id") or "no-prompt-id"

    def _turn(self, p: dict, ts: int) -> Turn:
        key = self._key(p)
        t = self.turns.get(key)
        if t is None:
            t = self.turns[key] = Turn(key[0], key[1], ts)
        if p.get("cwd") and not p.get("agent_id"):
            t.cwd = p["cwd"]
        return t

    def _chain(self, p: dict, turn: Turn) -> list[Node]:
        node = self.agents.get(p.get("agent_id") or "")
        return node.path() if node else [turn.root]

    # -- span helpers --------------------------------------------------------

    def _span(self, turn: Turn, chain: list[Node], span_hex: str, name: str, start: int, end: int,
              p: dict, span_type: str = "DEFAULT", attrs: dict | None = None, input=None, output=None,
              error: str | None = None) -> None:
        nodes = [*chain, Node(span_hex, name, [])]
        a = {
            "lmnr.span.type": span_type,
            "lmnr.span.path": [n.name for n in nodes],
            "lmnr.span.ids_path": [span_uuid(n.span_hex) for n in nodes],
            "lmnr.association.properties.session_id": turn.session_id,
            "claude_code.session_id": turn.session_id,
            "claude_code.prompt_id": turn.prompt_id,
        }
        for k in ("agent_id", "agent_type", "permission_mode", "cwd"):
            if p.get(k):
                a[f"claude_code.{k}"] = p[k]
        if input is not None:
            a["lmnr.span.input"] = clip(input)
        if output is not None:
            a["lmnr.span.output"] = clip(output)
        a.update(attrs or {})
        self.emit({
            "trace_hex": turn.trace_hex,
            "span_hex": span_hex,
            "parent_hex": chain[-1].span_hex if chain else "",
            "name": name,
            "start_ns": start,
            "end_ns": max(end, start),
            "attrs": a,
            "error": error,
        })

    def _marker(self, turn: Turn, chain: list[Node], name: str, ts: int, p: dict, state: str, **kw) -> None:
        attrs = {"live.marker": True, "live.state": state, **kw.pop("attrs", {})}
        self._span(turn, chain, hex_id(turn.trace_hex, name, str(ts)), name, ts, ts, p, attrs=attrs, **kw)

    # -- events --------------------------------------------------------------

    def handle(self, p: dict, ts: int) -> None:
        ev = p.get("hook_event_name", "")
        if not p.get("session_id"):
            return
        with self.lock:
            fn = getattr(self, f"on_{ev}", None)
            if fn:
                fn(p, ts)
            else:
                self._session(p, ts)

    def on_SessionStart(self, p, ts):
        self._set_state(p, ts, "idle", source=p.get("source", ""))

    def on_UserPromptSubmit(self, p, ts):
        turn = self._turn(p, ts)
        prompt = p.get("prompt", "")
        if turn.prompt is None:
            turn.prompt = prompt
        self._set_state(p, ts, "thinking", trace_id=turn.trace_hex)
        self._marker(turn, [turn.root], "▶ Prompt", ts, p, "thinking", input=prompt)

    def on_PreToolUse(self, p, ts):
        turn = self._turn(p, ts)
        chain = self._chain(p, turn)
        tid, tool = p.get("tool_use_id", ""), p.get("tool_name", "")
        node = Node(hex_id(tid), tool, chain)
        if tool == "Agent":
            self.tools[tid] = (ts, node)
            ti = p.get("tool_input") or {}
            key = (turn.session_id, p.get("agent_id") or "")
            self.launches.setdefault(key, []).append(
                (ti.get("subagent_type") or "general-purpose", tid, node, ti.get("description") or ""))
        else:
            self.tools[tid] = (ts, None)
        self._set_state(p, ts, "tool_running", tool=tool, tool_use_id=tid, trace_id=turn.trace_hex)
        # A child of the not-yet-sent tool span, so the tool renders as pending until it ends.
        self._marker(turn, node.path(), f"▶ {tool}", ts, p, "tool_running",
                     input=p.get("tool_input"), attrs={"claude_code.tool_use_id": tid})

    def _end_tool(self, p, ts, error: str | None):
        turn = self._turn(p, ts)
        tid, tool = p.get("tool_use_id", ""), p.get("tool_name", "")
        start, _ = self.tools.pop(tid, (ts - int(p.get("duration_ms") or 0) * 1_000_000, None))
        attrs = {"claude_code.tool.name": tool, "claude_code.tool.id": tid}
        if p.get("duration_ms") is not None:
            attrs["claude_code.duration_ms"] = p["duration_ms"]
        if p.get("is_interrupt"):
            attrs["claude_code.is_interrupt"] = True
        self._span(turn, self._chain(p, turn), hex_id(tid), tool, start, ts, p, "TOOL", attrs,
                   input=p.get("tool_input"), output=p.get("tool_response"), error=error)
        if tool not in GRAPH_SKIP_TOOLS:
            c = turn.tool_counts.setdefault((p.get("agent_id") or "", tool), [0, 0])
            c[0] += 1
            c[1] += error is not None
        self._set_state(p, ts, "thinking", tool=None, tool_use_id=None)

    def on_PostToolUse(self, p, ts):
        self._end_tool(p, ts, None)

    def on_PostToolUseFailure(self, p, ts):
        self._end_tool(p, ts, p.get("error") or "tool failed")

    def on_PermissionRequest(self, p, ts):
        turn = self._turn(p, ts)
        tool = p.get("tool_name", "")
        self._set_state(p, ts, "awaiting_permission", tool=tool)
        self._marker(turn, self._chain(p, turn), f"⏸ Permiso: {tool}", ts, p, "awaiting_permission",
                     input=p.get("tool_input"))

    def on_PermissionDenied(self, p, ts):
        turn = self._turn(p, ts)
        self._set_state(p, ts, "thinking")
        self._marker(turn, self._chain(p, turn), f"✕ Permiso denegado: {p.get('tool_name', '')}", ts, p,
                     "thinking", output=p.get("reason"))

    def on_Notification(self, p, ts):
        kind = p.get("notification_type") or ""
        state = {"permission_prompt": "awaiting_permission", "idle_prompt": "awaiting_user"}.get(kind)
        if state:
            self._set_state(p, ts, state, message=p.get("message", ""))
        turn = self.turns.get(self._key(p))
        if turn and not turn.closed:
            self._marker(turn, self._chain(p, turn), f"🔔 {kind or 'notification'}", ts, p, state or "",
                         output=p.get("message"))

    def on_SubagentStart(self, p, ts):
        turn = self._turn(p, ts)
        aid, atype = p.get("agent_id", ""), p.get("agent_type", "")
        # The launching agent is not in the payload: match the oldest pending Agent call of the same type.
        parent_chain, parent_aid, desc = [turn.root], "", ""
        for key, queue in self.launches.items():
            if key[0] != turn.session_id:
                continue
            hit = next((x for x in queue if x[0] == atype), None)
            if hit:
                queue.remove(hit)
                parent_chain, parent_aid, desc = hit[2].path(), key[1], hit[3]
                break
        label = f"{atype}: {desc[:40]}" if desc else atype
        turn.graph_agents[aid] = {"label": label, "parent": parent_aid}
        node = Node(hex_id(turn.trace_hex, "agent", aid), f"Subagent: {atype}", parent_chain)
        self.agents[aid] = node
        self.agent_start[aid] = ts
        self._set_state(p, ts, "thinking", trace_id=turn.trace_hex)
        self._marker(turn, node.path(), "▶ Subagent start", ts, p, "thinking")

    def on_SubagentStop(self, p, ts):
        turn = self._turn(p, ts)
        aid = p.get("agent_id", "")
        node = self.agents.pop(aid, None)
        if node is None:
            return
        self._span(turn, node.chain, node.span_hex, node.name, self.agent_start.pop(aid, ts), ts, p,
                   attrs={"claude_code.subagent.type": p.get("agent_type", "")},
                   output=p.get("last_assistant_message"))
        self._set_state(p, ts, "done")

    def on_PreCompact(self, p, ts):
        self._set_state(p, ts, "compacting", trigger=p.get("trigger", ""))

    def on_PostCompact(self, p, ts):
        s = self.sessions.get(p["session_id"], {})
        start = s.get("since_ns", ts) if s.get("state") == "compacting" else ts
        turn = self._turn(p, ts)
        self._span(turn, [turn.root], hex_id(turn.trace_hex, "compact", str(ts)), "Compactación", start, ts, p,
                   attrs={"claude_code.compact.trigger": p.get("trigger", "")})
        self._set_state(p, ts, "thinking")

    def on_StopFailure(self, p, ts):
        turn = self._turn(p, ts)
        self._set_state(p, ts, "error", error=p.get("error", ""))
        self._marker(turn, [turn.root], "✕ Error de API", ts, p, "error", error=clip(p.get("error") or "stop failure"))

    def _close_turn(self, turn: Turn, p: dict, ts: int, output=None) -> None:
        if turn.closed:
            return
        turn.closed = True
        attrs = turn_graph(turn)
        if p.get("git_branch"):
            attrs["claude_code.git_branch"] = p["git_branch"]
        self._span(turn, [], turn.root.span_hex, turn.root.name, turn.start_ns, ts, p, attrs=attrs,
                   input=turn.prompt, output=output)

    def on_Stop(self, p, ts):
        if p.get("agent_id"):
            return
        turn = self._turn(p, ts)
        bg = p.get("background_tasks") or []
        running = [b for b in bg if isinstance(b, dict) and b.get("status") == "running"]
        self._close_turn(turn, p, ts, output=p.get("last_assistant_message"))
        self._set_state(p, ts, "background_wait" if running else "idle", background=len(running))

    def on_SessionEnd(self, p, ts):
        for (sid, _), turn in list(self.turns.items()):
            if sid == p["session_id"]:
                self._close_turn(turn, p, ts)
                del self.turns[(sid, _)]
        self._set_state(p, ts, "ended", reason=p.get("reason", ""))


# --------------------------------------------------------------------------- emitter


def otlp_value(v):
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [otlp_value(x) for x in v]}}
    return {"stringValue": str(v)}


def otlp_span(s: dict) -> dict:
    out = {
        "traceId": s["trace_hex"],
        "spanId": s["span_hex"],
        "name": s["name"],
        "kind": 1,
        "startTimeUnixNano": str(s["start_ns"]),
        "endTimeUnixNano": str(s["end_ns"]),
        "attributes": [{"key": k, "value": otlp_value(v)} for k, v in s["attrs"].items()],
        "status": {"code": 2 if s["error"] else 1},
        "events": [],
    }
    if s["parent_hex"]:
        out["parentSpanId"] = s["parent_hex"]
    if s["error"]:
        # Laminar marks a span as failed only through an event named "exception".
        out["events"].append({"name": "exception", "timeUnixNano": str(s["end_ns"]),
                              "attributes": [{"key": "exception.message", "value": {"stringValue": s["error"]}}]})
    return out


class Emitter:
    def __init__(self):
        self.queue: list[dict] = []
        self.lock = threading.Lock()
        self.config: dict | None = None
        self.config_mtime = 0.0
        self.sent = 0
        self.dropped = 0

    def put(self, span: dict) -> None:
        with self.lock:
            self.queue.append(span)

    def _load_config(self) -> dict | None:
        try:
            m = CONFIG.stat().st_mtime
        except FileNotFoundError:
            return None
        if m != self.config_mtime:
            self.config_mtime = m
            try:
                self.config = json.loads(CONFIG.read_text())
                if not self.config.get("projectApiKey"):
                    raise ValueError("projectApiKey missing")
            except (ValueError, OSError) as e:
                self.config = None
                log(f"invalid config {CONFIG}: {type(e).__name__}")
        return self.config

    def flush(self) -> None:
        with self.lock:
            batch, self.queue = self.queue, []
        if not batch:
            return
        cfg = self._load_config()
        if not cfg:
            self.dropped += len(batch)
            return
        body = json.dumps({"resourceSpans": [{
            "resource": {"attributes": [
                {"key": "service.name", "value": {"stringValue": "claude-code-live"}}]},
            "scopeSpans": [{"scope": {"name": "claude_live"}, "spans": [otlp_span(s) for s in batch]}],
        }]}).encode()
        req = urllib.request.Request(
            cfg.get("baseUrl", "http://localhost:8000").rstrip("/") + "/v1/traces", data=body, method="POST",
            headers={"Authorization": f"Bearer {cfg['projectApiKey']}", "Content-Type": "application/json"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    r.read()
                self.sent += len(batch)
                return
            except OSError as e:
                err = e
                time.sleep(0.5 * 2**attempt)
        self.dropped += len(batch)
        log(f"export failed, dropped {len(batch)} spans: {err}")

    def run(self, stop: threading.Event) -> None:
        while not stop.wait(FLUSH_SECONDS):
            try:
                self.flush()
            except Exception as e:
                log(f"flush error {type(e).__name__}: {e}")
        self.flush()


def subagent_meta_path(payload: dict) -> Path:
    t = Path(payload.get("transcript_path") or "")
    return t.parent / t.stem / "subagents" / f"agent-{payload.get('agent_id', '')}.meta.json"


class Handler(BaseHTTPRequestHandler):
    server: "LiveServer"

    def log_message(self, *args) -> None:  # silence default stderr access log
        pass

    def _reply(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if self.path != "/hook":
            return self._reply(404, {})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._reply(400, {})
        # Reply before doing any work: an empty object never alters Claude Code's decision.
        self._reply(200, {})
        self.server.on_event(payload, time.time_ns())

    def do_GET(self) -> None:
        if self.path == "/health":
            return self._reply(200, {"ok": True})
        if self.path == "/state":
            return self._reply(200, self.server.snapshot())
        self._reply(404, {})


class LiveServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, record: bool, tracker: Tracker | None = None, emitter: Emitter | None = None):
        super().__init__((HOST, PORT), Handler)
        self.record = record
        self.tracker = tracker
        self.emitter = emitter
        self._lock = threading.Lock()

    def on_event(self, payload: dict, ts_ns: int) -> None:
        if self.record:
            row = {"ts_ns": ts_ns, "payload": payload}
            if payload.get("hook_event_name") == "SubagentStart":
                row["meta_exists"] = subagent_meta_path(payload).exists()
            with self._lock, RECORDFILE.open("a") as f:
                f.write(json.dumps(row) + "\n")
        if self.tracker:
            try:
                self.tracker.handle(payload, ts_ns)
            except Exception as e:  # a bad event must never kill the daemon
                log(f"handle error {type(e).__name__}: {e}")

    def snapshot(self) -> dict:
        snap = {"sessions": self.tracker.snapshot() if self.tracker else {}}
        if self.emitter:
            snap["export"] = {"sent": self.emitter.sent, "dropped": self.emitter.dropped,
                              "configured": CONFIG.exists()}
        return snap


def cmd_serve(args) -> int:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    emitter = Emitter()
    srv = LiveServer(record=args.record, tracker=Tracker(emitter.put), emitter=emitter)
    stop = threading.Event()
    flusher = threading.Thread(target=emitter.run, args=(stop,), daemon=True)
    flusher.start()
    PIDFILE.write_text(str(os.getpid()))
    # shutdown() blocks until serve_forever() returns, so it cannot run on the serving thread.
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=srv.shutdown).start())
    log(f"serving on {HOST}:{PORT} record={args.record}")
    try:
        srv.serve_forever()
    finally:
        stop.set()
        flusher.join(timeout=15)
        PIDFILE.unlink(missing_ok=True)
        log("stopped")
    return 0


def _get(path: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORT}{path}", timeout=1) as r:
            return json.load(r)
    except OSError:
        return None


def cmd_status(_args) -> int:
    state = _get("/state")
    if state is None:
        print("claude-live: daemon not running")
        return 1
    print(json.dumps(state, indent=2, ensure_ascii=False))
    return 0


def cmd_stop(_args) -> int:
    try:
        os.kill(int(PIDFILE.read_text()), signal.SIGTERM)
    except (FileNotFoundError, ValueError, ProcessLookupError):
        print("claude-live: daemon not running")
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--record", action="store_true", help=f"append every hook payload to {RECORDFILE}")
    s.set_defaults(fn=cmd_serve)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("stop").set_defaults(fn=cmd_stop)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
