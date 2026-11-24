import { formatCost, formatTokens } from "@/lib/agent-graph/format";
import { type ModelUsage } from "@/lib/agent-graph/types";

export default function ModelTable({ rows }: { rows: ModelUsage[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No LLM calls in this range.</p>;
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-muted-foreground">
        <tr className="border-b">
          <th className="py-1 text-left font-normal">Model</th>
          <th className="py-1 text-right font-normal">Calls</th>
          <th className="py-1 text-right font-normal">Tokens</th>
          <th className="py-1 text-right font-normal">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.model} className="border-b last:border-0">
            <td className="max-w-32 truncate py-1 pr-2" title={m.model}>
              {m.model}
            </td>
            <td className="py-1 text-right">{m.llmCalls}</td>
            <td className="py-1 text-right">{formatTokens(m.tokens)}</td>
            <td className="py-1 text-right">{formatCost(m.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
