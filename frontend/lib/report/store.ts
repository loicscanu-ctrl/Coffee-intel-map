"use client";
/**
 * Report "cart" store — the Dynamic Briefing Engine's state layer.
 *
 * A single module-level Zustand store (no Context/Provider needed): because it
 * lives outside the React tree, the selection survives tab navigation, so a
 * future "📌 pin to report" button on any tab can call `add(id)` and the item
 * shows up in the News-tab builder. `persist` mirrors it to localStorage so a
 * refresh doesn't empty the cart.
 *
 *   selectedIds — ordered list of registry chart IDs in the report
 *   comments    — per-chart executive-summary text, keyed by chart ID
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ReportState {
  selectedIds: string[];
  comments: Record<string, string>;
  toggle: (id: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  setComment: (id: string, text: string) => void;
  clear: () => void;
}

export const useReportStore = create<ReportState>()(
  persist(
    (set) => ({
      selectedIds: [],
      comments: {},
      toggle: (id) =>
        set((s) =>
          s.selectedIds.includes(id)
            ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
            : { selectedIds: [...s.selectedIds, id] },
        ),
      add: (id) =>
        set((s) => (s.selectedIds.includes(id) ? s : { selectedIds: [...s.selectedIds, id] })),
      remove: (id) =>
        set((s) => {
          // Drop the comment too so removed charts don't leave orphaned notes.
          const { [id]: _drop, ...rest } = s.comments;
          return { selectedIds: s.selectedIds.filter((x) => x !== id), comments: rest };
        }),
      setComment: (id, text) => set((s) => ({ comments: { ...s.comments, [id]: text } })),
      clear: () => set({ selectedIds: [], comments: {} }),
    }),
    { name: "coffee-intel-report-cart" },
  ),
);
