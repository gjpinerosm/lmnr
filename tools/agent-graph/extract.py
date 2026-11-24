#!/usr/bin/env python3
"""Build an agent graph (main agent -> subagents) from Claude Code traces stored in Laminar's ClickHouse.

Reads the `spans` table written by the lmnr Claude Code plugin, rebuilds each trace's tree by
`parent_span_id`, attributes every LLM span to the agent that owns it (nearest `Subagent: ...`
ancestor, else the main agent of the turn) and writes nodes/edges with tokens and cost.

Stdlib only. Credentials come from the repo's `.env` (CLICKHOUSE_USER / CLICKHOUSE_PASSWORD).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

ROOT_PREFIX = "Claude Code - Turn"
SUBAGENT_PREFIX = "Subagent:"
LLM_SPAN_TYPE = 1
TOOL_SPAN_TYPE = 6


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def query(url: str, user: str, password: str, container: str, sql: str) -> list[dict]:
    try:
        req = urllib.request.Request(
            f"{url}/?{urllib.parse.urlencode({'default_format': 'JSONEachRow'})}",
            data=sql.encode(),
            headers={"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode()
    except urllib.error.URLError as e:
        # docker-compose.yml doesn't publish 8123 to the host; the container's env already holds the creds.
        print(f"{url} unreachable ({e.reason}); querying via `docker exec {container}`", file=sys.stderr)
        raw = subprocess.run(
            ["docker", "exec", "-i", container, "clickhouse-client", "--format", "JSONEachRow"],
            input=sql, capture_output=True, text=True, check=True,
        ).stdout
    return [json.loads(line) for line in raw.splitlines() if line]


def sql_str(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def fetch_spans(args, url: str, user: str, password: str, container: str) -> list[dict]:
    attr = "JSONExtractString(attributes, {key})"
    # Session/cwd live only on the turn root span, so filters pick traces through their roots.
    root_filters = [f"name LIKE '{ROOT_PREFIX}%'"]
    if args.session:
        root_filters.append(
            f"{attr.format(key=sql_str('lmnr.association.properties.session_id'))} LIKE {sql_str(args.session + '%')}"
        )
    if args.project:
        root_filters.append(
            f"positionCaseInsensitive({attr.format(key=sql_str('lmnr.association.properties.metadata.cwd'))}, "
            f"{sql_str(args.project)}) > 0"
        )
    if args.since:
        root_filters.append(f"start_time >= parseDateTimeBestEffort({sql_str(args.since)})")

    sql = f"""
        SELECT
            toString(span_id) AS span_id,
            toString(parent_span_id) AS parent_span_id,
            toString(trace_id) AS trace_id,
            name,
            span_type,
            model,
            total_tokens,
            total_cost,
            toString(start_time) AS start_time,
            {attr.format(key="'lmnr.association.properties.session_id'")} AS session_id,
            {attr.format(key="'lmnr.association.properties.metadata.cwd'")} AS cwd,
            {attr.format(key="'claude_code.subagent.type'")} AS subagent_type,
            {attr.format(key="'claude_code.subagent.description'")} AS subagent_description,
            {attr.format(key="'claude_code.tool.name'")} AS tool_name
        FROM spans
        WHERE trace_id IN (SELECT trace_id FROM spans WHERE {' AND '.join(root_filters)})
    """
    return query(url, user, password, container, sql)


def short_project(cwd: str) -> str:
    return Path(cwd).name if cwd else "unknown"


def build_graph(spans: list[dict], mode: str, with_tools: bool) -> dict:
    by_id = {s["span_id"]: s for s in spans}
    roots = {s["trace_id"]: s for s in spans if s["name"].startswith(ROOT_PREFIX)}

    def owner(span: dict) -> dict | None:
        """Nearest Subagent ancestor (excluding the span itself), else the trace's root turn."""
        cur = by_id.get(span["parent_span_id"])
        while cur is not None:
            if cur["name"].startswith(SUBAGENT_PREFIX) or cur["name"].startswith(ROOT_PREFIX):
                return cur
            cur = by_id.get(cur["parent_span_id"])
        return roots.get(span["trace_id"])

    def node_key(agent_span: dict) -> tuple[str, dict]:
        root = roots.get(agent_span["trace_id"], agent_span)
        session = root["session_id"]
        project = short_project(root["cwd"])
        if agent_span["name"].startswith(ROOT_PREFIX):
            if mode == "session":
                return f"main:{session}", {"kind": "main", "label": f"Main agent\n{project} · {session[:8]}",
                                           "agent_type": "main", "project": project}
            return f"main:{project}", {"kind": "main", "label": f"Main agent\n{project}",
                                       "agent_type": "main", "project": project}
        agent_type = agent_span["subagent_type"] or "unknown"
        if mode == "session":
            desc = agent_span["subagent_description"] or agent_span["name"][len(SUBAGENT_PREFIX):].strip()
            return f"sub:{agent_span['span_id']}", {"kind": "subagent", "label": f"{agent_type}\n{desc}",
                                                    "agent_type": agent_type, "project": project}
        return f"type:{agent_type}", {"kind": "subagent", "label": agent_type, "agent_type": agent_type,
                                      "project": None}

    nodes: dict[str, dict] = {}
    edges: dict[tuple[str, str], dict] = {}

    def ensure_node(key: str, info: dict) -> dict:
        node = nodes.get(key)
        if node is None:
            node = nodes[key] = {"id": key, **info, "self_tokens": 0, "self_cost": 0.0, "llm_calls": 0,
                                 "tool_calls": 0, "instances": set(), "sessions": set(), "models": set()}
        return node

    span_node: dict[str, str] = {}
    # Own usage per subagent instance, so an edge carries only the instances its source launched.
    instance_usage: dict[str, list] = defaultdict(lambda: [0, 0.0])
    edge_instances: dict[tuple[str, str], list[str]] = defaultdict(list)
    for s in spans:
        if s["name"].startswith(ROOT_PREFIX) or s["name"].startswith(SUBAGENT_PREFIX):
            key, info = node_key(s)
            node = ensure_node(key, info)
            node["instances"].add(s["span_id"])
            node["sessions"].add(roots.get(s["trace_id"], s)["session_id"])
            span_node[s["span_id"]] = key

    for s in spans:
        if s["name"].startswith(ROOT_PREFIX):
            continue
        own = owner(s)
        if own is None:
            continue
        own_key = span_node[own["span_id"]]
        if s["name"].startswith(SUBAGENT_PREFIX):
            edge = edges.setdefault((own_key, span_node[s["span_id"]]),
                                    {"source": own_key, "target": span_node[s["span_id"]], "launches": 0})
            edge["launches"] += 1
            edge_instances[(own_key, span_node[s["span_id"]])].append(s["span_id"])
        elif s["span_type"] == LLM_SPAN_TYPE:
            instance_usage[own["span_id"]][0] += int(s["total_tokens"])
            instance_usage[own["span_id"]][1] += float(s["total_cost"])
            node = nodes[own_key]
            node["self_tokens"] += int(s["total_tokens"])
            node["self_cost"] += float(s["total_cost"])
            node["llm_calls"] += 1
            if s["model"]:
                node["models"].add(s["model"])
        elif s["span_type"] == TOOL_SPAN_TYPE:
            nodes[own_key]["tool_calls"] += 1
            if with_tools and s["tool_name"] not in ("Agent", "Task"):
                tool = s["tool_name"] or s["name"]
                tkey = f"tool:{tool}" if mode == "types" else f"tool:{own_key}:{tool}"
                ensure_node(tkey, {"kind": "tool", "label": tool, "agent_type": "tool", "project": None})
                nodes[tkey]["tool_calls"] += 1
                edge = edges.setdefault((own_key, tkey), {"source": own_key, "target": tkey, "launches": 0})
                edge["launches"] += 1

    # Subtree totals: an agent's own usage plus everything it launched (instance tree in session mode;
    # in types mode the type graph can have cycles, so totals there are per-edge, not recursive).
    children = defaultdict(list)
    for (src, dst), e in edges.items():
        if not dst.startswith("tool:"):
            children[src].append(dst)

    def subtree(key: str, seen: frozenset) -> tuple[int, float]:
        tok, cost = nodes[key]["self_tokens"], nodes[key]["self_cost"]
        for child in children[key]:
            if child not in seen:
                ct, cc = subtree(child, seen | {child})
                tok, cost = tok + ct, cost + cc
        return tok, cost

    for key, e in edges.items():
        launched = edge_instances.get(key, [])
        e["tokens"] = sum(instance_usage[i][0] for i in launched)
        e["cost"] = round(sum(instance_usage[i][1] for i in launched), 6)

    out_nodes = []
    for key, n in nodes.items():
        total_tokens, total_cost = subtree(key, frozenset({key})) if mode == "session" else (n["self_tokens"], n["self_cost"])
        out_nodes.append({
            **{k: v for k, v in n.items() if k not in ("instances", "sessions", "models")},
            "self_cost": round(n["self_cost"], 6),
            "total_tokens": total_tokens,
            "total_cost": round(total_cost, 6),
            "instances": len(n["instances"]) if n["kind"] != "tool" else 0,
            "sessions": len(n["sessions"]),
            "models": sorted(n["models"]),
        })

    llm = [s for s in spans if s["span_type"] == LLM_SPAN_TYPE]
    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "mode": mode,
            "traces": len(roots),
            "sessions": len({r["session_id"] for r in roots.values()}),
            "llm_calls": len(llm),
            "total_tokens": sum(int(s["total_tokens"]) for s in llm),
            "total_cost": round(sum(float(s["total_cost"]) for s in llm), 6),
        },
        "nodes": sorted(out_nodes, key=lambda n: -n["self_tokens"]),
        "edges": list(edges.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mode", choices=["session", "types"], default="types",
                        help="session: one node per subagent instance; types: one node per subagent type")
    parser.add_argument("--session", help="session id or prefix")
    parser.add_argument("--project", help="substring of the session's working directory")
    parser.add_argument("--since", help="only turns started at/after this date (e.g. 2026-11-20)")
    parser.add_argument("--tools", action="store_true", help="add tool nodes (Bash, Edit, MCP...)")
    parser.add_argument("--out", default=str(HERE / "out" / "graph.json"), help="graph JSON path")
    parser.add_argument("--html", default=str(HERE / "out" / "agent-graph.html"),
                        help="self-contained viewer path ('' to skip)")
    args = parser.parse_args()

    env = {**load_env(REPO_ROOT / ".env"), **os.environ}
    url = env.get("CLICKHOUSE_HTTP_URL", "http://localhost:8123")
    spans = fetch_spans(args, url, env.get("CLICKHOUSE_USER", "default"), env.get("CLICKHOUSE_PASSWORD", ""),
                        env.get("CLICKHOUSE_CONTAINER", "clickhouse"))
    if not spans:
        print("no Claude Code traces match the filters", file=sys.stderr)
        return 1
    graph = build_graph(spans, args.mode, args.tools)
    graph["meta"]["filters"] = {k: getattr(args, k) for k in ("session", "project", "since", "tools")}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(graph, indent=2, ensure_ascii=False))
    if args.html:
        template = (HERE / "index.html").read_text()
        # Inline the data so the viewer opens from file:// (fetch() of a local file is blocked).
        data = json.dumps(graph, ensure_ascii=False).replace("</", "<\\/")
        Path(args.html).write_text(template.replace("/*__GRAPH_DATA__*/null", data))

    m = graph["meta"]
    print(f"{len(graph['nodes'])} nodes, {len(graph['edges'])} edges · {m['sessions']} sessions, {m['traces']} turns, "
          f"{m['llm_calls']} LLM calls, {m['total_tokens']:,} tokens, ${m['total_cost']:.2f}")
    print(f"wrote {out}" + (f" and {args.html}" if args.html else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
