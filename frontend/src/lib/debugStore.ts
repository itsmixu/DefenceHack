import { create } from 'zustand';

export interface DebugEntry {
  id: string;
  startedAt: number;
  method: string;
  url: string;
  path: string;
  query: string;
  status?: number;
  durationMs?: number;
  ok?: boolean;
  metaStatus?: string;
  metaReason?: string;
  error?: string;
  responseBytes?: number;
}

const MAX_ENTRIES = 200;

interface DebugState {
  entries: DebugEntry[];
  open: boolean;
  start: (e: Omit<DebugEntry, 'startedAt'>) => void;
  finish: (id: string, patch: Partial<DebugEntry>) => void;
  clear: () => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
}

export const useDebugStore = create<DebugState>((set) => ({
  entries: [],
  open: false,
  start: (e) =>
    set((s) => {
      const next = [{ ...e, startedAt: Date.now() }, ...s.entries];
      if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
      return { entries: next };
    }),
  finish: (id, patch) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),
  clear: () => set({ entries: [] }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
