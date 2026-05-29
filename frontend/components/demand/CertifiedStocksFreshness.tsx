"use client";
/**
 * Data freshness strip for the Certified Stocks panel.
 *
 * One chip per source feed: last available data point, calendar-day age,
 * and a colour cue (green ≤ 1d, amber ≤ 3d, orange ≤ 7d, rose older,
 * grey if missing). Sits under the panel header so a reader knows at a
 * glance whether the numbers below are today's or a week stale.
 */
import { useEffect, useState } from "react";

interface FreshnessSource {
  arabicaAsOf?:        string | null;
  arabicaGeneratedAt?: string | null;
  robustaAsOf?:        string | null;
  robustaGeneratedAt?: string | null;
  robustaGradingsLast?:        string | null;
  robustaAgeAllowanceLast?:    string | null;
  robustaIssRecvLast?:         string | null;
  robustaTendersLast?:         string | null;
  robustaOverviewLast?:        string | null;
  robustaImpliedOutflowLast?:  string | null;
}

function _ageDays(iso: string | null | undefined, today: Date): number | null {
  if (!iso) return null;
  // Month-end strings like "2026-04" get pinned to the 28th so they at
  // least round in the right direction; full ISO dates are parsed as-is.
  const padded = iso.length === 7 ? `${iso}-28` : iso;
  const t = new Date(padded).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((today.getTime() - t) / 86_400_000));
}

function _tone(days: number | null): string {
  if (days == null) return "text-slate-700 border-slate-800";
  if (days <= 1)   return "text-emerald-400 border-emerald-800/60 bg-emerald-950/30";
  if (days <= 3)   return "text-amber-400   border-amber-800/60   bg-amber-950/30";
  if (days <= 7)   return "text-orange-400  border-orange-800/60  bg-orange-950/30";
  if (days <= 35)  return "text-rose-400    border-rose-800/60    bg-rose-950/30";
  return                  "text-slate-500   border-slate-800";
}

function _ageStr(days: number | null): string {
  if (days == null)  return "—";
  if (days === 0)    return "today";
  if (days === 1)    return "1d ago";
  if (days <= 60)    return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function Chip({ label, last, today }: { label: string; last: string | null | undefined; today: Date }) {
  const days = _ageDays(last, today);
  return (
    <span
      title={last ? `${label} · latest = ${last} · ${_ageStr(days)}` : `${label} · no data`}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[9.5px] font-mono ${_tone(days)}`}
    >
      <span className="text-slate-400 uppercase tracking-wider">{label}</span>
      <span>{last ?? "—"}</span>
      <span className="opacity-80">· {_ageStr(days)}</span>
    </span>
  );
}

export default function CertifiedStocksFreshness(props: FreshnessSource) {
  // `today` is captured in client state so SSR and the first client render
  // agree (Next would otherwise complain about Date.now() during hydration).
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);
  if (!today) return null;

  return (
    <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Data freshness</span>
        <Chip label="KC stock"     last={props.arabicaAsOf}            today={today} />
        <Chip label="RC stock"     last={props.robustaAsOf}            today={today} />
        <Chip label="RC gradings"  last={props.robustaGradingsLast}    today={today} />
        <Chip label="RC age allow" last={props.robustaAgeAllowanceLast} today={today} />
        <Chip label="RC iss/recv"  last={props.robustaIssRecvLast}     today={today} />
        <Chip label="RC tenders"   last={props.robustaTendersLast}     today={today} />
        <Chip label="RC queue"     last={props.robustaOverviewLast}    today={today} />
        <Chip label="cohort out"   last={props.robustaImpliedOutflowLast} today={today} />
      </div>
      <div className="text-[8.5px] text-slate-600 mt-1">
        Colour: <span className="text-emerald-400">≤ 1d</span> · <span className="text-amber-400">≤ 3d</span> ·
        <span className="text-orange-400"> ≤ 7d</span> · <span className="text-rose-400"> stale</span>.
        Last-fetch timestamps come from the workbook importer; weekly cadence on age allowance is normal.
      </div>
    </div>
  );
}