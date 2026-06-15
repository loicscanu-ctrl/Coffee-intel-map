"use client";
/**
 * Report wrappers for per-origin USDA PSD supply & demand balances.
 * SupplyDemandBalance self-fetches /data/demand_stocks.json and keys on origin.
 * Brazil additionally takes the crop-year projection (same as the Supply tab)
 * so the report shows the identical forecast row.
 */
import { useEffect, useState } from "react";
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";
import type { BrazilProjection } from "@/components/supply/BrazilTab/types";

export function BrazilSupplyDemand() {
  const [projection, setProjection] = useState<BrazilProjection | null>(null);
  useEffect(() => {
    fetch("/data/brazil_export_projection.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BrazilProjection | null) => d && setProjection(d))
      .catch(() => { /* non-fatal */ });
  }, []);
  return <SupplyDemandBalance origin="brazil" label="Brazil" projection={projection} />;
}

export function VietnamSupplyDemand() {
  return <SupplyDemandBalance origin="vietnam" label="Vietnam" />;
}
