import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";

import { formatTokens } from "@/lib/agent-graph/format";
import { type LaunchEdgeData } from "@/lib/agent-graph/overlay";
import { cn } from "@/lib/utils";

type LaunchFlowEdge = Edge<LaunchEdgeData, "launch">;

function LaunchEdge(props: EdgeProps<LaunchFlowEdge>) {
  const { data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const launches = data?.launches ?? 0;
  const width = Math.min(6, 1 + Math.log2(1 + launches));
  const live = data?.live ?? false;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        className={cn(live ? "!stroke-primary" : "!stroke-muted-foreground/50")}
        style={{ strokeWidth: width, strokeDasharray: data?.isNew ? "6 4" : undefined }}
      />
      {launches > 0 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded bg-background px-1 text-[10px] text-muted-foreground tabular-nums"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {launches}× · {formatTokens(data?.tokens ?? 0)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(LaunchEdge);
