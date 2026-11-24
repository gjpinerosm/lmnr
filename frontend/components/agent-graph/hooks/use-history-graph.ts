import { useEffect, useState } from "react";

import { type HistoryGraph } from "@/lib/agent-graph/types";
import { fetchApi } from "@/lib/api/fetch-api";
import { useToast } from "@/lib/hooks/use-toast";

interface Range {
  pastHours: string | null;
  startDate: string | null;
  endDate: string | null;
}

const rangeQuery = ({ pastHours, startDate, endDate }: Range): string | null => {
  if (pastHours) return new URLSearchParams({ pastHours }).toString();
  if (startDate && endDate) return new URLSearchParams({ startDate, endDate }).toString();
  return null;
};

export function useHistoryGraph(projectId: string, range: Range) {
  const { toast } = useToast();
  const query = rangeQuery(range);
  const key = query && `${projectId}?${query}`;
  // Loading is derived: the last settled request is for a different key than the current one.
  const [settled, setSettled] = useState<{ key: string | null; data: HistoryGraph | null }>({ key: null, data: null });

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetchApi<HistoryGraph>(`/api/projects/${key.replace("?", "/agent-graph/history?")}`, { signal: controller.signal })
      .then(({ data, error }) => {
        if (error) toast({ title: "Could not load the agent graph", description: error, variant: "destructive" });
        setSettled((prev) => ({ key, data: data ?? prev.data }));
      })
      .catch(() => {}); // aborted by a newer range
    return () => controller.abort();
  }, [key, toast]);

  return { data: settled.data, loading: settled.key !== key };
}
