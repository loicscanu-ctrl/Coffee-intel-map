"use client";
// Demand-modelling explainer articles. Each article (text + its own
// diagrams/charts) lives in its own file under ./demand; this is the layout
// shell, mirroring AgronomyArticles.tsx.
import LogisticModel from "./demand/LogisticModel";
import SaturationLimits from "./demand/SaturationLimits";
import MarketCeilings from "./demand/MarketCeilings";

export default function DemandArticles() {
  return (
    <div className="space-y-4">
      <LogisticModel />
      <SaturationLimits />
      <MarketCeilings />
    </div>
  );
}
