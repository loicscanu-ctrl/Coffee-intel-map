"use client";
/**
 * AgronomicTicker — "Live Agronomic Threats" overlay across the top of the
 * map. Reads frontend/public/data/agronomic_alerts.json (produced by
 * backend/scraper/agronomic_alerts.py at the end of the 1.10 weather run)
 * and renders one rollup chip per country, expandable to per-region detail.
 *
 * Contract honored:
 *   severity ∈ {"watch", "alert", "critical"}  ← lowercase, strict
 *   timeframe ∈ {"current", "forecast"}        ← top-level field, not text
 *   origins[origin][region][] = alert          ← already grouped, no O(n²)
 *
 * Severity → palette:
 *   critical → red
 *   alert    → amber
 *   watch    → yellow
 * The most severe level among a country's alerts drives that country's chip.
 *
 * Behavior:
 *   - Auto-hides when total_alerts == 0 or fetch fails
 *   - Click country chip → expand inline detail
 *   - "Hide" button persists dismiss in localStorage for 24h
 *   - "Forecast" timeframe gets a clock prefix; "current" gets a flame
 */
import { useEffect, useMemo, useState } from "react";

type Severity = "watch" | "alert" | "critical";
type Timeframe = "current" | "forecast";

interface Alert {
  threat_id: string;
  name: string;
  severity: Severity;
  timeframe: Timeframe;
  market_impact: string;
  triggers: Record<string, number>;
}

interface AgronomicAlertsPayload {
  generated_at: string;
  ruleset_version: string;
  origins: Record<string, Record<string, Alert[]>>;
  summary: {
    total_alerts: number;
    by_severity: Partial<Record<Severity, number>>;
    by_threat: Record<string, number>;
  };
}

// Display labels for origin keys (which use repo-internal codes like "vn").
const ORIGIN_LABELS: Record<string, string> = {
  brazil:    "Brazil",
  colombia:  "Colombia",
  honduras:  "Honduras",
  indonesia: "Indonesia",
  uganda:    "Uganda",
  ethiopia:  "Ethiopia",
  vn:        "Vietnam",
};

// Severity rank for sorting + worst-of-country aggregation.
const SEVERITY_RANK: Record<Severity, number> = { watch: 1, alert: 2, critical: 3 };

// Tailwind palette per severity. Picked to match the existing map's dark theme.
const SEV_STYLES: Record<Severity, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: "bg-rose-950/70",   border: "border-rose-500/70",   text: "text-rose-200",   dot: "bg-rose-400"   },
  alert:    { bg: "bg-amber-950/70",  border: "border-amber-500/70",  text: "text-amber-200",  dot: "bg-amber-400"  },
  watch:    { bg: "bg-yellow-950/70", border: "border-yellow-500/60", text: "text-yellow-200", dot: "bg-yellow-300" },
};

const DISMISS_KEY = "agronomic-ticker-dismissed-until";

function formatTriggers(triggers: Record<string, number>): string {
  return Object.entries(triggers).map(([k, v]) => `${k} = ${v}`).join(" · ");
}

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  const until = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
  return until > Date.now();
}

export default function AgronomicTicker() {
  const [payload, setPayload] = useState<AgronomicAlertsPayload | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(isDismissed());
    fetch("/data/agronomic_alerts.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AgronomicAlertsPayload | null) => d && setPayload(d))
      .catch(() => {
        // Silent — the engine may not have run yet on a fresh deploy. The
        // ticker simply doesn't render, same pattern as VHI/SPEI.
      });
  }, []);

  // Per-country rollup: worst severity, alert count, and (sorted) regions list.
  const rollups = useMemo(() => {
    if (!payload) return [];
    return Object.entries(payload.origins).map(([origin, regions]) => {
      const all: Array<{ region: string; alert: Alert }> = [];
      let worst: Severity = "watch";
      for (const [region, alerts] of Object.entries(regions)) {
        for (const a of alerts) {
          all.push({ region, alert: a });
          if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[worst]) worst = a.severity;
        }
      }
      all.sort((x, y) => SEVERITY_RANK[y.alert.severity] - SEVERITY_RANK[x.alert.severity]);
      return {
        origin,
        label: ORIGIN_LABELS[origin] ?? origin,
        worst,
        count: all.length,
        alerts: all,
      };
    }).sort((a, b) => SEVERITY_RANK[b.worst] - SEVERITY_RANK[a.worst]);
  }, [payload]);

  if (!payload || payload.summary.total_alerts === 0 || dismissed) return null;

  const expandedRollup = expanded ? rollups.find((r) => r.origin === expanded) : null;
  const generatedAgo = (() => {
    const t = Date.parse(payload.generated_at);
    if (!Number.isFinite(t)) return "";
    const mins = Math.floor((Date.now() - t) / 60_000);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  })();

  return (
    <div
      className="absolute top-0 left-0 right-0 z-[900] pointer-events-none"
      aria-label="Live agronomic threats"
    >
      <div className="pointer-events-auto bg-slate-950/90 border-b border-slate-700 backdrop-blur-sm">
        {/* Header strip */}
        <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto">
          <span className="text-[9px] uppercase tracking-widest text-slate-500 shrink-0">
            Agronomic Threats
          </span>
          <span className="text-[9px] text-slate-600 shrink-0 hidden sm:inline">
            · {generatedAgo} · {payload.summary.total_alerts} active
          </span>
          <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
            {rollups.map((r) => {
              const sev = SEV_STYLES[r.worst];
              const isOpen = expanded === r.origin;
              return (
                <button
                  key={r.origin}
                  onClick={() => setExpanded(isOpen ? null : r.origin)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono transition-opacity ${sev.bg} ${sev.border} ${sev.text} ${isOpen ? "opacity-100" : "opacity-90 hover:opacity-100"}`}
                  aria-expanded={isOpen}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} aria-hidden />
                  <span className="font-semibold">{r.label}</span>
                  <span className="text-slate-400">·</span>
                  <span>{r.count} {r.worst}</span>
                  <span className="text-slate-500">{isOpen ? "▾" : "▸"}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              window.localStorage.setItem(DISMISS_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
              setDismissed(true);
            }}
            className="shrink-0 text-[10px] text-slate-500 hover:text-slate-200 px-2"
            aria-label="Hide for 24 hours"
          >
            ✕
          </button>
        </div>

        {/* Expanded detail strip — only when a chip is open. */}
        {expandedRollup && (
          <div className="px-3 pb-2 max-h-44 overflow-y-auto border-t border-slate-800">
            <ul className="grid gap-1 mt-1.5">
              {expandedRollup.alerts.map(({ region, alert }) => {
                const sev = SEV_STYLES[alert.severity];
                return (
                  <li
                    key={`${region}-${alert.threat_id}`}
                    className={`px-2 py-1 rounded border ${sev.border} bg-slate-900/70 flex items-center gap-2 text-[10px]`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${sev.dot} shrink-0`} aria-hidden />
                    <span className={`uppercase font-bold tracking-wider w-14 shrink-0 ${sev.text}`}>
                      {alert.severity}
                    </span>
                    <span className="font-mono text-slate-300 w-28 shrink-0 truncate">{region}</span>
                    <span className="text-slate-400 shrink-0" title={alert.timeframe === "forecast" ? "Forecast trigger — next 7 days" : "Observed trigger — current period"}>
                      {alert.timeframe === "forecast" ? "⏱ next 7d" : "● now"}
                    </span>
                    <span className="text-slate-300 truncate flex-1">
                      <span className="font-semibold">{alert.name}.</span>{" "}
                      <span className="text-slate-400">{alert.market_impact}</span>
                    </span>
                    <span className="font-mono text-slate-500 hidden md:inline shrink-0">
                      [{formatTriggers(alert.triggers)}]
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
