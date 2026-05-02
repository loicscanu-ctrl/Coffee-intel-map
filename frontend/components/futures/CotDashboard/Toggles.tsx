"use client";

export function MarketToggle({ markets, set }: { markets: Record<string, boolean>; set: (k: string) => void }) {
  return (
    <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
      {(["ny", "ldn"] as const).map(m => (
        <button key={m} onClick={() => set(m)}
          className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${markets[m] ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
          {m === "ny" ? "NY Arabica" : "LDN Robusta"}
        </button>
      ))}
    </div>
  );
}

export function CatToggles({ cats, set, items }: { cats: Record<string, boolean>; set: (k: string) => void; items: { k: string; l: string; c: string }[] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {items.map(cat => (
        <button key={cat.k} onClick={() => set(cat.k)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase transition-all ${cats[cat.k] ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-transparent border-slate-800 text-slate-600"}`}>
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cats[cat.k] ? cat.c : "transparent", border: cats[cat.k] ? "none" : `1px solid ${cat.c}` }} />
          {cat.l}
        </button>
      ))}
    </div>
  );
}
