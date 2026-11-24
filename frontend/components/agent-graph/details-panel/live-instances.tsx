import Link from "next/link";

import { STATE_STYLES } from "@/components/agent-graph/constants";
import { useNow } from "@/components/agent-graph/hooks/use-now";
import { formatElapsed } from "@/lib/agent-graph/format";
import { type LiveAgent } from "@/lib/agent-graph/types";
import { cn } from "@/lib/utils";

interface Props {
  agents: LiveAgent[];
  liveProjectId: string | null;
}

export default function LiveInstances({ agents, liveProjectId }: Props) {
  const now = useNow(1000, agents.length > 0);
  if (agents.length === 0) return <p className="text-xs text-muted-foreground">Nothing running now.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {agents.map((a) => {
        const style = STATE_STYLES[a.state];
        return (
          <li key={a.key} className="rounded-md border p-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full motion-safe:animate-pulse", style.dot)} />
              <span className="font-medium">{style.label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {formatElapsed(a.toolSince ?? a.since, now)}
              </span>
            </div>
            {a.tool && <div className="mt-1 text-secondary-foreground">▶ {a.tool}</div>}
            {a.description && <div className="mt-1 truncate text-muted-foreground">{a.description}</div>}
            <div className="mt-1 flex items-center justify-between text-muted-foreground">
              <span>
                {a.project} · {a.sessionId.slice(0, 8)}
              </span>
              {liveProjectId && (
                <Link className="text-primary hover:underline" href={`/project/${liveProjectId}/traces/${a.traceId}`}>
                  Open trace
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
