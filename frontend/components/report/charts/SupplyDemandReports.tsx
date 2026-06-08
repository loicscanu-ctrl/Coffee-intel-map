"use client";
/**
 * Report wrappers for per-origin USDA PSD supply & demand balances.
 * SupplyDemandBalance self-fetches /data/demand_stocks.json and keys on origin.
 */
import SupplyDemandBalance from "@/components/supply/SupplyDemandBalance";

export function BrazilSupplyDemand() {
  return <SupplyDemandBalance origin="brazil" label="Brazil" />;
}

export function VietnamSupplyDemand() {
  return <SupplyDemandBalance origin="vietnam" label="Vietnam" />;
}
