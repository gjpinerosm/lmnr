"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import ActiveSessions from "@/components/agent-graph/active-sessions";
import GraphCanvas from "@/components/agent-graph/canvas";
import { DEFAULT_PAST_HOURS, LIVE_PROJECT_NAME } from "@/components/agent-graph/constants";
import Controls from "@/components/agent-graph/controls";
import DetailsPanel from "@/components/agent-graph/details-panel";
import { useGraphParams } from "@/components/agent-graph/hooks/use-graph-params";
import { useHistoryGraph } from "@/components/agent-graph/hooks/use-history-graph";
import { useLiveGraph } from "@/components/agent-graph/hooks/use-live-graph";
import Legend from "@/components/agent-graph/legend";
import { useAgentGraphStore } from "@/components/agent-graph/store";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useProjectContext } from "@/contexts/project-context";
import { buildOverlay } from "@/lib/agent-graph/overlay";

export default function AgentGraph() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects } = useProjectContext();
  const [params, setParams] = useGraphParams();
  const { pastHours, startDate, endDate, metric, live } = params;

  useEffect(() => {
    if (!pastHours && !(startDate && endDate)) setParams({ pastHours: DEFAULT_PAST_HOURS });
  }, [pastHours, startDate, endDate, setParams]);

  const liveProjectId = params.liveProject ?? projects.find((p) => p.name === LIVE_PROJECT_NAME)?.id ?? null;
  const history = useHistoryGraph(projectId, { pastHours, startDate, endDate });
  const liveGraph = useLiveGraph(live ? liveProjectId : null);
  const highlighted = useAgentGraphStore((s) => s.highlightedSession);
  const selectedNodeId = useAgentGraphStore((s) => s.selectedNodeId);

  const graph = useMemo(
    () => buildOverlay(history.data, live ? liveGraph : null, metric, highlighted),
    [history.data, liveGraph, live, metric, highlighted]
  );
  const selected = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Controls history={history.data} liveProjectId={liveProjectId} />
      {live && !liveProjectId && (
        <div className="px-4 pb-2 text-xs text-muted-foreground">
          No “{LIVE_PROJECT_NAME}” project in this workspace. Set up tools/claude-code-live (see its README) or pick a
          live project.
        </div>
      )}
      {live && liveProjectId && <ActiveSessions live={liveGraph} />}
      <ResizablePanelGroup id="agent-graph-panels" orientation="horizontal" className="min-h-0 flex-1 border-t">
        <ResizablePanel className="relative">
          {graph.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {history.loading ? "Loading agent graph…" : "No Claude Code turns in this range."}
            </div>
          ) : (
            <GraphCanvas graph={graph} />
          )}
          <Legend />
        </ResizablePanel>
        {selected && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize="30%" minSize="20%">
              <DetailsPanel node={selected} history={history.data} liveProjectId={liveProjectId} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
