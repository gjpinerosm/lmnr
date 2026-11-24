import { X } from "lucide-react";

import LiveInstances from "@/components/agent-graph/details-panel/live-instances";
import ModelTable from "@/components/agent-graph/details-panel/model-table";
import { useAgentGraphStore } from "@/components/agent-graph/store";
import { Button } from "@/components/ui/button";
import { formatCost, formatTokens } from "@/lib/agent-graph/format";
import { type AgentNodeData } from "@/lib/agent-graph/overlay";
import { type HistoryGraph } from "@/lib/agent-graph/types";

interface Props {
  node: AgentNodeData;
  history: HistoryGraph | null;
  liveProjectId: string | null;
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex flex-col">
    <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
    <span className="text-sm tabular-nums">{value}</span>
  </div>
);

export default function DetailsPanel({ node, history, liveProjectId }: Props) {
  const selectNode = useAgentGraphStore((s) => s.selectNode);
  const historyNode = history?.nodes.find((n) => n.id === node.id);
  const launchedBy = history?.edges.filter((e) => e.target === node.id) ?? [];

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l p-4" aria-label={`${node.label} details`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">{node.label}</h2>
        <Button variant="ghost" size="icon" aria-label="Close details" onClick={() => selectNode(null)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Tokens" value={formatTokens(node.tokens)} />
        <Stat label="Cost" value={formatCost(node.cost)} />
        <Stat label={node.kind === "main" ? "Turns" : "Runs"} value={node.instances} />
        <Stat label="LLM calls" value={node.llmCalls} />
        <Stat label="Tool calls" value={historyNode?.toolCalls ?? 0} />
        <Stat label="Sessions" value={historyNode?.sessions ?? 0} />
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-secondary-foreground">Running now</h3>
        <LiveInstances agents={node.live} liveProjectId={liveProjectId} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-secondary-foreground">By model</h3>
        <ModelTable rows={historyNode?.byModel ?? []} />
      </section>
      {launchedBy.length > 0 && (
        <section className="flex flex-col gap-1 text-xs">
          <h3 className="font-medium text-secondary-foreground">Launched by</h3>
          {launchedBy.map((e) => (
            <div key={e.source} className="flex justify-between tabular-nums">
              <span className="truncate">{history?.nodes.find((n) => n.id === e.source)?.label ?? e.source}</span>
              <span className="text-muted-foreground">
                {e.launches}× · {formatTokens(e.tokens)}
              </span>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
