import { isBusy } from "@/lib/agent-graph/build-live";
import {
  type GraphMetric,
  type HistoryGraph,
  type HistoryNode,
  type LiveAgent,
  type LiveGraph,
  type LiveState,
} from "@/lib/agent-graph/types";

export interface AgentNodeData {
  [key: string]: unknown;
  id: string;
  kind: HistoryNode["kind"] | "new";
  label: string;
  tokens: number;
  cost: number;
  llmCalls: number;
  instances: number;
  /** Share of the selected metric over all nodes, 0..1. */
  share: number;
  metric: GraphMetric;
  live: LiveAgent[];
  /** Most urgent state among this node's running agents. */
  liveState: LiveState | null;
  highlighted: boolean;
}

export interface LaunchEdgeData {
  [key: string]: unknown;
  launches: number;
  tokens: number;
  cost: number;
  live: boolean;
  isNew: boolean;
}

export interface OverlayGraph {
  nodes: AgentNodeData[];
  edges: { id: string; source: string; target: string; data: LaunchEdgeData }[];
}

// Lower index wins when several agents of one node are running at once.
const STATE_PRIORITY: LiveState[] = [
  "error",
  "awaiting_permission",
  "awaiting_user",
  "tool_running",
  "compacting",
  "thinking",
  "background_wait",
];

const topState = (agents: LiveAgent[]): LiveState | null =>
  STATE_PRIORITY.find((s) => agents.some((a) => a.state === s)) ?? null;

export function buildOverlay(
  history: HistoryGraph | null,
  live: LiveGraph | null,
  metric: GraphMetric,
  highlightedSession: string | null = null
): OverlayGraph {
  const value = (n: { selfTokens: number; cost: number }) => (metric === "tokens" ? n.selfTokens : n.cost);
  const total = history?.nodes.reduce((acc, n) => acc + value(n), 0) ?? 0;
  const busy = (live?.agents ?? []).filter((a) => isBusy(a.state));

  const nodes = new Map<string, AgentNodeData>();
  for (const n of history?.nodes ?? []) {
    nodes.set(n.id, {
      id: n.id,
      kind: n.kind,
      label: n.label,
      tokens: n.selfTokens,
      cost: n.cost,
      llmCalls: n.llmCalls,
      instances: n.instances,
      share: total > 0 ? value(n) / total : 0,
      metric,
      live: [],
      liveState: null,
      highlighted: false,
    });
  }
  for (const a of busy) {
    const node =
      nodes.get(a.nodeId) ??
      ({
        id: a.nodeId,
        kind: "new",
        label: a.agentId ? a.agentType : `Main · ${a.project}`,
        tokens: 0,
        cost: 0,
        llmCalls: 0,
        instances: 0,
        share: 0,
        metric,
        live: [],
        liveState: null,
        highlighted: false,
      } satisfies AgentNodeData);
    node.live.push(a);
    node.highlighted ||= a.sessionId === highlightedSession;
    nodes.set(a.nodeId, node);
  }
  for (const n of nodes.values()) n.liveState = topState(n.live);

  const edges = new Map<string, OverlayGraph["edges"][number]>();
  for (const e of history?.edges ?? []) {
    const id = `${e.source}→${e.target}`;
    edges.set(id, { id, source: e.source, target: e.target, data: { ...e, live: false, isNew: false } });
  }
  const byKey = new Map((live?.agents ?? []).map((a) => [a.key, a]));
  for (const a of busy) {
    if (!a.agentId) continue;
    const parent = a.parentAgentId ? byKey.get(`${a.sessionId}:${a.parentAgentId}`) : undefined;
    const source = parent?.nodeId ?? `main:${a.project || "unknown"}`;
    if (!nodes.has(source)) continue;
    const id = `${source}→${a.nodeId}`;
    const edge = edges.get(id) ?? {
      id,
      source,
      target: a.nodeId,
      data: { launches: 0, tokens: 0, cost: 0, live: false, isNew: true },
    };
    edge.data.live = true;
    edges.set(id, edge);
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
