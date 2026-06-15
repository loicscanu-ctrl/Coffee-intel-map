"use client";
/**
 * Report wrapper for OI Evolution to FND — both markets in one visual, side by
 * side (NY Arabica left, London Robusta right), shrunk to fit two-up. OIFndChart
 * self-fetches per market, so this is pure layout.
 */
import OIFndChart from "@/components/futures/OIFndChart";

export default function OiFndReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  return (
    <div className="grid grid-cols-2 gap-2">
      <OIFndChart market="arabica" height={240} />
      <OIFndChart market="robusta" height={240} />
    </div>
  );
}
