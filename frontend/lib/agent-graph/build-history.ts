import {
  type HistoryEdge,
  type HistoryGraph,
  type HistoryNode,
  type HistorySpanRow,
  type ModelUsage,
} from "@/lib/agent-graph/types";

// Names the lmnr Claude Code plugin gives its spans; tools/agent-graph/extract.py
// is the reference implementation this mirrors (its `types` view).
export const ROOT_PREFIX = "Claude Code - Turn";
export const SUBAGENT_PREFIX = "Subagent:";

const isLlm = (s: HistorySpanRow) => s.span_type === "LLM" || s.span_type === "1";
const isTool = (s: HistorySpanRow) => s.span_type === "TOOL" || s.span_type === "6";
const isRoot = (s: HistorySpanRow) => s.name.startsWith(ROOT_PREFIX);
const isSubagent = (s: HistorySpanRow) => s.name.startsWith(SUBAGENT_PREFIX);

export const projectName = (cwd: string) => cwd.replace(/\/+$/, "").split("/").pop() || "unknown";
export const mainNodeId = (project: string) => `main:${project}`;
export const subagentNodeId = (agentType: string) => `type:${agentType || "unknown"}`;

interface NodeAcc extends Omit<HistoryNode, "byModel" | "instances" | "sessions"> {
  instanceIds: Set<string>;
  sessionIds: Set<string>;
  models: Map<string, ModelUsage>;
}

export function buildHistoryGraph(spans: HistorySpanRow[]): HistoryGraph {
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const roots = new Map<string, HistorySpanRow>();
  for (const s of spans) if (isRoot(s)) roots.set(s.trace_id, s);

  // Nearest Subagent/root ancestor (excluding the span itself), else the turn root.
  const owner = (s: HistorySpanRow): HistorySpanRow | undefined => {
    let cur = byId.get(s.parent_span_id);
    while (cur) {
      if (isSubagent(cur) || isRoot(cur)) return cur;
      cur = byId.get(cur.parent_span_id);
    }
    return roots.get(s.trace_id);
  };

  const nodes = new Map<string, NodeAcc>();
  const spanNode = new Map<string, string>();
  for (const s of spans) {
    if (!isRoot(s) && !isSubagent(s)) continue;
    const root = roots.get(s.trace_id);
    if (!root) continue; // turn root outside the range: drop the orphan
    const project = projectName(root.cwd);
    const id = isRoot(s) ? mainNodeId(project) : subagentNodeId(s.subagent_type);
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        kind: isRoot(s) ? "main" : "subagent",
        label: isRoot(s) ? `Main · ${project}` : s.subagent_type || "unknown",
        project: isRoot(s) ? project : undefined,
        selfTokens: 0,
        cost: 0,
        llmCalls: 0,
        toolCalls: 0,
        instanceIds: new Set(),
        sessionIds: new Set(),
        models: new Map(),
      };
      nodes.set(id, node);
    }
    node.instanceIds.add(s.span_id);
    node.sessionIds.add(root.session_id);
    spanNode.set(s.span_id, id);
  }

  const edges = new Map<string, HistoryEdge>();
  const launched = new Map<string, string[]>(); // edge key -> launched subagent span ids
  const instanceUsage = new Map<string, { tokens: number; cost: number }>();

  for (const s of spans) {
    if (isRoot(s)) continue;
    const own = owner(s);
    const ownKey = own && spanNode.get(own.span_id);
    if (!own || !ownKey) continue;
    const node = nodes.get(ownKey)!;
    if (isSubagent(s)) {
      const target = spanNode.get(s.span_id);
      if (!target) continue;
      const key = `${ownKey}→${target}`;
      const edge = edges.get(key) ?? { source: ownKey, target, launches: 0, tokens: 0, cost: 0 };
      edge.launches += 1;
      edges.set(key, edge);
      launched.set(key, [...(launched.get(key) ?? []), s.span_id]);
    } else if (isLlm(s)) {
      const tokens = Number(s.total_tokens) || 0;
      const cost = Number(s.total_cost) || 0;
      const usage = instanceUsage.get(own.span_id) ?? { tokens: 0, cost: 0 };
      usage.tokens += tokens;
      usage.cost += cost;
      instanceUsage.set(own.span_id, usage);
      node.selfTokens += tokens;
      node.cost += cost;
      node.llmCalls += 1;
      const model = s.model || "unknown";
      const m = node.models.get(model) ?? { model, tokens: 0, cost: 0, llmCalls: 0 };
      m.tokens += tokens;
      m.cost += cost;
      m.llmCalls += 1;
      node.models.set(model, m);
    } else if (isTool(s)) {
      node.toolCalls += 1;
    }
  }

  for (const [key, edge] of edges) {
    for (const id of launched.get(key) ?? []) {
      edge.tokens += instanceUsage.get(id)?.tokens ?? 0;
      edge.cost += instanceUsage.get(id)?.cost ?? 0;
    }
  }

  const llm = spans.filter((s) => isLlm(s) && roots.has(s.trace_id));
  const starts = [...roots.values()].map((r) => r.start_time).sort();
  return {
    nodes: [...nodes.values()]
      .map(({ instanceIds, sessionIds, models, ...n }) => ({
        ...n,
        instances: instanceIds.size,
        sessions: sessionIds.size,
        byModel: [...models.values()].sort((a, b) => b.tokens - a.tokens),
      }))
      .sort((a, b) => b.selfTokens - a.selfTokens),
    edges: [...edges.values()],
    totals: {
      turns: roots.size,
      sessions: new Set([...roots.values()].map((r) => r.session_id)).size,
      llmCalls: llm.length,
      tokens: llm.reduce((acc, s) => acc + (Number(s.total_tokens) || 0), 0),
      cost: llm.reduce((acc, s) => acc + (Number(s.total_cost) || 0), 0),
    },
    firstTurn: starts[0] ?? null,
    lastTurn: starts.at(-1) ?? null,
  };
}
