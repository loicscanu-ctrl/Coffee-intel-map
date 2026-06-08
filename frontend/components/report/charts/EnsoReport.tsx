"use client";
/**
 * Report wrapper: ENSO ONI trajectory & closest historical analogs.
 * Renders just the analog chart (current window vs top historical analogs,
 * offset 0 = latest month) from /data/enso.json — not the Leaflet risk map.
 */
import { useEffect, useState } from "react";
import EnsoAnalogChart from "@/components/enso/EnsoAnalogChart";

type AnalogProps = Parameters<typeof EnsoAnalogChart>[0];

export default function EnsoReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  const [props, setProps] = useState<AnalogProps | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/data/enso.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { current_window?: AnalogProps["current"]; analogs?: AnalogProps["analogs"] } | null) => {
        if (j?.current_window && j?.analogs) setProps({ current: j.current_window, analogs: j.analogs });
        else setErr(true);
      })
      .catch(() => setErr(true));
  }, []);

  if (err) return <div className="p-4 text-xs text-slate-500">ENSO data unavailable.</div>;
  if (!props) return <div className="p-4 text-xs text-slate-500">Loading ENSO analogs…</div>;
  return <EnsoAnalogChart {...props} />;
}
