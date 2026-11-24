import { STATE_STYLES } from "@/components/agent-graph/constants";
import { useNow } from "@/components/agent-graph/hooks/use-now";
import { useAgentGraphStore } from "@/components/agent-graph/store";
import { formatElapsed } from "@/lib/agent-graph/format";
import { type LiveGraph } from "@/lib/agent-graph/types";
import { cn } from "@/lib/utils";

export default function ActiveSessions({ live }: { live: LiveGraph | null }) {
  const now = useNow(1000);
  const highlighted = useAgentGraphStore((s) => s.highlightedSession);
  const highlight = useAgentGraphStore((s) => s.highlightSession);
  const sessions = live?.sessions.filter((s) => s.active) ?? [];

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-2 text-xs text-muted-foreground">
        No Claude Code session active in the last 10 minutes.
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-2" role="list" aria-label="Active sessions">
      {sessions.map((s) => {
        const main = live?.agents.find((a) => a.sessionId === s.sessionId && a.agentId === "");
        const subs = live?.agents.filter((a) => a.sessionId === s.sessionId && a.agentId && a.state !== "done") ?? [];
        const style = STATE_STYLES[main?.state ?? "idle"];
        return (
          <button
            key={s.sessionId}
            role="listitem"
            onClick={() => highlight(s.sessionId)}
            aria-pressed={highlighted === s.sessionId}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-muted",
              highlighted === s.sessionId && "border-primary bg-muted"
            )}
          >
            <span className={cn("size-2 rounded-full motion-safe:animate-pulse", style.dot)} />
            <span className="font-medium">{s.project}</span>
            <span className="text-secondary-foreground">
              {main?.tool ? `▶ ${main.tool} ${formatElapsed(main.toolSince, now)}` : style.label}
            </span>
            {subs.length > 0 && <span className="text-muted-foreground">+{subs.length} subagents</span>}
          </button>
        );
      })}
    </div>
  );
}
