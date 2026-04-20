/**
 * useDataFreshness
 * Returns "ok" | "stale" | "unknown" based on how old a timestamp is.
 *
 * Usage:
 *   const status = useDataFreshness(data.scraped_at, 48)
 *   if (status === "stale") show amber badge
 */
"use client";
import { useMemo } from "react";

export type FreshnessStatus = "ok" | "stale" | "unknown";

export function useDataFreshness(
  isoTimestamp: string | null | undefined,
  thresholdHours: number,
): FreshnessStatus {
  return useMemo(() => {
    if (!isoTimestamp) return "unknown";
    const parsed = Date.parse(isoTimestamp);
    if (isNaN(parsed)) return "unknown";
    const hoursOld = (Date.now() - parsed) / 3_600_000;
    return hoursOld > thresholdHours ? "stale" : "ok";
  }, [isoTimestamp, thresholdHours]);
}
