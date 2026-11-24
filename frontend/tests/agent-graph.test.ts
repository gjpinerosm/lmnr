import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHistoryGraph } from "@/lib/agent-graph/build-history";
import { buildLiveGraph, chTimeToMs } from "@/lib/agent-graph/build-live";
import { layoutKey, layoutPositions } from "@/lib/agent-graph/layout";
import { buildOverlay } from "@/lib/agent-graph/overlay";
import { type HistorySpanRow, type LiveSpanRow } from "@/lib/agent-graph/types";

const ZERO = "00000000-0000-0000-0000-000000000000";

/** A span row as the history query returns it; spans of one turn share trace "t1" unless overridden. */
const hs = (span_id: string, parent: string, name: string, extra: Partial<HistorySpanRow> = {}): HistorySpanRow => ({
  span_id,
  parent_span_id: parent,
  trace_id: "t1",
  name,
  span_type: "DEFAULT",
  model: "",
  total_tokens: 0,
  total_cost: 0,
  start_time: "2026-11-22 10:00:00.000000000",
  subagent_type: "",
  cwd: "",
  session_id: "",
  ...extra,
});
const llm = (id: string, parent: string, tokens: number, cost: number, model = "opus") =>
  hs(id, parent, "LLM Call", { span_type: "LLM", total_tokens: tokens, total_cost: cost, model });

// Turn → LLM, Agent tool → Subagent Plan → LLM ×2, Agent → Subagent Explore → LLM; plus an orphan trace.
const HISTORY: HistorySpanRow[] = [
  hs("root", ZERO, "Claude Code - Turn 1 (abc)", { cwd: "/Users/x/lmnr", session_id: "s1" }),
  llm("l1", "root", 100, 1),
  hs("tool-a", "root", "Agent", { span_type: "TOOL" }),
  hs("sub-plan", "tool-a", "Subagent: plan it", { subagent_type: "Plan" }),
  llm("l2", "sub-plan", 40, 0.4),
  llm("l3", "sub-plan", 10, 0.1, "haiku"),
  hs("tool-b", "sub-plan", "Agent", { span_type: "TOOL" }),
  hs("sub-exp", "tool-b", "Subagent: dig", { subagent_type: "Explore" }),
  llm("l4", "sub-exp", 7, 0.07),
  hs("tool-c", "sub-exp", "Read", { span_type: "TOOL" }),
  llm("orphan", "missing-root", 999, 9, "opus"),
].map((s) => (s.span_id === "orphan" ? { ...s, trace_id: "t2" } : s));

describe("buildHistoryGraph", () => {
  const g = buildHistoryGraph(HISTORY);
  const node = (id: string) => g.nodes.find((n) => n.id === id)!;

  it("assigns LLM usage to the nearest agent and drops turns without a root", () => {
    assert.equal(node("main:lmnr").selfTokens, 100);
    assert.equal(node("type:Plan").selfTokens, 50);
    assert.equal(node("type:Explore").selfTokens, 7);
    assert.equal(g.totals.tokens, 157);
    assert.equal(g.totals.turns, 1);
  });

  it("splits each node by model and the parts add up", () => {
    for (const n of g.nodes) {
      assert.equal(
        n.byModel.reduce((acc, m) => acc + m.tokens, 0),
        n.selfTokens,
        n.id
      );
    }
    assert.deepEqual(
      node("type:Plan").byModel.map((m) => [m.model, m.tokens]),
      [
        ["opus", 40],
        ["haiku", 10],
      ]
    );
  });

  it("links launcher to launched agent with the launched instances' own usage", () => {
    const edge = (s: string, t: string) => g.edges.find((e) => e.source === s && e.target === t)!;
    assert.deepEqual(
      { launches: edge("main:lmnr", "type:Plan").launches, tokens: edge("main:lmnr", "type:Plan").tokens },
      { launches: 1, tokens: 50 }
    );
    assert.equal(edge("type:Plan", "type:Explore").tokens, 7);
    assert.equal(node("type:Explore").toolCalls, 1);
  });
});

/** A live span row as emitted by tools/claude-code-live; `t` is seconds after 12:00:00. */
const ls = (t: number, name: string, extra: Partial<LiveSpanRow> = {}): LiveSpanRow => {
  const at = `2026-11-24 12:00:${String(t).padStart(2, "0")}.000000000`;
  return {
    span_id: `${name}-${t}`,
    trace_id: "lt1",
    name,
    span_type: "DEFAULT",
    start_time: at,
    end_time: at,
    status: "",
    session_id: "s1",
    agent_id: "",
    agent_type: "",
    parent_agent_id: "",
    agent_description: "",
    tool_use_id: "",
    tool_name: "",
    project: "lmnr",
    live_state: "",
    live_marker: "false",
    ...extra,
  };
};
const marker = (t: number, name: string, state: string, extra: Partial<LiveSpanRow> = {}) =>
  ls(t, name, { live_marker: "true", live_state: state, ...extra });
const SUB = { agent_id: "a1", agent_type: "Explore", parent_agent_id: "", agent_description: "dig" };

const LIVE: LiveSpanRow[] = [
  marker(0, "▶ Prompt", "thinking"),
  marker(1, "▶ Agent", "tool_running", { tool_use_id: "u1", tool_name: "Agent" }),
  ls(2, "Agent", { span_type: "TOOL", tool_use_id: "u1" }),
  marker(2, "▶ Subagent start", "thinking", SUB),
  marker(3, "▶ Bash", "tool_running", { ...SUB, tool_use_id: "u2", tool_name: "Bash" }),
  marker(4, "▶ Read", "tool_running", { tool_use_id: "u3", tool_name: "Read" }),
];
const NOW = chTimeToMs("2026-11-24 12:00:10.000000000");

describe("buildLiveGraph", () => {
  it("reports the running tool of each agent and hangs the subagent off its launcher", () => {
    const g = buildLiveGraph(LIVE, NOW);
    const main = g.agents.find((a) => a.agentId === "")!;
    const sub = g.agents.find((a) => a.agentId === "a1")!;
    assert.deepEqual([main.state, main.tool, main.nodeId], ["tool_running", "Read", "main:lmnr"]);
    assert.deepEqual(
      [sub.state, sub.tool, sub.nodeId, sub.parentAgentId],
      ["tool_running", "Bash", "type:Explore", ""]
    );
    assert.equal(sub.toolSince, new Date(chTimeToMs("2026-11-24 12:00:03")).toISOString());
    assert.equal(g.sessions[0].active, true);
  });

  it("marks a finished subagent done and a closed turn idle", () => {
    const g = buildLiveGraph(
      [
        ...LIVE,
        ls(5, "Bash", { ...SUB, span_type: "TOOL", tool_use_id: "u2", status: "error" }),
        ls(6, "Subagent: Explore", SUB),
        ls(7, "Read", { span_type: "TOOL", tool_use_id: "u3" }),
        ls(8, "Claude Code - Live (s1)", { start_time: "2026-11-24 12:00:00.000000000" }),
      ],
      NOW
    );
    assert.equal(g.agents.find((a) => a.agentId === "a1")!.state, "done");
    assert.equal(g.agents.find((a) => a.agentId === "")!.state, "idle");
  });

  it("ignores a tool marker that sorts after its own finished tool span", () => {
    const g = buildLiveGraph(
      [
        marker(0, "▶ Prompt", "thinking"),
        ls(1, "Read", { span_type: "TOOL", tool_use_id: "u9" }),
        marker(1, "▶ Read", "tool_running", { tool_use_id: "u9", tool_name: "Read" }),
      ],
      NOW
    );
    const main = g.agents.find((a) => a.agentId === "")!;
    assert.deepEqual([main.state, main.tool], ["thinking", undefined]);
  });

  it("drops sessions quiet for more than ten minutes from the active set", () => {
    const g = buildLiveGraph(LIVE, NOW + 11 * 60 * 1000);
    assert.equal(g.sessions[0].active, false);
    assert.ok(g.agents.every((a) => a.state === "idle" || a.state === "done"));
  });
});

describe("buildOverlay", () => {
  const history = buildHistoryGraph(HISTORY);

  it("lights up history nodes, animates live launches and adds unseen agent types", () => {
    const live = buildLiveGraph(
      [...LIVE, marker(5, "▶ Subagent start", "thinking", { agent_id: "a2", agent_type: "Brand-new" })],
      NOW
    );
    const g = buildOverlay(history, live, "tokens");
    const main = g.nodes.find((n) => n.id === "main:lmnr")!;
    assert.equal(main.liveState, "tool_running");
    assert.equal(g.nodes.find((n) => n.id === "type:Brand-new")!.kind, "new");
    const liveEdge = g.edges.find((e) => e.source === "main:lmnr" && e.target === "type:Explore")!;
    assert.deepEqual([liveEdge.data.live, liveEdge.data.isNew], [true, true]);
    assert.equal(g.edges.find((e) => e.target === "type:Plan")!.data.live, false);
  });

  it("computes each node's share of the chosen metric", () => {
    const g = buildOverlay(history, null, "cost");
    const share = g.nodes.reduce((acc, n) => acc + n.share, 0);
    assert.ok(Math.abs(share - 1) < 1e-9);
  });
});

describe("layout", () => {
  it("is deterministic for the same node and edge set", () => {
    const ids = ["main:lmnr", "type:Plan", "type:Explore"];
    const edges = [
      { source: "main:lmnr", target: "type:Plan" },
      { source: "type:Plan", target: "type:Explore" },
      { source: "type:Plan", target: "type:Plan" },
    ];
    assert.deepEqual(
      [...layoutPositions(ids, edges)],
      [...layoutPositions([...ids].reverse(), edges)].sort((a, b) => ids.indexOf(a[0]) - ids.indexOf(b[0]))
    );
    assert.equal(layoutKey(ids, edges), layoutKey([...ids].reverse(), [...edges].reverse()));
  });
});
