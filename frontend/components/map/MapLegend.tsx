"use client";
import { useState } from "react";
import type { FactoryType } from "@/lib/api";

interface LegendDotProps {
  color: string;
  shape?: "circle" | "square" | "line" | "label";
  label: string;
  sub?: string;
}

function LegendItem({ color, shape = "circle", label, sub }: LegendDotProps) {
  const swatch =
    shape === "line" ? (
      <span
        className="inline-block w-6 h-[3px] rounded-sm flex-shrink-0"
        style={{ background: color }}
      />
    ) : shape === "square" ? (
      <span
        className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-white/60"
        style={{ background: color }}
      />
    ) : shape === "label" ? (
      <span
        className="inline-block px-1 py-[1px] text-[8px] font-mono font-bold flex-shrink-0 border border-slate-500 rounded"
        style={{ background: "rgba(15,23,42,0.88)", color: "#cbd5e1" }}
      >
        $/FEU
      </span>
    ) : (
      <span
        className="inline-block w-3 h-3 rounded-full flex-shrink-0 border-2 border-white"
        style={{ background: color }}
      />
    );

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="mt-[3px]">{swatch}</span>
      <div className="text-[11px] leading-snug">
        <span className="text-slate-200">{label}</span>
        {sub && <span className="text-slate-500 ml-1">· {sub}</span>}
      </div>
    </div>
  );
}

// Clickable variant for factory-type rows. When the user clicks, the type's
// visibility on the map is toggled (managed by the parent). Hidden state is
// rendered with reduced opacity + a strikethrough hint so it's obvious which
// types are being filtered out.
function ToggleableLegendItem({
  color,
  label,
  sub,
  hidden,
  onClick,
}: {
  color: string;
  label: string;
  sub?: string;
  hidden: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!hidden}
      className={`w-full flex items-start gap-2 py-0.5 px-1 -mx-1 rounded text-left hover:bg-slate-800/60 transition-colors ${
        hidden ? "opacity-40" : ""
      }`}
    >
      <span className="mt-[3px]">
        <span
          className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-white/60"
          style={{ background: color }}
        />
      </span>
      <div className="text-[11px] leading-snug flex-1">
        <span className={`text-slate-200 ${hidden ? "line-through" : ""}`}>{label}</span>
        {sub && <span className="text-slate-500 ml-1">· {sub}</span>}
      </div>
    </button>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
          {title}
        </div>
        {hint && <div className="text-[9px] text-slate-600 italic">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

interface MapLegendProps {
  /** Set of factory `type` values currently hidden. Empty = all visible. */
  hiddenFactoryTypes?: Set<FactoryType>;
  /** Called when the user clicks a factory-type row to toggle it. */
  onToggleFactoryType?: (t: FactoryType) => void;
}

const FACTORY_LEGEND_ROWS: Array<{ type: FactoryType; color: string; label: string; sub: string }> = [
  { type: "mill",     color: "#a16207", label: "Origin mill",     sub: "M · dry/wet processing" },
  { type: "roastery", color: "#7c2d12", label: "Roastery",        sub: "R" },
  { type: "soluble",  color: "#fde68a", label: "Soluble (instant)", sub: "S" },
  { type: "decaf",    color: "#16a34a", label: "Decaffeination",  sub: "D" },
  { type: "capsules", color: "#94a3b8", label: "Capsules / pods", sub: "C" },
  { type: "mixed",    color: "#6366f1", label: "Mixed-use plant", sub: "F" },
  { type: "unknown",  color: "#475569", label: "Other / unknown", sub: "F" },
];

export default function MapLegend({ hiddenFactoryTypes, onToggleFactoryType }: MapLegendProps = {}) {
  const [open, setOpen] = useState(false);

  // Both props arrive together from MapPageClient; default to noop + empty
  // Set so the component remains usable when rendered without props.
  const hidden = hiddenFactoryTypes ?? new Set<FactoryType>();
  const toggle = onToggleFactoryType ?? (() => {});
  const filterable = !!onToggleFactoryType;
  const hiddenCount = hidden.size;

  return (
    <div className="absolute bottom-2 left-2 z-[1000]">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Map legend"
        aria-expanded={open}
        className="bg-slate-800/90 border border-slate-600 text-slate-300 hover:text-white text-sm font-bold w-7 h-7 rounded-full shadow flex items-center justify-center"
      >
        {open ? "×" : "?"}
      </button>

      {open && (
        <div className="mt-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl p-3 w-[260px] sm:w-[300px] max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-white">Map Legend</div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close legend"
              className="text-slate-500 hover:text-white text-sm leading-none px-1"
            >
              ×
            </button>
          </div>

          <Section title="Country pins">
            <LegendItem color="#10b981" label="Producer country" />
            <LegendItem color="#3b82f6" label="Consumer country" />
          </Section>

          <Section
            title="Factories"
            hint={filterable ? (hiddenCount > 0 ? `${hiddenCount} hidden · click to toggle` : "click to filter") : undefined}
          >
            {FACTORY_LEGEND_ROWS.map(row =>
              filterable ? (
                <ToggleableLegendItem
                  key={row.type}
                  color={row.color}
                  label={row.label}
                  sub={row.sub}
                  hidden={hidden.has(row.type)}
                  onClick={() => toggle(row.type)}
                />
              ) : (
                <LegendItem
                  key={row.type}
                  color={row.color}
                  shape="square"
                  label={row.label}
                  sub={row.sub}
                />
              )
            )}
          </Section>

          <Section title="News pins">
            <LegendItem color="#ef4444" label="Supply news" />
            <LegendItem color="#eab308" label="Demand news" />
            <LegendItem color="#3b82f6" label="Macro news" />
            <LegendItem color="#6b7280" label="General news" />
          </Section>

          <Section title="Trade routes">
            <LegendItem shape="line" color="#ffffff" label="Singapore → Antwerp" sub="main trunk + Hamburg spur" />
            <LegendItem shape="line" color="#e74c3c" label="Brazil corridor" sub="Santos / Conilon-Cartagena" />
            <LegendItem shape="line" color="#3498db" label="Honduras → channel" />
            <LegendItem shape="line" color="#16a085" label="Med spurs" sub="Trieste · Genoa · Barcelona" />
            <LegendItem shape="line" color="#2ecc71" label="Pacific / Asia feeders" />
            <LegendItem shape="line" color="#9b59b6" label="Indonesia / other" />
            <LegendItem shape="line" color="#f39c12" label="Africa spurs" />
          </Section>

          <Section title="Hub & price labels">
            <LegendItem color="#fbbf24" label="Origin price dot" sub="local · USD · diff vs ICE" />
            <LegendItem shape="label" color="" label="Freight label" sub="route · transit · WoW change" />
          </Section>

          <div className="text-[9px] text-slate-600 mt-2 leading-relaxed">
            Click any pin or route to open detail. Use the Map Style button to switch basemaps.
          </div>
        </div>
      )}
    </div>
  );
}
