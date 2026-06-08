"use client";
/**
 * ReportBuilder — the "Shopping Cart for intelligence" on the Daily Brief.
 *
 * Left:  categorized toggles (the cart) sourced from the chart registry.
 * Right: the live ReportCanvas (the preview + the react-to-print target).
 * Top:   "Build Report" → browser-native print dialog (Save as PDF). Native
 *        print keeps Recharts SVG razor-sharp and the file tiny.
 */
import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { REPORT_REGISTRY, REPORT_CATEGORIES } from "@/lib/report/registry";
import { useReportStore } from "@/lib/report/store";
import { PRINT_CSS_LIGHT, PRINT_CSS_DARK } from "@/lib/report/printStyles";
import ReportCanvas from "./ReportCanvas";

type PrintTheme = "light" | "dark";

export default function ReportBuilder() {
  const selectedIds = useReportStore((s) => s.selectedIds);
  const toggle = useReportStore((s) => s.toggle);
  const clear = useReportStore((s) => s.clear);

  // Avoid a hydration mismatch: the persisted cart only exists client-side, so
  // gate the selection-dependent UI until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // PDF theme — light reads better on paper (and saves ink); dark matches the
  // on-screen look. The hook reads the latest options each render, so flipping
  // this swaps the injected print stylesheet.
  const [printTheme, setPrintTheme] = useState<PrintTheme>("light");

  const canvasRef = useRef<HTMLDivElement>(null);
  const printReport = useReactToPrint({
    contentRef: canvasRef,
    documentTitle: `Coffee Intel Map - Market Briefing - ${new Date().toISOString().slice(0, 10)}`,
    pageStyle: printTheme === "light" ? PRINT_CSS_LIGHT : PRINT_CSS_DARK,
  });

  const count = mounted ? selectedIds.length : 0;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Build a Briefing</h2>
          <p className="text-[11px] text-slate-500">
            Tick the visuals you want, annotate each, then export a print-perfect PDF.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* PDF theme toggle */}
          <div className="flex items-center rounded-md border border-slate-700 overflow-hidden" role="group" aria-label="PDF theme">
            {(["light", "dark"] as PrintTheme[]).map((t) => (
              <button
                key={t}
                onClick={() => setPrintTheme(t)}
                aria-pressed={printTheme === t}
                title={t === "light" ? "Light PDF — best for printing" : "Dark PDF — matches the screen"}
                className={`px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  printTheme === t ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {count > 0 && (
            <button
              onClick={clear}
              className="px-2.5 py-1.5 rounded-md text-[11px] font-medium text-slate-400 hover:text-slate-200
                         border border-transparent hover:border-slate-700"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => printReport()}
            disabled={count === 0}
            className="px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed
                       bg-amber-500/10 text-amber-300 border-amber-600/50 hover:bg-amber-500/20"
          >
            Build Report{count > 0 ? ` (${count})` : ""}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 p-4">
        {/* The cart */}
        <div className="space-y-4">
          {REPORT_CATEGORIES.map((cat) => {
            const items = REPORT_REGISTRY.filter((d) => d.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{cat}</div>
                <div className="space-y-1.5">
                  {items.map((d) => {
                    const checked = mounted && selectedIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors
                          ${checked
                            ? "border-amber-600/50 bg-amber-500/5"
                            : "border-slate-800 bg-slate-950/40 hover:border-slate-700"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(d.id)}
                          className="mt-0.5 accent-amber-500"
                        />
                        <span>
                          <span className="block text-xs font-medium text-slate-200">{d.label}</span>
                          {d.description && (
                            <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">
                              {d.description}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* The preview canvas (also the print target). Fixed ~A4 width inside,
            so allow horizontal scroll on narrow screens. */}
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 min-h-[200px] overflow-x-auto">
          <ReportCanvas ref={canvasRef} />
        </div>
      </div>
    </section>
  );
}
