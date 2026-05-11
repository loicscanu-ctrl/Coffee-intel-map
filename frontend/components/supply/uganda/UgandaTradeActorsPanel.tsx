"use client";

interface TradeRow {
  rank: number;
  company: string;
  robusta_bags?: number;
  arabica_bags?: number;
  total_bags: number;
  pct_individual?: number;
}

const PCT_BAR_MAX = 20; // scale: 20% = full bar width

function ActorTable({
  rows,
  label,
  color,
}: {
  rows: TradeRow[];
  label: string;
  color: string;
}) {
  if (!rows || rows.length === 0) return null;
  const top = rows.slice(0, 15);

  return (
    <div className="space-y-1">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      {top.map(r => {
        const pct = r.pct_individual ?? 0;
        const barW = Math.min(100, (pct / PCT_BAR_MAX) * 100);
        const rPct = r.robusta_bags && r.total_bags
          ? Math.round(r.robusta_bags / r.total_bags * 100) : null;
        return (
          <div key={r.rank} className="grid grid-cols-[18px_1fr_36px] gap-1 items-center">
            <span className="text-[8px] text-slate-600 text-right">{r.rank}.</span>
            <div className="min-w-0">
              <div className="text-[9px] text-slate-300 truncate leading-tight">{r.company}</div>
              <div className="h-1 mt-0.5 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${barW}%`, background: color }}
                />
              </div>
              {rPct != null && (
                <div className="text-[7px] text-slate-600 leading-tight">
                  R:{rPct}% A:{100-rPct}%
                </div>
              )}
            </div>
            <span className="text-[9px] font-mono text-slate-400 text-right">
              {pct > 0 ? `${pct.toFixed(1)}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function UgandaTradeActorsPanel({
  exporters,
  buyers,
  month,
}: {
  exporters: TradeRow[];
  buyers: TradeRow[];
  month: string;
}) {
  return (
    <div className="space-y-5">
      <div className="text-[8px] text-slate-600 text-right">UCDA Annex 1 &amp; 4 · {month}</div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <ActorTable rows={exporters} label="Ugandan Exporters" color="#f59e0b" />
        <ActorTable rows={buyers}    label="Foreign Buyers"    color="#38bdf8" />
      </div>
      <div className="text-[8px] text-slate-600">
        Bar width = market share (0–20% scale). R/A = robusta/arabica split where available.
      </div>
    </div>
  );
}
