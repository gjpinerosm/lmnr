import { type Metadata } from "next";

import AgentGraph from "@/components/agent-graph";
import Header from "@/components/ui/header";

export const metadata: Metadata = {
  title: "Agent graph",
};

export default function AgentGraphPage() {
  return (
    <>
      <Header path="agent graph" className="border-b-0" />
      <AgentGraph />
    </>
  );
}
