// Lookup tables, palettes, and shared style tokens for the CoT dashboard.

import type { Step } from "./types";

// ── Step navigation ───────────────────────────────────────────────────────────

export const NAV_STEPS = [
  { id: 1 as Step, icon: "Globe",    label: "Flow" },
  { id: 2 as Step, icon: "Grid",     label: "Heatmap" },
  { id: 3 as Step, icon: "Sliders",  label: "Gauges" },
  { id: 4 as Step, icon: "Factory",  label: "Industry" },
  { id: 5 as Step, icon: "Droplets", label: "Dry Powder" },
  { id: 6 as Step, icon: "Scale",    label: "Cycle" },
];

// ── Macro COT (cross-commodity) palettes ──────────────────────────────────────

export const SECTORS = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;

export const SECTOR_COLORS: Record<string, string> = {
  energy: "#f97316",
  metals: "#6366f1",
  grains: "#f59e0b",
  meats:  "#ef4444",
  softs:  "#10b981",
  micros: "#8b5cf6",
};

export const ENERGY_SYMBOLS = new Set(["wti", "brent", "natgas", "heating_oil", "rbob", "lsgo"]);

export const SOFT_SYMBOLS: { key: string; label: string; color: string }[] = [
  { key: "arabica",     label: "Arabica Coffee",  color: "#f59e0b" },
  { key: "robusta",     label: "Robusta Coffee",  color: "#78350f" },
  { key: "sugar11",     label: "Sugar No. 11",    color: "#a3e635" },
  { key: "white_sugar", label: "White Sugar",     color: "#d1fae5" },
  { key: "cotton",      label: "Cotton",          color: "#60a5fa" },
  { key: "cocoa_ny",    label: "Cocoa NY",        color: "#a78bfa" },
  { key: "cocoa_ldn",   label: "Cocoa London",    color: "#7c3aed" },
  { key: "oj",          label: "Orange Juice",    color: "#fb923c" },
];

// ── Step 5 (Dry Powder) categories ────────────────────────────────────────────

export const CAT_ITEMS = [
  { k: "pmpu",   l: "PMPU",          c: "#3b82f6" },
  { k: "mm",     l: "Managed Money", c: "#f59e0b" },
  { k: "swap",   l: "Swap/Index",    c: "#10b981" },
  { k: "other",  l: "Other Rept",    c: "#64748b" },
  { k: "nonrep", l: "Non Rept",      c: "#94a3b8" },
];

// ── Steps 2 & 3 (Heatmap & Gauges) per-category colors ────────────────────────

export const HM_CAT_COLORS: Record<string, string> = {
  "PMPU": "#92400e", "Swap": "#10b981", "MM": "#1e40af",
  "Other Rpt": "#38bdf8", "Non-Rep": "#64748b",
};

// ── Step 1 attribution table ──────────────────────────────────────────────────

export const SECTOR_ORDER_ATTR = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;

export const SECTOR_LABELS_ATTR: Record<string, string> = {
  energy: "Energy", metals: "Metals", grains: "Grains",
  meats: "Meats", softs: "Softs", micros: "Micros",
};

// ── Shared style tokens ───────────────────────────────────────────────────────

export const CHART_STYLE = { backgroundColor: "#0f172a", borderColor: "#334155" };
