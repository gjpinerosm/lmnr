"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  ReactFlow,
} from "@xyflow/react";
import { useMemo } from "react";

import AgentNode from "@/components/agent-graph/canvas/agent-node";
import LaunchEdge from "@/components/agent-graph/canvas/launch-edge";
import { useAgentGraphStore } from "@/components/agent-graph/store";
import { layoutKey, layoutPositions } from "@/lib/agent-graph/layout";
import { type AgentNodeData, type LaunchEdgeData, type OverlayGraph } from "@/lib/agent-graph/overlay";

const nodeTypes = { agent: AgentNode };
const edgeTypes = { launch: LaunchEdge };

export default function GraphCanvas({ graph }: { graph: OverlayGraph }) {
  const selectedNodeId = useAgentGraphStore((s) => s.selectedNodeId);
  const selectNode = useAgentGraphStore((s) => s.selectNode);

  const ids = useMemo(() => graph.nodes.map((n) => n.id), [graph.nodes]);
  const key = layoutKey(ids, graph.edges);
  // Re-layout only when the node/edge set changes, so live updates never move nodes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(() => layoutPositions(ids, graph.edges), [key]);

  const nodes: Node<AgentNodeData, "agent">[] = graph.nodes.map((n) => ({
    id: n.id,
    type: "agent",
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    data: n,
    selected: n.id === selectedNodeId,
  }));
  const edges: Edge<LaunchEdgeData, "launch">[] = graph.edges.map((e) => ({
    ...e,
    type: "launch",
    animated: e.data.live,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
  }));

  return (
    <ReactFlow
      key={key}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => selectNode(node.id)}
      onPaneClick={() => selectNode(null)}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className="!bg-muted" maskColor="rgb(0 0 0 / 0.15)" />
    </ReactFlow>
  );
}
