// Certified-stocks period-window helpers (pure; shared by the panel + system
// flow). The period is a [start, end] window anchored to real data dates
// (never the wall clock) so a window is never empty.

const _localISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Local-midnight Date from a "YYYY-MM-DD" string (avoids the UTC-parse drift
// `new Date("2026-06-06")` would introduce in western time zones).
export function parseFlowISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export const flowDateISO = _localISO;

export function flowAnchor(
  arabica: { snapshots?: { date: string }[] } | null,
  robusta: { snapshots?: { date: string }[] } | null,
): Date {
  const dates: string[] = [];
  const a = arabica?.snapshots?.at(-1)?.date; if (a) dates.push(a);
  const r = robusta?.snapshots?.at(-1)?.date; if (r) dates.push(r);
  const max = dates.sort().at(-1);
  if (max) return parseFlowISO(max);
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// Earliest / latest data date across both markets — drives the calendar
// picker's min/max so the user can't scroll past the data we hold.
export function flowDateBounds(
  arabica: { snapshots?: { date: string }[] } | null,
  robusta: { snapshots?: { date: string }[] } | null,
): { min: Date; max: Date } {
  const dates: string[] = [];
  for (const s of arabica?.snapshots ?? []) if (s.date) dates.push(s.date.slice(0, 10));
  for (const s of robusta?.snapshots ?? []) if (s.date) dates.push(s.date.slice(0, 10));
  dates.sort();
  const max = flowAnchor(arabica, robusta);
  const min = dates.length ? parseFlowISO(dates[0]) : max;
  return { min, max };
}

// Start-date menu, all relative to `end`:
//   "w1" → end − 7 days · "m0" → 1st of end's month (month-to-date, default)
//   "m1".."mN" → 1st of each earlier month, back to `minDate`'s month (≤12).
export interface FlowStartOpt { key: string; cutoff: Date; label: string }
export const FLOW_START_DEFAULT = "m0"; // month-to-date

export function flowStartOptions(end: Date, minDate?: Date | null): FlowStartOpt[] {
  const y = end.getFullYear(), m = end.getMonth(), day = end.getDate();
  const opts: { key: string; cutoff: Date }[] = [
    { key: "w1", cutoff: new Date(y, m, day - 7) },
  ];
  const minT = minDate ? new Date(minDate.getFullYear(), minDate.getMonth(), 1).getTime() : -Infinity;
  for (let back = 0; back < 12; back++) {
    const c = new Date(y, m - back, 1);
    if (c.getTime() < minT) break;
    opts.push({ key: `m${back}`, cutoff: c });
  }
  const fmtD = (dt: Date) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return opts.map((o) => ({ ...o, label: fmtD(o.cutoff) }));
}
