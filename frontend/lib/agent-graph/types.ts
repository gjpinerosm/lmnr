// Shapes shared by the agent-graph API routes and the page. Kept free of runtime
// imports so client components can import them without pulling server code.

export type AgentKind = "main" | "subagent";

export interface ModelUsage {
  model: string;
  tokens: number;
  cost: number;
  llmCalls: number;
}

export interface HistoryNode {
  /** `main:<project>` or `type:<subagent type>`; live agents map onto the same ids. */
  id: string;
  kind: AgentKind;
  label: string;
  project?: string;
  selfTokens: number;
  cost: number;
  llmCalls: number;
  toolCalls: number;
  /** Turns for the main agent, launched instances for a subagent type. */
  instances: number;
  sessions: number;
  byModel: ModelUsage[];
}

export interface HistoryEdge {
  source: string;
  target: string;
  launches: number;
  /** Own usage of the instances this edge launched (not their descendants). */
  tokens: number;
  cost: number;
}

export interface HistoryGraph {
  nodes: HistoryNode[];
  edges: HistoryEdge[];
  totals: { turns: number; sessions: number; llmCalls: number; tokens: number; cost: number };
  firstTurn: string | null;
  lastTurn: string | null;
}

/** One row of the history query (see lib/actions/agent-graph/history.ts). */
export interface HistorySpanRow {
  span_id: string;
  parent_span_id: string;
  trace_id: string;
  name: string;
  span_type: string;
  model: string;
  total_tokens: number | string;
  total_cost: number | string;
  start_time: string;
  subagent_type: string;
  cwd: string;
  session_id: string;
}

export type LiveState =
  | "thinking"
  | "tool_running"
  | "awaiting_permission"
  | "awaiting_user"
  | "compacting"
  | "background_wait"
  | "error"
  | "idle"
  | "done"
  | "ended";

export interface LiveAgent {
  /** `<session>:<agent_id>`; agent_id is "" for the main agent. */
  key: string;
  sessionId: string;
  agentId: string;
  parentAgentId: string | null;
  agentType: string;
  /** History node this agent belongs to: `main:<project>` or `type:<agent type>`. */
  nodeId: string;
  project: string;
  description?: string;
  state: LiveState;
  /** Tool currently running and since when (ISO), if any. */
  tool?: string;
  toolSince?: string;
  since: string;
  traceId: string;
}

export interface LiveSession {
  sessionId: string;
  project: string;
  lastEvent: string;
  active: boolean;
  traceId: string;
}

export interface LiveGraph {
  sessions: LiveSession[];
  agents: LiveAgent[];
  now: string;
}

/** One row of the live query (see lib/actions/agent-graph/live.ts). */
export interface LiveSpanRow {
  span_id: string;
  trace_id: string;
  name: string;
  span_type: string;
  start_time: string;
  end_time: string;
  status: string;
  session_id: string;
  agent_id: string;
  agent_type: string;
  parent_agent_id: string;
  agent_description: string;
  tool_use_id: string;
  tool_name: string;
  project: string;
  live_state: string;
  live_marker: string;
}

export type GraphMetric = "tokens" | "cost";
