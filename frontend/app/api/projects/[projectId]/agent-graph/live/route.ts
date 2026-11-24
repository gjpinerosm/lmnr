import { getAgentGraphLive, GetAgentGraphLiveSchema } from "@/lib/actions/agent-graph/live";
import { parseUrlParams } from "@/lib/actions/common/utils";
import { apiHandler } from "@/lib/api/api-handler";

export const GET = apiHandler<{ projectId: string }>(async (req, ctx) => {
  const { projectId } = await ctx.params;
  const params = parseUrlParams(req.nextUrl.searchParams, GetAgentGraphLiveSchema.omit({ projectId: true }));
  if (!params.success) throw params.error;
  return Response.json(await getAgentGraphLive({ ...params.data, projectId }));
});
