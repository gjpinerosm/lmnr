import { type LiveState } from "@/lib/agent-graph/types";

interface StateStyle {
  label: string;
  /** Dot and text color. */
  dot: string;
  /** Node ring while an agent of the node is in this state. */
  ring: string;
}

// Tailwind palette colors stay readable on both themes; the label is always shown next to the dot.
export const STATE_STYLES: Record<LiveState, StateStyle> = {
  tool_running: { label: "Running tool", dot: "bg-primary", ring: "ring-primary" },
  thinking: { label: "Thinking", dot: "bg-sky-500", ring: "ring-sky-500" },
  awaiting_permission: { label: "Awaiting permission", dot: "bg-amber-500", ring: "ring-amber-500" },
  awaiting_user: { label: "Awaiting user", dot: "bg-amber-400", ring: "ring-amber-400" },
  compacting: { label: "Compacting", dot: "bg-violet-500", ring: "ring-violet-500" },
  background_wait: { label: "Background tasks", dot: "bg-teal-500", ring: "ring-teal-500" },
  error: { label: "Error", dot: "bg-destructive", ring: "ring-destructive" },
  idle: { label: "Idle", dot: "bg-muted-foreground/50", ring: "ring-transparent" },
  done: { label: "Done", dot: "bg-muted-foreground/50", ring: "ring-transparent" },
  ended: { label: "Ended", dot: "bg-muted-foreground/30", ring: "ring-transparent" },
};

export const LEGEND_STATES: LiveState[] = [
  "tool_running",
  "thinking",
  "awaiting_permission",
  "compacting",
  "error",
  "done",
];

export const LIVE_PROJECT_NAME = "claude-live";
export const DEFAULT_PAST_HOURS = "168";
export const LIVE_POLL_MS = 5000;
export const LIVE_DEBOUNCE_MS = 500;
