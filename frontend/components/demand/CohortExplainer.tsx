"use client";
/**
 * Cohort-DNA Implied Outflow — explainer panel.
 *
 * A static walkthrough of the algorithm in cohort_outflow.py:
 * Baseline → grading activity → reported snapshot → implied per-origin
 * decert. Numbers are the worked example from the design doc (Jan/Feb
 * 2026, Vietnam 19 lots / Indonesia 11 lots out) so a reader can match
 * the visual against the algorithm step-by-step.
 *
 * Static by design — this exists to explain the engine, not to read
 * live data. The live numbers live in the production system flow.
 */
import { useEffect } from "react";

// ── Inline SVG icons (no external dep) ───────────────────────────────────────
const SVG = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
const IconCalculator = (p: { className?: string }) => <SVG className={p.className}><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="8" y2="18" /><line x1="12" y1="18" x2="12" y2="18" /><line x1="16" y1="18" x2="16" y2="18" /></SVG>;
const IconFile       = (p: { className?: string }) => <SVG className={p.className}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></SVG>;
const IconActivity   = (p: { className?: string }) => <SVG className={p.className}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></SVG>;
const IconChevron    = (p: { className?: string }) => <SVG className={p.className}><polyline points="9 18 15 12 9 6" /></SVG>;
const IconTruck      = (p: { className?: string }) => <SVG className={p.className}><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></SVG>;
const IconGrid       = (p: { className?: string }) => <SVG className={p.className}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></SVG>;

export default function CohortExplainer() {
  // Inject the conveyor keyframes once — same pattern the system-flow
  // arrows use (style tag in document.head, idempotent across remounts).
  useEffect(() => {
    if (document.getElementById("cohort-conveyor-anim")) return;
    const s = document.createElement("style");
    s.id = "cohort-conveyor-anim";
    s.textContent = `
      @keyframes cohortDriveRight {
        0%   { left: 8px;                opacity: 0; transform: translateY(-50%) scale(0.5); }
        15%  {                           opacity: 1; transform: translateY(-50%) scale(1);   }
        75%  {                           opacity: 1; transform: translateY(-50%) scale(1);   }
        90%  { left: calc(100% - 36px);  opacity: 0; transform: translateY(-50%) scale(0.5); }
        100% { left: calc(100% - 36px);  opacity: 0;                                          }
      }
      .cohort-conveyor { animation: cohortDriveRight 2.2s linear infinite; }
    `;
    document.head.appendChild(s);
  }, []);

  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-6 shadow-lg">
      <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
        <IconCalculator className="w-6 h-6 mr-3 text-emerald-400" />
        Origin Implication Engine
      </h2>
      <p className="text-slate-400 text-sm mb-6">
        ICE doesn&apos;t report the origin of decertified stock, so the engine uses a
        <strong className="text-slate-200"> Cohort Decay Model</strong>: monthly age-bucket
        shrinkage in the ageing report, apportioned by each cohort&apos;s historical grading
        DNA → implied per-origin outflow. Worked example below mirrors the algorithm in
        <code className="text-amber-400/80 ml-1">cohort_outflow.py</code>.
      </p>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* COLUMN 1 — Baseline (Jan 31 RP1) */}
          <div className="bg-slate-950/50 rounded-xl p-5 border border-slate-800/80">
            <div className="flex items-center text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-slate-800 pb-2">
              <IconFile className="w-4 h-4 mr-2" /> Jan 31 (Baseline RP1)
            </div>
            <div className="text-2xl font-mono text-white mb-4">20 <span className="text-sm text-slate-500">Lots Total</span></div>
            <div className="space-y-3">
              <div className="bg-slate-900 p-3 rounded border border-slate-800">
                <div className="text-xs text-slate-400 mb-1 flex justify-between">
                  <span>4 Months Old (Sept &apos;25 Cohort)</span>
                  <span className="text-white font-mono">10 Lots</span>
                </div>
                <div className="flex items-center text-[10px] text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-orange-500 mr-2" /> 100% Indonesia (10)
                </div>
              </div>
              <div className="bg-slate-900 p-3 rounded border border-slate-800">
                <div className="text-xs text-slate-400 mb-1 flex justify-between">
                  <span>12 Months Old (Feb &apos;25 Cohort)</span>
                  <span className="text-white font-mono">10 Lots</span>
                </div>
                <div className="flex items-center text-[10px] text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-teal-500 mr-2" /> 50% Vietnam (5)
                  <span className="w-2 h-2 rounded-full bg-orange-500 mx-2" /> 50% Indonesia (5)
                </div>
              </div>
            </div>
          </div>

          {/* COLUMN 2 — Activity (Feb GP2) */}
          <div className="bg-indigo-950/20 rounded-xl p-5 border border-indigo-900/30 relative">
            <div className="hidden lg:flex absolute top-1/2 -left-4 w-8 h-8 bg-slate-900 border border-slate-700 rounded-full items-center justify-center -translate-y-1/2 z-10">
              <IconChevron className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-center text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 border-b border-indigo-900/50 pb-2">
              <IconActivity className="w-4 h-4 mr-2" /> Feb Grading Activity (GP2)
            </div>
            <div className="text-2xl font-mono text-indigo-100 mb-1">+100 <span className="text-sm text-indigo-400/60">Lots Graded</span></div>
            <div className="mt-4 bg-indigo-950/50 p-3 rounded border border-indigo-900/50">
              <div className="text-xs text-indigo-300 mb-2">New Cohort DNA (Feb &apos;26)</div>
              <div className="flex h-2 w-full rounded overflow-hidden mb-2">
                <div className="bg-teal-500" style={{ width: "75%" }} />
                <div className="bg-orange-500" style={{ width: "25%" }} />
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-teal-400">75% Vietnam (75)</span>
                <span className="text-orange-400">25% Indonesia (25)</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-slate-950/50 border border-slate-800 rounded text-xs text-slate-400 text-center">
              Theoretical Total (TP2): <strong className="text-white">120 Lots</strong>
            </div>
          </div>

          {/* COLUMN 3 — Reported snapshot (Feb 28 RP2) */}
          <div className="bg-slate-950/50 rounded-xl p-5 border border-slate-800/80 relative">
            <div className="hidden lg:flex absolute top-1/2 -left-4 w-8 h-8 bg-slate-900 border border-slate-700 rounded-full items-center justify-center -translate-y-1/2 z-10">
              <IconChevron className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-center text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-slate-800 pb-2">
              <IconFile className="w-4 h-4 mr-2" /> Feb 28 (Reported RP2)
            </div>
            <div className="text-2xl font-mono text-white mb-4">90 <span className="text-sm text-slate-500">Lots Total</span></div>
            <div className="space-y-3">
              <div className="bg-slate-900 p-2 rounded border border-slate-800 flex justify-between items-center">
                <div className="text-[11px] text-slate-400">0 Mos (Feb &apos;26)</div>
                <div className="text-sm font-mono text-white">80 <span className="text-xs text-slate-500">/ 100</span></div>
              </div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800 flex justify-between items-center">
                <div className="text-[11px] text-slate-400">5 Mos (Sept &apos;25)</div>
                <div className="text-sm font-mono text-white">8 <span className="text-xs text-slate-500">/ 10</span></div>
              </div>
              <div className="bg-slate-900 p-2 rounded border border-slate-800 flex justify-between items-center">
                <div className="text-[11px] text-slate-400">13 Mos (Feb &apos;25)</div>
                <div className="text-sm font-mono text-white">2 <span className="text-xs text-slate-500">/ 10</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* RESULT SECTION */}
        <div className="mt-6 bg-rose-950/20 border border-rose-900/30 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-rose-400 font-bold flex items-center">
              <IconTruck className="w-5 h-5 mr-2" /> Total Implied Decertification (30 Lots)
            </h3>
            <span className="text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded">Delta: TP2 (120) − RP2 (90)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
              <div className="text-[10px] text-slate-500 uppercase mb-2">From New Graded (0 mo)</div>
              <div className="text-xl font-mono text-white mb-2">20 Lots</div>
              <div className="flex justify-between text-[10px] border-t border-slate-800 pt-2">
                <span className="text-teal-400">15 Viet <span className="text-slate-600">(75%)</span></span>
                <span className="text-orange-400">5 Indo <span className="text-slate-600">(25%)</span></span>
              </div>
            </div>
            <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
              <div className="text-[10px] text-slate-500 uppercase mb-2">From Sept &apos;25 Cohort (5 mo)</div>
              <div className="text-xl font-mono text-white mb-2">2 Lots</div>
              <div className="flex justify-between text-[10px] border-t border-slate-800 pt-2">
                <span className="text-orange-400">2 Indo <span className="text-slate-600">(100%)</span></span>
              </div>
            </div>
            <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
              <div className="text-[10px] text-slate-500 uppercase mb-2">From Feb &apos;25 Cohort (13 mo)</div>
              <div className="text-xl font-mono text-white mb-2">8 Lots</div>
              <div className="flex justify-between text-[10px] border-t border-slate-800 pt-2">
                <span className="text-teal-400">4 Viet <span className="text-slate-600">(50%)</span></span>
                <span className="text-orange-400">4 Indo <span className="text-slate-600">(50%)</span></span>
              </div>
            </div>
          </div>

          {/* Animated conveyor — Global Storage → 30 Lots Out, with the
              per-origin totals floating above as a chip badge. */}
          <div className="mt-8 mb-2">
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-3 flex items-center justify-center">
              <IconActivity className="w-4 h-4 mr-2 text-rose-400" />
              Final Implied Route Outflow
            </div>
            <div className="flex items-center w-full h-28 relative bg-slate-900/40 rounded-xl p-4 border border-slate-800 overflow-hidden">
              {/* Source: Global Storage */}
              <div className="absolute left-6 bg-slate-800 p-3 rounded-xl border border-slate-700 z-10 flex flex-col items-center shadow-lg shadow-black/50">
                <IconGrid className="w-6 h-6 text-slate-400 mb-1" />
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Global Storage</span>
              </div>

              {/* Conveyor track */}
              <div className="absolute w-full h-[2px] bg-slate-800 top-1/2 -translate-y-1/2 left-0 right-0" />

              {/* Animated blocks */}
              <div className="absolute top-0 bottom-0 left-[90px] right-[90px] overflow-hidden pointer-events-none z-0">
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-teal-500   rounded-sm cohort-conveyor" style={{ animationDelay: "0s",   boxShadow: "0 0 10px rgba(20,184,166,0.5)" }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-orange-500 rounded-sm cohort-conveyor" style={{ animationDelay: "0.4s", boxShadow: "0 0 10px rgba(249,115,22,0.5)" }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-teal-500   rounded-sm cohort-conveyor" style={{ animationDelay: "0.8s", boxShadow: "0 0 10px rgba(20,184,166,0.5)" }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-teal-500   rounded-sm cohort-conveyor" style={{ animationDelay: "1.2s", boxShadow: "0 0 10px rgba(20,184,166,0.5)" }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-orange-500 rounded-sm cohort-conveyor" style={{ animationDelay: "1.6s", boxShadow: "0 0 10px rgba(249,115,22,0.5)" }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-teal-500   rounded-sm cohort-conveyor" style={{ animationDelay: "2.0s", boxShadow: "0 0 10px rgba(20,184,166,0.5)" }} />
              </div>

              {/* Destination: Truck */}
              <div className="absolute right-6 bg-rose-950/40 p-3 rounded-xl border border-rose-900/50 z-10 flex flex-col items-center shadow-lg shadow-rose-900/20">
                <IconTruck className="w-6 h-6 text-rose-400 mb-1" />
                <span className="text-[10px] text-rose-400 uppercase font-bold tracking-wider">30 Lots Out</span>
              </div>

              {/* Floating per-origin badge */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 flex space-x-4 md:space-x-6 font-mono font-bold bg-slate-950 px-4 py-1.5 rounded-full border border-slate-800 shadow-md z-20">
                <span className="text-teal-400   flex items-center text-xs md:text-sm">
                  <span className="w-2.5 h-2.5 rounded bg-teal-500 mr-2" style={{ boxShadow: "0 0 5px rgba(20,184,166,0.8)" }} />
                  19 Vietnam
                </span>
                <span className="text-orange-400 flex items-center text-xs md:text-sm">
                  <span className="w-2.5 h-2.5 rounded bg-orange-500 mr-2" style={{ boxShadow: "0 0 5px rgba(249,115,22,0.8)" }} />
                  11 Indonesia
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer — visual ↔ code crosswalk */}
      <p className="text-[10px] text-slate-600 italic mt-3">
        Walkthrough mirrors <code className="text-slate-500">build_implied_outflow()</code> in
        <code className="text-slate-500 ml-1">backend/scraper/sources/ice_certified_stocks/cohort_outflow.py</code>,
        tested in <code className="text-slate-500">test_implied_outflow_user_example</code>.
      </p>
    </div>
  );
}
