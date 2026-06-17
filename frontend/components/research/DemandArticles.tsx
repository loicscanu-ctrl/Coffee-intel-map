"use client";
// Demand-modelling explainer articles. Each article (text + its own
// diagrams/charts) lives in its own file under ./demand; this is the layout
// shell, mirroring AgronomyArticles.tsx.
import LogisticModel from "./demand/LogisticModel";
import SaturationLimits from "./demand/SaturationLimits";

export default function DemandArticles() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <LogisticModel />
      <SaturationLimits />
    </div>
  );
}
