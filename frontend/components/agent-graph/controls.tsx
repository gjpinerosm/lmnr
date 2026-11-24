import { useGraphParams } from "@/components/agent-graph/hooks/use-graph-params";
import DateRangeFilter from "@/components/ui/date-range-filter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useProjectContext } from "@/contexts/project-context";
import { formatCost, formatTokens } from "@/lib/agent-graph/format";
import { type HistoryGraph } from "@/lib/agent-graph/types";

interface Props {
  history: HistoryGraph | null;
  liveProjectId: string | null;
}

export default function Controls({ history, liveProjectId }: Props) {
  const [{ metric, live }, setParams] = useGraphParams();
  const { projects } = useProjectContext();
  const t = history?.totals;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2">
      <DateRangeFilter />
      <Select value={metric} onValueChange={(v) => setParams({ metric: v as "tokens" | "cost" })}>
        <SelectTrigger className="w-28" aria-label="Metric">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tokens">Tokens</SelectItem>
          <SelectItem value="cost">Cost</SelectItem>
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={live} onCheckedChange={(v) => setParams({ live: v })} aria-label="Live layer" />
        Live
      </label>
      {live && (
        <Select value={liveProjectId ?? ""} onValueChange={(v) => setParams({ liveProject: v })}>
          <SelectTrigger className="w-40" aria-label="Live project">
            <SelectValue placeholder="Live project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {t && (
        <div className="ml-auto flex gap-4 text-xs text-secondary-foreground tabular-nums">
          <span>{t.turns} turns</span>
          <span>{t.sessions} sessions</span>
          <span>{formatTokens(t.tokens)} tokens</span>
          <span>{formatCost(t.cost)}</span>
        </div>
      )}
    </div>
  );
}
