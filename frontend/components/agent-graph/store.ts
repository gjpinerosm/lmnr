import { create } from "zustand";

interface AgentGraphState {
  selectedNodeId: string | null;
  highlightedSession: string | null;
  selectNode: (id: string | null) => void;
  highlightSession: (sessionId: string | null) => void;
}

export const useAgentGraphStore = create<AgentGraphState>()((set) => ({
  selectedNodeId: null,
  highlightedSession: null,
  selectNode: (id) => set({ selectedNodeId: id }),
  highlightSession: (sessionId) =>
    set((s) => ({ highlightedSession: s.highlightedSession === sessionId ? null : sessionId })),
}));
