"use client";
import { useEffect, useMemo, useState } from "react";

// Spot green-coffee offer list scraped from the ATTE portal
// (attespotcoffee.azurewebsites.net) → frontend/public/data/spot_coffee.json,
// produced by backend/scraper/sources/spot_coffee.py. The JSON is a faithful
// capture of the single offer table; this panel renders it with search,
// origin filtering and column sorting.

interface SpotData {
  as_of: string;
  generated_at: string;
  source_url: string;
  headers: string[];
  rows: Record<string, string>[];
  row_count: number;
}

// Stable origin colour for the leading dot — keyed list first, hash fallback.
const ORIGIN_COLORS: Record<string, string> = {
  BRAZIL: "#16a34a", VIETNAM: "#ca8a04", COLOMBIA: "#dc2626", INDONESIA: "#7c3aed",
  ETHIOPIA: "#ea580c", HONDURAS: "#f59e0b", GUATEMALA: "#0891b2", BURUNDI: "#14b8a6",
  CONGO: "#a855f7", CHINA: "#ef4444", "COSTA RICA": "#eab308", "DOM REP": "#f43f5e",
  PERU: "#84cc16", UGANDA: "#22c55e", KENYA: "#06b6d4", INDIA: "#8b5cf6",
};
const _PALETTE = ["#64748b", "#0ea5e9", "#f97316", "#a3e635", "#e879f9", "#2dd4bf"];
function originColor(o: string): string {
  const k = (o || "").trim().toUpperCase();
  if (ORIGIN_COLORS[k]) return ORIGIN_COLORS[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return _PALETTE[h % _PALETTE.length];
}

// "92,00" → 92.0 ; "10950" → 10950 ; "" → NaN. European decimal comma.
function parseNum(s: string): number {
  const t = (s || "").trim();
  if (!t) return NaN;
  const norm = t.includes(",") && !t.includes(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : NaN;
}

// Quantity is in either Bags or Tons (never both). Returns the numeric
// magnitude for sorting plus a display string with its unit.
function qtyOf(r: Record<string, string>): { n: number; text: string; unit: string } {
  const bags = (r["Bags"] || "").trim();
  const tons = (r["Tons"] || "").trim();
  if (bags) return { n: parseNum(bags), text: bags, unit: "bags" };
  if (tons) return { n: parseNum(tons), text: tons, unit: "t" };
  return { n: NaN, text: "", unit: "" };
}

const _ABS_UNITS = ["€/kg", "USD/mt", "cts/lb"];

// Price is either a futures differential ("minus 35" / "plus 37") or an
// outright price with a unit prefix ("€/kg 5,71", "USD/mt 10950",
// "cts/lb 293"). Returns a rendered form + a signed sort value.
function fmtPrice(raw: string): { text: string; cls: string; sort: number } {
  const s = (raw || "").trim();
  const low = s.toLowerCase();
  if (low.startsWith("minus ")) {
    const v = s.slice(6).trim();
    return { text: `−${v}`, cls: "text-rose-300", sort: -parseNum(v) };
  }
  if (low.startsWith("plus ")) {
    const v = s.slice(5).trim();
    return { text: `+${v}`, cls: "text-emerald-300", sort: parseNum(v) };
  }
  for (const u of _ABS_UNITS) {
    if (s.startsWith(u)) {
      const v = s.slice(u.length).trim();
      return { text: `${v} ${u}`, cls: "text-sky-300", sort: parseNum(v) };
    }
  }
  return { text: s, cls: "text-slate-300", sort: NaN };
}

// Display columns. `col1` and `Unit` are always empty in the source, so they
// are dropped; Bags + Tons are merged into a single Qty column.
type ColKey =
  | "qty" | "Origin" | "Quality" | "Quality cont." | "Crop"
  | "Certification" | "add. Information" | "Port" | "Warehouse" | "Terms" | "Price";

const COLUMNS: { key: ColKey; label: string; align?: "right" }[] = [
  { key: "qty", label: "Qty", align: "right" },
  { key: "Origin", label: "Origin" },
  { key: "Quality", label: "Quality" },
  { key: "Quality cont.", label: "Quality cont." },
  { key: "Crop", label: "Crop" },
  { key: "Certification", label: "Cert." },
  { key: "add. Information", label: "Add. info" },
  { key: "Port", label: "Port" },
  { key: "Warehouse", label: "Warehouse" },
  { key: "Terms", label: "Terms" },
  { key: "Price", label: "Price / diff." },
];

function sortValue(r: Record<string, string>, key: ColKey): number | string {
  if (key === "qty") {
    const q = qtyOf(r);
    return Number.isNaN(q.n) ? -Infinity : q.n;
  }
  if (key === "Price") {
    const p = fmtPrice(r["Price"] || "");
    return Number.isNaN(p.sort) ? -Infinity : p.sort;
  }
  return (r[key] || "").toLowerCase();
}

export default function SpotPanel() {
  const [d, setD] = useState<SpotData | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("ALL");
  const [sortKey, setSortKey] = useState<ColKey>("Origin");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  useEffect(() => {
    fetch("/data/spot_coffee.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j ? setD(j) : setErr(true)))
      .catch(() => setErr(true));
  }, []);

  const origins = useMemo(() => {
    if (!d) return [];
    const set: string[] = [];
    for (const r of d.rows) {
      const o = (r["Origin"] || "").trim();
      if (o && !set.includes(o)) set.push(o);
    }
    return set.sort();
  }, [d]);

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = q.trim().toLowerCase();
    let out = d.rows;
    if (origin !== "ALL") out = out.filter((r) => (r["Origin"] || "").trim() === origin);
    if (needle) {
      out = out.filter((r) =>
        Object.values(r).some((v) => (v || "").toLowerCase().includes(needle)),
      );
    }
    const sorted = [...out].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });
    return sorted;
  }, [d, q, origin, sortKey, sortDir]);

  function toggleSort(key: ColKey) {
    if (key === sortKey) setSortDir((dir) => (dir === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  }

  if (err) {
    return <div className="p-4 text-xs text-slate-500">Spot offer data unavailable.</div>;
  }
  if (!d) {
    return <div className="p-4 text-xs text-slate-500">Loading spot offers…</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Spot Offers</h2>
          <p className="text-[11px] text-slate-500">
            Live spot green-coffee offer list (physical market). Differentials are vs the
            relevant futures month; outright prices carry their unit. Updated weekly.
          </p>
        </div>
        <div className="text-[10px] text-slate-500 text-right">
          as of <span className="font-mono text-slate-300">{d.as_of}</span>
          <div>
            {rows.length === d.rows.length
              ? `${d.rows.length} offers`
              : `${rows.length} of ${d.rows.length} offers`}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search quality, port, terms…"
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-600 w-56 focus:outline-none focus:border-slate-500"
        />
        <select
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-slate-500"
        >
          <option value="ALL">All origins</option>
          {origins.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {(q || origin !== "ALL") && (
          <button
            onClick={() => { setQ(""); setOrigin("ALL"); }}
            className="text-[10px] text-slate-500 hover:text-slate-300 underline"
          >
            clear
          </button>
        )}
      </div>

      {/* Offer table */}
      <div className="overflow-auto max-h-[70vh] border border-slate-800 rounded">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr className="text-slate-400 uppercase tracking-wider text-[9px]">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`px-2 py-1.5 font-semibold cursor-pointer select-none whitespace-nowrap border-b border-slate-700 hover:text-slate-200 ${
                    c.align === "right" ? "text-right" : "text-left"
                  } ${sortKey === c.key ? "text-amber-400" : ""}`}
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-0.5">{sortDir === 1 ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const qty = qtyOf(r);
              const price = fmtPrice(r["Price"] || "");
              return (
                <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="px-2 py-1 text-right font-mono whitespace-nowrap text-slate-200">
                    {qty.text ? (
                      <>
                        {qty.text}
                        <span className="text-slate-500 ml-1 text-[9px]">{qty.unit}</span>
                      </>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-slate-200">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: originColor(r["Origin"] || "") }} />
                      {r["Origin"] || ""}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-slate-300">{r["Quality"] || ""}</td>
                  <td className="px-2 py-1 text-slate-400">{r["Quality cont."] || ""}</td>
                  <td className="px-2 py-1 text-slate-400 whitespace-nowrap">{r["Crop"] || ""}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r["Certification"]
                      ? <span className="text-emerald-300/90">{r["Certification"]}</span>
                      : <span className="text-slate-700">—</span>}
                  </td>
                  <td className="px-2 py-1 text-slate-400">{r["add. Information"] || ""}</td>
                  <td className="px-2 py-1 text-slate-300 whitespace-nowrap">{r["Port"] || ""}</td>
                  <td className="px-2 py-1 text-slate-400 whitespace-nowrap">{r["Warehouse"] || ""}</td>
                  <td className="px-2 py-1 text-slate-300 whitespace-nowrap">{r["Terms"] || ""}</td>
                  <td className={`px-2 py-1 text-right font-mono whitespace-nowrap ${price.cls}`}>
                    {price.text}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-2 py-6 text-center text-slate-600">
                  No offers match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[9px] text-slate-600 italic">
        Differentials (±) are cents/lb vs the relevant futures month; outright prices show their
        own unit (€/kg · USD/mt · cts/lb). Source: ATTE spot list ·{" "}
        <span className="font-mono">{d.source_url}</span> · login-gated.
      </p>
    </div>
  );
}
