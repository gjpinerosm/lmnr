import { getAgentGraphHistory, GetAgentGraphHistorySchema } from "@/lib/actions/agent-graph/history";
import { parseUrlParams } from "@/lib/actions/common/utils";
import { apiHandler } from "@/lib/api/api-handler";

export const GET = apiHandler<{ projectId: string }>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const params = parseUrlParams(req.nextUrl.searchParams, GetAgentGraphHistorySchema.omit({ projectId: true }));
  if (!params.success) throw params.error;
  return Response.json(await getAgentGraphHistory({ ...params.data, projectId }));
});
