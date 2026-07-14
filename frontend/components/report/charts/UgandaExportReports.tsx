"use client";
/**
 * Report wrappers for the Uganda (UCDA) export chart suite — mirrors the Brazil
 * report set. All read /data/uganda_monthly.json (the multi-year UCDA series)
 * and feed the tab's own charts their `monthly` rows.
 */
import { useEffect, useState } from "react";
import type { UgandaMonthlyRow } from "@/components/supply/uganda/helpers";
import UgandaMonthlyVolumeChart from "@/components/supply/uganda/UgandaMonthlyVolumeChart";
import UgandaCumulativePaceChart from "@/components/supply/uganda/UgandaCumulativePaceChart";
import UgandaAnnualTrendChart from "@/components/supply/uganda/UgandaAnnualTrendChart";
import UgandaTypeShareChart from "@/components/supply/uganda/UgandaTypeShareChart";
import UgandaDestinationChart from "@/components/supply/uganda/UgandaDestinationChart";

function useUg() {
  const [monthly, setMonthly] = useState<UgandaMonthlyRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/data/uganda_monthly.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { series?: UgandaMonthlyRow[] }) => {
        const s = d?.series ?? [];
        if (s.length) setMonthly(s); else setError(true);
      })
      .catch(() => setError(true));
  }, []);
  return { monthly, error };
}

const fb = (error: boolean, m: unknown) =>
  error ? <div className="p-4 text-xs text-slate-500">Uganda export data unavailable.</div>
        : !m ? <div className="p-4 text-xs text-slate-500">Loading Uganda exports…</div>
        : null;

export function UgandaMonthlyVolume() {
  const { monthly, error } = useUg();
  return fb(error, monthly) ?? <UgandaMonthlyVolumeChart monthly={monthly!} />;
}
export function UgandaCumulativePace() {
  const { monthly, error } = useUg();
  return fb(error, monthly) ?? <UgandaCumulativePaceChart monthly={monthly!} />;
}
export function UgandaAnnualTrend() {
  const { monthly, error } = useUg();
  return fb(error, monthly) ?? <UgandaAnnualTrendChart monthly={monthly!} />;
}
export function UgandaTypeShare() {
  const { monthly, error } = useUg();
  return fb(error, monthly) ?? <UgandaTypeShareChart monthly={monthly!} />;
}
export function UgandaDestination() {
  const { monthly, error } = useUg();
  return fb(error, monthly) ?? <UgandaDestinationChart monthly={monthly!} />;
}
