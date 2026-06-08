"use client";
/**
 * Report wrappers for Vietnam export charts. All read /data/vietnam_supply.json
 * (exports.monthly) and feed the prop-driven VietnamTab charts.
 */
import { useEffect, useState } from "react";
import VnMonthlyVolume from "@/components/supply/VietnamTab/MonthlyVolumeChart";
import VnCumulativePace from "@/components/supply/VietnamTab/CumulativePaceChart";
import VnAnnualTrend from "@/components/supply/VietnamTab/AnnualTrendChart";
import type { ExportMonth } from "@/components/supply/VietnamTab/MonthlyVolumeChart";

interface VnSupply { exports: { monthly: ExportMonth[] } | null }

function useVnMonthly() {
  const [monthly, setMonthly] = useState<ExportMonth[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/data/vietnam_supply.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: VnSupply | null) => {
        const m = j?.exports?.monthly;
        if (m && m.length) setMonthly(m); else setErr(true);
      })
      .catch(() => setErr(true));
  }, []);
  return { monthly, err };
}

const fallback = (err: boolean, m: ExportMonth[] | null) =>
  err ? <div className="p-4 text-xs text-slate-500">Vietnam export data unavailable.</div>
      : !m ? <div className="p-4 text-xs text-slate-500">Loading Vietnam exports…</div>
      : null;

export function VietnamMonthlyVolume() {
  const { monthly, err } = useVnMonthly();
  return fallback(err, monthly) ?? <VnMonthlyVolume monthly={monthly!} isReportMode />;
}

export function VietnamCumulativePace() {
  const { monthly, err } = useVnMonthly();
  return fallback(err, monthly) ?? <VnCumulativePace monthly={monthly!} />;
}

export function VietnamAnnualVolume() {
  const { monthly, err } = useVnMonthly();
  return fallback(err, monthly) ?? <VnAnnualTrend monthly={monthly!} />;
}
