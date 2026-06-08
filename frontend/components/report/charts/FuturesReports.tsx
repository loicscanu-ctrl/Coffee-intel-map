"use client";
/**
 * Report wrappers for futures visuals. OIFndChart self-fetches and switches on
 * its `market` prop, so NY (arabica) and LDN (robusta) are two clean entries.
 */
import OIFndChart from "@/components/futures/OIFndChart";

export function OiFndArabica() {
  return <OIFndChart market="arabica" />;
}

export function OiFndRobusta() {
  return <OIFndChart market="robusta" />;
}
