import dagre from "dagre";

export const AGENT_NODE_SIZE = { width: 232, height: 104 } as const;

/**
 * Left-to-right dagre positions keyed by node id. Callers memoize on the sorted id
 * list, so live updates that only change node data keep the graph still.
 */
export function layoutPositions(
  nodeIds: string[],
  edges: { source: string; target: string }[]
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 90, nodesep: 40, marginx: 20, marginy: 20 });
  for (const id of nodeIds) g.setNode(id, { ...AGENT_NODE_SIZE });
  const ids = new Set(nodeIds);
  for (const e of edges) {
    // A type that launches itself (general-purpose → general-purpose) is drawn but not laid out.
    if (e.source !== e.target && ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const id of nodeIds) {
    const n = g.node(id);
    out.set(id, { x: n.x - AGENT_NODE_SIZE.width / 2, y: n.y - AGENT_NODE_SIZE.height / 2 });
  }
  return out;
}

/** Stable key for memoizing a layout: the node set and the edge set, order-independent. */
export const layoutKey = (nodeIds: string[], edges: { source: string; target: string }[]) =>
  [...nodeIds].sort().join("|") +
  "#" +
  edges
    .map((e) => `${e.source}>${e.target}`)
    .sort()
    .join("|");
