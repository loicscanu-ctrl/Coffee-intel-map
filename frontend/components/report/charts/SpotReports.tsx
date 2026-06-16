"use client";
/**
 * Report wrappers for the Spot (physical market) sub-sections. Each renders the
 * real SpotPanel in a single-section mode (it self-fetches and uses its default
 * unit), so the briefing tracks the Demand → Spot tab.
 */
import SpotPanel from "@/components/demand/SpotPanel";

export const SpotTiles      = () => <SpotPanel section="tiles" />;
export const SpotOriginPort = () => <SpotPanel section="origin_port" />;
export const SpotEcf        = () => <SpotPanel section="ecf" />;
export const SpotSquareMap  = () => <SpotPanel section="square_map" />;
