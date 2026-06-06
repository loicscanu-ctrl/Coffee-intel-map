"use client";
import UsCpiPanel from "@/components/macro/UsCpiPanel";
import RetailCpiPanel from "@/components/macro/RetailCpiPanel";

/**
 * Inflation section — groups the consumer-price panels top-down: broad headline
 * CPI (the macro regime) → coffee-specific CPI (how much of a spike reaches the
 * shelf). Today this covers the US headline plus the multi-region coffee panel;
 * the structure is built to grow per-market (EU, Japan, Brazil) brick by brick.
 */
export default function InflationSection() {
  return (
    <section>
      <div className="px-4 pt-5 pb-1">
        <h2 className="text-lg font-bold text-white">Inflation</h2>
        <p className="text-xs text-slate-400 max-w-3xl">
          Consumer-price inflation from the top down — headline CPI sets the macro regime
          (Fed path · USD · real rates), then we drill into coffee-specific CPI to gauge how
          much of any spike actually reaches the shelf. Starting with the US; EU, Japan and
          Brazil (the major consuming markets) to follow.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-slate-800/60">
        <UsCpiPanel />
        <RetailCpiPanel />
      </div>
    </section>
  );
}
