import { LEGEND_STATES, STATE_STYLES } from "@/components/agent-graph/constants";
import { cn } from "@/lib/utils";

export default function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-14 z-10 flex flex-wrap items-center gap-3 rounded-md border bg-background/90 px-3 py-1.5 text-[11px] text-secondary-foreground">
      {LEGEND_STATES.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-full", STATE_STYLES[s].dot)} />
          {STATE_STYLES[s].label}
        </span>
      ))}
      <span className="text-muted-foreground">Edge width = launches · dashed = new</span>
    </div>
  );
}
