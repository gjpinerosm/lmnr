import { z } from "zod/v4";

import { executeQuery } from "@/lib/actions/sql";
import { buildLiveGraph } from "@/lib/agent-graph/build-live";
import { type LiveGraph, type LiveSpanRow } from "@/lib/agent-graph/types";

export const GetAgentGraphLiveSchema = z.object({
  projectId: z.guid(),
  minutes: z.coerce.number().int().min(1).max(240).default(30),
});

const attr = (key: string) => `JSONExtractString(attributes, '${key}')`;

export async function getAgentGraphLive(input: z.infer<typeof GetAgentGraphLiveSchema>): Promise<LiveGraph> {
  // Spans written by tools/claude-code-live; completed tool spans carry the id as claude_code.tool.id.
  const query = `
    SELECT span_id, trace_id, name, span_type, start_time, end_time, status,
      ${attr("claude_code.session_id")} AS session_id,
      ${attr("claude_code.agent_id")} AS agent_id,
      ${attr("claude_code.agent_type")} AS agent_type,
      ${attr("claude_code.parent_agent_id")} AS parent_agent_id,
      ${attr("claude_code.agent_description")} AS agent_description,
      if(${attr("claude_code.tool_use_id")} != '', ${attr("claude_code.tool_use_id")},
         ${attr("claude_code.tool.id")}) AS tool_use_id,
      ${attr("claude_code.tool.name")} AS tool_name,
      ${attr("claude_code.project")} AS project,
      ${attr("live.state")} AS live_state,
      JSONExtractRaw(attributes, 'live.marker') AS live_marker
    FROM spans
    WHERE start_time >= now() - INTERVAL {minutes:UInt32} MINUTE
    -- A tool's marker and its span share a start time; the marker happened first.
    ORDER BY start_time, live_marker DESC
    LIMIT 20000
  `;
  const rows = await executeQuery<LiveSpanRow>({
    projectId: input.projectId,
    query,
    parameters: { minutes: input.minutes },
  });
  return buildLiveGraph(rows, Date.now());
}
