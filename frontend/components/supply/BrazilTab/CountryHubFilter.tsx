"use client";
import { useMemo } from "react";
import {
  COUNTRY_HUB, HUB_COLORS, HUB_ORDER, TYPE_FILTER_OPTS,
} from "./constants";
import { toEn } from "./helpers";
import type { CountryYear, FilterState } from "./types";

export default function CountryHubFilter({
  byCountry,
  filter,
  onChange,
}: {
  byCountry: CountryYear;
  filter: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const sortedCountries = useMemo(() =>
    Object.entries(byCountry.countries ?? {})
      .sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0))
      .map(([pt]) => pt)
  , [byCountry]);

  const hubCountries = filter.hub
    ? sortedCountries.filter(pt => COUNTRY_HUB[pt] === filter.hub)
    : sortedCountries;

  const isActive = filter.hub !== null || filter.country !== null || filter.type !== null;
  const activeLabels = [
    filter.type ? TYPE_FILTER_OPTS.find(t => t.key === filter.type)?.label : null,
    filter.country ? toEn(filter.country) : filter.hub,
  ].filter(Boolean).join(" · ");

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide font-medium">Filter charts</span>
        {isActive && (
          <button onClick={() => onChange({ hub: null, country: null, type: null })}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-800 text-indigo-200 hover:bg-indigo-700">
            ✕ Clear ({activeLabels || "all"})
          </button>
        )}
      </div>

      {/* Coffee type pills */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-14 shrink-0">Type</span>
        <div className="flex flex-wrap gap-1">
          {TYPE_FILTER_OPTS.map(t => (
            <button key={t.key}
              onClick={() => onChange({ ...filter, type: filter.type === t.key ? null : t.key })}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                filter.type === t.key
                  ? "border-transparent text-slate-900 font-semibold"
                  : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              }`}
              style={filter.type === t.key ? { background: t.color } : { borderLeftColor: t.color, borderLeftWidth: 3 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hub pills */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-14 shrink-0">Hub</span>
        <div className="flex flex-wrap gap-1">
          {HUB_ORDER.map(hub => (
            <button key={hub}
              onClick={() => onChange({ ...filter, hub: filter.hub === hub ? null : hub, country: null })}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                filter.hub === hub
                  ? "border-indigo-500 bg-indigo-900 text-indigo-200"
                  : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              }`}
              style={filter.hub === hub ? {} : { borderLeftColor: HUB_COLORS[hub], borderLeftWidth: 3 }}>
              {hub}
            </button>
          ))}
        </div>
      </div>

      {/* Country pills within selected hub */}
      {hubCountries.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-[10px] text-slate-500 w-14 shrink-0 pt-0.5">Country</span>
          <div className="flex flex-wrap gap-1">
            {hubCountries.slice(0, 20).map(pt => (
              <button key={pt}
                onClick={() => onChange({ ...filter, country: filter.country === pt ? null : pt })}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  filter.country === pt
                    ? "bg-indigo-700 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                }`}>
                {toEn(pt)}
              </button>
            ))}
            {hubCountries.length > 20 && (
              <span className="text-[10px] text-slate-600 self-center">+{hubCountries.length - 20} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
