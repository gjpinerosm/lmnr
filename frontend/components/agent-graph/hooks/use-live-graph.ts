import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LIVE_DEBOUNCE_MS, LIVE_POLL_MS } from "@/components/agent-graph/constants";
import { type LiveGraph } from "@/lib/agent-graph/types";
import { fetchApi } from "@/lib/api/fetch-api";
import { useRealtime } from "@/lib/hooks/use-realtime";

const usePageVisible = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
};

/**
 * Live agents of `projectId`. There is no project-wide span stream, so a `trace_update`
 * on the project's "traces" SSE key triggers a debounced refetch, with polling as backup.
 */
export function useLiveGraph(projectId: string | null) {
  const visible = usePageVisible();
  const enabled = !!projectId && visible;
  const [data, setData] = useState<LiveGraph | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const res = await fetchApi<LiveGraph>(`/api/projects/${projectId}/agent-graph/live?minutes=30`, {
        signal: controller.signal,
      });
      if (res.data) setData(res.data);
    } catch {
      // superseded by a newer refresh
    }
  }, [projectId]);

  const schedule = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(refresh, LIVE_DEBOUNCE_MS);
  }, [refresh]);

  const eventHandlers = useMemo(() => ({ trace_update: schedule }), [schedule]);
  useRealtime({ key: "traces", projectId: projectId ?? "", eventHandlers, enabled });

  useEffect(() => {
    if (!enabled) return;
    schedule();
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => {
      clearInterval(id);
      if (debounce.current) clearTimeout(debounce.current);
      inFlight.current?.abort();
    };
  }, [enabled, refresh, schedule]);

  return projectId ? data : null;
}
