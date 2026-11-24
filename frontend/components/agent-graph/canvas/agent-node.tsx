import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

import { STATE_STYLES } from "@/components/agent-graph/constants";
import { useNow } from "@/components/agent-graph/hooks/use-now";
import { formatCost, formatElapsed, formatTokens } from "@/lib/agent-graph/format";
import { AGENT_NODE_SIZE } from "@/lib/agent-graph/layout";
import { type AgentNodeData } from "@/lib/agent-graph/overlay";
import { cn } from "@/lib/utils";

type AgentFlowNode = Node<AgentNodeData, "agent">;

function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const now = useNow(1000, data.live.length > 0);
  const state = data.liveState ? STATE_STYLES[data.liveState] : null;
  const runningTool = data.live.find((a) => a.tool);
  const metricText =
    data.metric === "tokens"
      ? `${formatTokens(data.tokens)} tok · ${formatCost(data.cost)}`
      : `${formatCost(data.cost)} · ${formatTokens(data.tokens)} tok`;

  return (
    <div
      role="button"
      aria-label={`${data.label}: ${metricText}${state ? `, ${state.label}` : ""}`}
      style={{ width: AGENT_NODE_SIZE.width, height: AGENT_NODE_SIZE.height }}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-sm transition-shadow",
        state && "ring-2",
        state?.ring,
        data.kind === "new" && "border-dashed",
        selected && "border-primary",
        data.highlighted && "shadow-lg"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/40 !border-0" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            state ? state.dot : "bg-muted-foreground/30",
            state && "motion-safe:animate-pulse"
          )}
        />
        <span className="truncate font-medium text-foreground">{data.label}</span>
        {data.live.length > 0 && (
          <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] text-secondary-foreground">
            {data.live.length} live
          </span>
        )}
      </div>
      <div className="text-secondary-foreground tabular-nums">
        {data.kind === "new" ? "Not in this range" : metricText}
      </div>
      <div className="flex items-center gap-1.5" title={`${(data.share * 100).toFixed(1)}% of total`}>
        <div className="h-1 flex-1 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary/70" style={{ width: `${Math.max(data.share * 100, 1)}%` }} />
        </div>
        <span className="w-10 text-right text-[10px] text-muted-foreground tabular-nums">
          {(data.share * 100).toFixed(1)}%
        </span>
      </div>
      <div className="truncate text-[11px] text-muted-foreground tabular-nums">
        {runningTool
          ? `▶ ${runningTool.tool} · ${formatElapsed(runningTool.toolSince, now)}`
          : state
            ? state.label
            : `${data.instances} ${data.kind === "main" ? "turns" : "runs"} · ${data.llmCalls} LLM calls`}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/40 !border-0" />
    </div>
  );
}

export default memo(AgentNode);
