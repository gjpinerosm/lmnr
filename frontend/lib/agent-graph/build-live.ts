import { mainNodeId, subagentNodeId } from "@/lib/agent-graph/build-history";
import {
  type LiveAgent,
  type LiveGraph,
  type LiveSession,
  type LiveSpanRow,
  type LiveState,
} from "@/lib/agent-graph/types";

// Span names the claude-code-live daemon emits (tools/claude-code-live/claude_live.py).
const LIVE_ROOT_PREFIX = "Claude Code - Live";
const SUBAGENT_PREFIX = "Subagent:";
const TOOL_MARKER_PREFIX = "▶ ";
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

/** ClickHouse DateTime64 text ("2026-11-24 15:30:06.638717000", UTC) to epoch ms. */
export const chTimeToMs = (t: string): number => {
  if (!t) return 0;
  const [date, time = "00:00:00"] = t.replace("Z", "").split(/[ T]/);
  const [hms, frac = "0"] = time.split(".");
  return Date.parse(`${date}T${hms}.${frac.padEnd(3, "0").slice(0, 3)}Z`);
};

const iso = (ms: number) => new Date(ms).toISOString();

interface AgentAcc extends Omit<LiveAgent, "since" | "toolSince"> {
  sinceMs: number;
  lastMs: number;
  finished: boolean;
}

export function buildLiveGraph(rows: LiveSpanRow[], nowMs: number): LiveGraph {
  const sorted = [...rows].sort((a, b) => chTimeToMs(a.start_time) - chTimeToMs(b.start_time));
  const agents = new Map<string, AgentAcc>();
  const sessions = new Map<string, { project: string; lastMs: number; traceId: string }>();
  const openTools = new Map<string, { agentKey: string; tool: string; sinceMs: number }>();
  const closedTools = new Set<string>();
  const rootClosedAt = new Map<string, number>(); // session -> end of its latest closed turn

  for (const r of sorted) {
    if (!r.session_id) continue;
    const startMs = chTimeToMs(r.start_time);
    const endMs = Math.max(chTimeToMs(r.end_time), startMs);
    const session = sessions.get(r.session_id) ?? { project: r.project, lastMs: 0, traceId: r.trace_id };
    if (endMs >= session.lastMs) {
      session.lastMs = endMs;
      session.traceId = r.trace_id;
    }
    session.project = session.project || r.project;
    sessions.set(r.session_id, session);

    if (r.name.startsWith(LIVE_ROOT_PREFIX)) {
      rootClosedAt.set(r.session_id, Math.max(rootClosedAt.get(r.session_id) ?? 0, endMs));
      continue;
    }

    const agentId = r.agent_id || "";
    const key = `${r.session_id}:${agentId}`;
    const agentType = agentId ? r.agent_type || "unknown" : "main";
    const agent: AgentAcc = agents.get(key) ?? {
      key,
      sessionId: r.session_id,
      agentId,
      parentAgentId: agentId ? r.parent_agent_id || "" : null,
      agentType,
      nodeId: agentId ? subagentNodeId(agentType) : mainNodeId(r.project || "unknown"),
      project: r.project,
      description: r.agent_description || undefined,
      state: "thinking",
      sinceMs: startMs,
      lastMs: startMs,
      traceId: r.trace_id,
      finished: false,
    };
    agent.lastMs = Math.max(agent.lastMs, endMs);
    agent.traceId = r.trace_id;
    agent.description ||= r.agent_description || undefined;

    if (r.live_marker === "true") {
      // A tool span and its marker share a start time, so the closed span can sort first.
      const markerOfClosedTool = !!r.tool_use_id && closedTools.has(r.tool_use_id);
      if (r.live_state && !markerOfClosedTool) {
        agent.state = r.live_state as LiveState;
        agent.sinceMs = startMs;
      }
      if (r.name.startsWith(TOOL_MARKER_PREFIX) && r.tool_use_id && !closedTools.has(r.tool_use_id)) {
        openTools.set(r.tool_use_id, { agentKey: key, tool: r.tool_name, sinceMs: startMs });
      }
    } else if (r.name.startsWith(SUBAGENT_PREFIX) && agentId) {
      agent.finished = true;
    } else if (r.tool_use_id) {
      closedTools.add(r.tool_use_id);
      openTools.delete(r.tool_use_id);
      if (agent.state === "tool_running") {
        agent.state = r.status === "error" ? "error" : "thinking";
        agent.sinceMs = endMs;
      }
    }
    agents.set(key, agent);
  }

  const runningTool = new Map<string, { tool: string; sinceMs: number }>();
  for (const t of openTools.values()) {
    const cur = runningTool.get(t.agentKey);
    if (!cur || t.sinceMs > cur.sinceMs) runningTool.set(t.agentKey, { tool: t.tool, sinceMs: t.sinceMs });
  }

  const outAgents: LiveAgent[] = [...agents.values()].map(({ sinceMs, lastMs, finished, ...a }) => {
    // A quiet agent is idle even with a tool still open: its end event may have been lost.
    const stale = nowMs - lastMs > ACTIVE_WINDOW_MS;
    const tool = stale || finished ? undefined : runningTool.get(a.key);
    let state: LiveState = a.state;
    if (finished) state = "done";
    else if (stale) state = "idle";
    else if (tool) state = "tool_running";
    else if (!a.agentId && (rootClosedAt.get(a.sessionId) ?? 0) >= lastMs) state = "idle";
    return {
      ...a,
      state,
      since: iso(tool ? tool.sinceMs : sinceMs),
      ...(tool ? { tool: tool.tool, toolSince: iso(tool.sinceMs) } : {}),
    };
  });

  const outSessions: LiveSession[] = [...sessions.entries()]
    .map(([sessionId, s]) => ({
      sessionId,
      project: s.project,
      lastEvent: iso(s.lastMs),
      active: nowMs - s.lastMs <= ACTIVE_WINDOW_MS,
      traceId: s.traceId,
    }))
    .sort((a, b) => b.lastEvent.localeCompare(a.lastEvent));

  return { sessions: outSessions, agents: outAgents, now: iso(nowMs) };
}

/** States in which an agent counts as running for the live layer. */
export const isBusy = (state: LiveState) => !["done", "idle", "ended"].includes(state);
