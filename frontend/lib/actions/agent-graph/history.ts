import { z } from "zod/v4";

import { executeQuery } from "@/lib/actions/sql";
import { buildHistoryGraph } from "@/lib/agent-graph/build-history";
import { type HistoryGraph, type HistorySpanRow } from "@/lib/agent-graph/types";
import { ApiError } from "@/lib/api/errors";

export const GetAgentGraphHistorySchema = z.object({
  projectId: z.guid(),
  pastHours: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// The graph is built in memory from span rows; past this the range should be narrowed.
const MAX_ROWS = 50_000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const rootTimeCondition = (input: z.infer<typeof GetAgentGraphHistorySchema>) => {
  if (input.pastHours && !isNaN(parseFloat(input.pastHours))) {
    return {
      condition: "start_time >= now() - INTERVAL {pastHours:UInt32} HOUR",
      params: { pastHours: parseInt(input.pastHours) },
    };
  }
  if (input.startDate && input.endDate) {
    return {
      condition: "start_time >= {startTime:String} AND start_time < {endTime:String}",
      params: { startTime: input.startDate.replace("Z", ""), endTime: input.endDate.replace("Z", "") },
    };
  }
  return { condition: "start_time >= now() - INTERVAL 24 HOUR", params: {} };
};

export async function getAgentGraphHistory(input: z.infer<typeof GetAgentGraphHistorySchema>): Promise<HistoryGraph> {
  const { condition, params } = rootTimeCondition(input);
  // Whole turns whose root started in the range, like tools/agent-graph/extract.py.
  const query = `
    SELECT span_id, parent_span_id, trace_id, name, span_type, model, total_tokens, total_cost, start_time,
      JSONExtractString(attributes, 'claude_code.subagent.type') AS subagent_type,
      JSONExtractString(attributes, 'lmnr.association.properties.metadata.cwd') AS cwd,
      JSONExtractString(attributes, 'lmnr.association.properties.session_id') AS session_id
    FROM spans
    WHERE trace_id IN (
      SELECT trace_id FROM spans WHERE parent_span_id = '${ZERO_UUID}' AND ${condition}
    )
    LIMIT ${MAX_ROWS + 1}
  `;
  const rows = await executeQuery<HistorySpanRow>({ projectId: input.projectId, query, parameters: params });
  if (rows.length > MAX_ROWS) {
    throw new ApiError(`More than ${MAX_ROWS} spans in this range; narrow the date range.`, 400);
  }
  return buildHistoryGraph(rows);
}
