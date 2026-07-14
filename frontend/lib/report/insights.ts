"use client";
/**
 * Auto-comment generators for the briefing builder.
 *
 * Each report chart id maps to a builder that fetches the same small JSON the
 * chart reads, extracts a few variables (latest value, change vs prior, trend,
 * threshold flags) and fills a 2–3 sentence rule-based template. ReportCanvas
 * seeds the editable note box with this text; the user can edit or clear it,
 * and an untouched note refreshes as the data updates.
 *
 * SAFETY: every builder is wrapped in try/catch by getInsight — a builder that
 * can't parse its data returns null and the note simply falls back to the empty
 * placeholder. So a wrong field name degrades gracefully, never crashes the UI.
 *
 * Split-note charts (NY/London, Arabica/Robusta) return a Record keyed by the
 * note key; single-note charts return a string.
 */
import { transformApiData } from "@/lib/cot/transformApiData";
import type { CotRawRow } from "@/lib/cot/types";
import { buildMarketMetrics } from "@/lib/pdf/dataHelpers";
import { evaluateSignals } from "@/lib/cot/signalEngine";
import { buildIndonesiaData, type RawIndonesiaExports } from "@/components/supply/IndonesiaExports/data";
import type { IndonesiaExportsData } from "@/components/supply/IndonesiaExports/types";

type Insight = string | Record<string, string> | null;
type Builder = () => Promise<Insight>;

// ── fetch cache (one request per file, shared across notes) ───────────────────
const _cache = new Map<string, Promise<unknown>>();
function load<T = Record<string, unknown>>(path: string): Promise<T | null> {
  if (!_cache.has(path)) {
    _cache.set(path, fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return _cache.get(path)! as Promise<T | null>;
}

// ── format helpers ────────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
};
const kt = (bags: number) => bags * 0.06 / 1000;          // 60-kg bags → kt
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const klots = (lots: number) => `${(lots / 1000).toFixed(1)}k lots`;
const cropKey = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const s = m >= 4 ? y : y - 1;
  return `${s}/${String((s + 1) % 100).padStart(2, "0")}`;
};
const chgPct = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

// ── Brazil (cecafe.json) ──────────────────────────────────────────────────────
interface CecafeRow { date: string; total: number; arabica?: number; conillon?: number; soluvel?: number; }
interface Cecafe { series?: CecafeRow[]; by_country?: Record<string, number>; by_country_prev?: Record<string, number>; updated?: string; }

async function cecafe(): Promise<Cecafe | null> { return load<Cecafe>("/data/cecafe.json"); }

const brazilMonthly: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const latest = s[s.length - 1]; const ya = s[s.length - 13];
  const yoy = ya ? chgPct(latest.total, ya.total) : null;
  const ck = cropKey(latest.date);
  const ctd = s.filter((r) => cropKey(r.date) === ck);
  const months = new Set(ctd.map((r) => r.date.slice(5)));
  const prevCk = `${+ck.slice(0, 4) - 1}/${String((+ck.slice(0, 4)) % 100).padStart(2, "0")}`;
  const prevCtd = s.filter((r) => cropKey(r.date) === prevCk && months.has(r.date.slice(5)));
  const ctdT = ctd.reduce((a, r) => a + r.total, 0);
  const prevT = prevCtd.reduce((a, r) => a + r.total, 0);
  const ctdPct = chgPct(ctdT, prevT);
  return `Brazil shipped **${n1(kt(latest.total))} kt** in ${monthLabel(latest.date)}, **${pct(yoy)}** versus the same month a year earlier. `
    + `Crop-year-to-date (${ck}) exports of **${n1(kt(ctdT))} kt** run **${pct(ctdPct)}** against ${prevCk} at the same point in the season.`;
};

const brazilAnnual: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const r = s[s.length - 1]; const a = r.arabica ?? 0, c = r.conillon ?? 0, so = r.soluvel ?? 0;
  const tot = a + c + so || r.total || 1;
  return `In ${monthLabel(r.date)} the Brazilian export mix was **${(a / tot * 100).toFixed(0)}% arabica**, `
    + `**${(c / tot * 100).toFixed(0)}% conilon** and **${(so / tot * 100).toFixed(0)}% soluble**, on **${n1(kt(r.total))} kt** total. `
    + `Watch the arabica/conilon balance as the crop year progresses for demand-mix and grading signals.`;
};

const brazilPace: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const latest = s[s.length - 1]; const ck = cropKey(latest.date);
  const ctd = s.filter((r) => cropKey(r.date) === ck);
  const months = new Set(ctd.map((r) => r.date.slice(5)));
  const prevCk = `${+ck.slice(0, 4) - 1}/${String((+ck.slice(0, 4)) % 100).padStart(2, "0")}`;
  const prevCtd = s.filter((r) => cropKey(r.date) === prevCk && months.has(r.date.slice(5)));
  const ctdT = ctd.reduce((a, r) => a + r.total, 0), prevT = prevCtd.reduce((a, r) => a + r.total, 0);
  return `Through ${MONTHS[+latest.date.slice(5) - 1]}, ${ck} crop-year exports total **${n1(kt(ctdT))} kt**, `
    + `**${pct(chgPct(ctdT, prevT))}** versus ${prevCk} (${n1(kt(prevT))} kt) at the same stage. `
    + `Cumulative pace ${ctdT >= prevT ? "ahead of" : "behind"} last year points to ${ctdT >= prevT ? "ample" : "tightening"} near-term availability.`;
};

const brazilDest: Builder = async () => {
  const d = await cecafe(); const by = d?.by_country; if (!by) return null;
  const tot = Object.values(by).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) return null;
  const [c0, v0] = top[0];
  const prev0 = d?.by_country_prev?.[c0];
  const mv = prev0 != null ? chgPct(v0, prev0) : null;
  return `Top destination is **${c0}** at **${n1(kt(v0))} kt** (**${(v0 / tot * 100).toFixed(0)}%** of shipments)`
    + `${mv != null ? `, **${pct(mv)}** versus the prior period` : ""}. `
    + `Next largest: ${top.slice(1).map(([c, v]) => `${c} (${(v / tot * 100).toFixed(0)}%)`).join(", ")}.`;
};

const brazilDaily: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const latest = s[s.length - 1];
  return `Daily Cecafé registrations are accumulating through ${monthLabel(latest.date)}; the latest monthly total stands at **${n1(kt(latest.total))} kt** (arabica + conilon). `
    + `Compare the current curve against prior crop years to gauge whether the month is tracking ahead of or behind the seasonal norm.`;
};

// ── Vietnam exports (vietnam_supply.json) ─────────────────────────────────────
interface VnMonth { month: string; total_k_bags?: number; yoy_pct?: number | null; }
async function vnMonthly(): Promise<VnMonth[] | null> {
  const d = await load<{ exports?: { monthly?: VnMonth[] } }>("/data/vietnam_supply.json");
  const m = d?.exports?.monthly;
  return Array.isArray(m) && m.length ? m : null;
}
const vnKt = (kb: number) => kb * 0.06; // thousand 60-kg bags → kt
const vnCrop = (ym: string) => { const [y, m] = ym.split("-").map(Number); const s = m >= 10 ? y : y - 1; return `${s}/${String((s + 1) % 100).padStart(2, "0")}`; };

const vietnamMonthly: Builder = async () => {
  const m = await vnMonthly(); if (!m) return null;
  const last = m[m.length - 1];
  return `Vietnam exported **${n1(vnKt(last.total_k_bags ?? 0))} kt** (${n0(last.total_k_bags ?? 0)}k bags) in ${monthLabel(last.month)}, **${pct(last.yoy_pct ?? null)}** year-on-year. `
    + `As the dominant robusta origin, Vietnam's monthly pace is a primary driver of the London supply picture.`;
};
const vietnamPace: Builder = async () => {
  const m = await vnMonthly(); if (!m) return null;
  const last = m[m.length - 1]; const ck = vnCrop(last.month);
  const ctd = m.filter((r) => vnCrop(r.month) === ck);
  const months = new Set(ctd.map((r) => r.month.slice(5)));
  const prevCk = `${+ck.slice(0, 4) - 1}/${String((+ck.slice(0, 4)) % 100).padStart(2, "0")}`;
  const prevCtd = m.filter((r) => vnCrop(r.month) === prevCk && months.has(r.month.slice(5)));
  const ctdT = ctd.reduce((a, r) => a + (r.total_k_bags ?? 0), 0);
  const prevT = prevCtd.reduce((a, r) => a + (r.total_k_bags ?? 0), 0);
  return `Through ${MONTHS[+last.month.slice(5) - 1]}, ${ck} crop-year (Oct–Sep) exports total **${n1(vnKt(ctdT))} kt**, **${pct(chgPct(ctdT, prevT))}** versus ${prevCk} at the same stage. `
    + `Pace ${ctdT >= prevT ? "ahead of" : "behind"} last year signals ${ctdT >= prevT ? "comfortable" : "tightening"} robusta availability into the marketing year.`;
};
const vietnamAnnual: Builder = async () => {
  const m = await vnMonthly(); if (!m || m.length < 24) return null;
  const last12 = m.slice(-12).reduce((a, r) => a + (r.total_k_bags ?? 0), 0);
  const prev12 = m.slice(-24, -12).reduce((a, r) => a + (r.total_k_bags ?? 0), 0);
  return `Trailing 12-month Vietnamese exports total **${n1(vnKt(last12))} kt**, **${pct(chgPct(last12, prev12))}** versus the prior 12 months. `
    + `The annual trajectory frames how much robusta the world's top producer is releasing across the full cycle.`;
};

// ── COT (cot.json, reuse the dashboard's own metric engine) ───────────────────
async function cotRows() {
  const rows = await load<CotRawRow[]>("/data/cot.json");
  if (!Array.isArray(rows) || !rows.length) return null;
  return transformApiData(rows);
}
function cotMarketLine(data: ReturnType<typeof transformApiData>, mkt: "ny" | "ldn", name: string): string | null {
  const m = buildMarketMetrics(data.slice(-52), data, mkt);
  if (!m) return null;
  const longVerb = m.mmLongChangeLots < 0 ? "trimmed" : m.mmLongChangeLots > 0 ? "added to" : "held";
  const shortVerb = m.mmShortChangeLots > 0 ? "increased" : m.mmShortChangeLots < 0 ? "covered" : "held";
  return `${name}: managed money ${longVerb} longs (**${klots(m.mmLongChangeLots)}**) and ${shortVerb} shorts (**${klots(m.mmShortChangeLots)}**) over the latest COT week, `
    + `with total open interest changing **${klots(m.oiChangeLots)}** and price **${pct(m.priceChangePct)}**. Industry coverage at **${(m.roasterCovPct ?? 0).toFixed(0)}%** of range.`;
}
const cotOverview: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  return {
    ny: cotMarketLine(data, "ny", "NY arabica") ?? "",
    ldn: cotMarketLine(data, "ldn", "London robusta") ?? "",
  };
};
const cotSignals: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const sig = evaluateSignals(data);
  const a = sig.filter((s) => s.severity === "alert").length;
  const w = sig.filter((s) => s.severity === "warn").length;
  const top = sig.find((s) => s.severity === "alert") ?? sig.find((s) => s.severity === "warn");
  return `The rule engine is firing **${a} alert${a === 1 ? "" : "s"}** and **${w} warning${w === 1 ? "" : "s"}** this week. `
    + `${top ? `Lead signal: ${top.name}. ` : ""}Treat clustered same-direction signals as higher-conviction.`;
};
const cotGeneric = (title: string): Builder => async () => {
  const data = await cotRows(); if (!data) return null;
  const ny = buildMarketMetrics(data.slice(-52), data, "ny");
  const ldn = buildMarketMetrics(data.slice(-52), data, "ldn");
  if (!ny || !ldn) return null;
  return `${title} for NY arabica and London robusta. Latest COT week: NY managed-money net change **${klots(ny.mmLongChangeLots - ny.mmShortChangeLots)}**, `
    + `London **${klots(ldn.mmLongChangeLots - ldn.mmShortChangeLots)}**. Read alongside price and open-interest to confirm whether positioning is leading or lagging the move.`;
};

// ── Futures chain (futures_chain.json) ────────────────────────────────────────
interface Contract { contract?: string; last?: number; chg?: number; oi?: number; symbol?: string; }
interface Chain { contracts?: Contract[]; pub_date?: string; }
const dailyQuotes: Builder = async () => {
  const d = await load<{ arabica?: Chain; robusta?: Chain }>("/data/futures_chain.json"); if (!d) return null;
  const line = (c: Chain | undefined, unit: string, dec: number) => {
    // The liquid front is the max-open-interest contract, NOT contracts[0]:
    // near a roll the nearest-expiry contract is a thin, stale-looking print
    // (e.g. KCN26 on ~1 lot) while OI has moved to the next delivery. Quoting
    // [0] put a wrong price in the exported briefing. Mirror MarketTicker.frontByOI.
    const cs = (c?.contracts ?? []).filter(x => x.last != null);
    if (!cs.length) return "";
    const f = cs.reduce((best, x) => (x.oi ?? 0) > (best.oi ?? 0) ? x : best, cs[0]);
    if (f.last == null) return "";
    const dir = (f.chg ?? 0) >= 0 ? "up" : "down";
    return `Front month **${f.symbol?.slice(0, 5) ?? f.contract}** last **${f.last.toFixed(dec)} ${unit}**, ${dir} **${f.chg != null ? Math.abs(f.chg).toFixed(dec) : "—"}** on the day; front open interest **${n0(f.oi ?? 0)}** lots.`;
  };
  return { ny: line(d.arabica, "¢/lb", 2), ldn: line(d.robusta, "$/t", 0) };
};

// ── OI to FND (oi_fnd_chart.json) ─────────────────────────────────────────────
interface Spread { frontLabel?: string; nextLabel?: string; data?: { day: number; spread: number }[]; }
const oiFnd: Builder = async () => {
  const d = await load<{ arabica_front_spread?: Spread; robusta_front_spread?: Spread }>("/data/oi_fnd_chart.json"); if (!d) return null;
  const line = (sp: Spread | undefined, unit: string) => {
    if (!sp?.frontLabel) return "";
    const last = sp.data?.length ? sp.data[sp.data.length - 1].spread : null;
    return `Front contract **${sp.frontLabel}** is rolling its open interest down into First Notice Day${sp.nextLabel ? `, with **${sp.nextLabel}** taking over as the active month` : ""}. `
      + `${last != null ? `Front spread (${sp.frontLabel}–${sp.nextLabel}) at **${last} ${unit}** — watch for an accelerating roll into FND.` : ""}`;
  };
  return { ny: line(d.arabica_front_spread, "¢/lb"), ldn: line(d.robusta_front_spread, "$/t") };
};

// ── Freight (freight.json) ────────────────────────────────────────────────────
interface Route { from?: string; to?: string; rate?: number; prev?: number; unit?: string; }
const freightSpot: Builder = async () => {
  const d = await load<{ routes?: Route[] }>("/data/freight.json"); const rs = d?.routes; if (!rs?.length) return null;
  const moved = rs.map((r) => ({ ...r, mv: chgPct(r.rate ?? 0, r.prev ?? 0) ?? 0 })).sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv));
  const top = moved[0];
  return `Container spot rates across ${rs.length} coffee corridors. Biggest move: **${top.from}→${top.to}** at **${n0(top.rate ?? 0)} ${top.unit ?? ""}** (**${pct(top.mv)}** vs prior reading). `
    + `Rising freight lifts landed cost at destination and can widen origin differentials.`;
};
const freightEvolution: Builder = async () => {
  const d = await load<{ routes?: Route[] }>("/data/freight.json"); const rs = d?.routes; if (!rs?.length) return null;
  const up = rs.filter((r) => (r.rate ?? 0) > (r.prev ?? 0)).length;
  return `Historical freight-rate trend across the key coffee corridors (VN→EU, BR→EU, VN→US, ET→EU). `
    + `Of ${rs.length} tracked routes, **${up}** ${up === 1 ? "is" : "are"} higher than the prior reading — a proxy for shipping-cost pressure feeding into delivered prices.`;
};

// ── Certified stocks (certified_stocks_*.json) ────────────────────────────────
interface CSnap { date: string; total_bags?: number; total_lots_certified?: number; passed_today_bags?: number; failed_today_bags?: number; lots_graded_today?: number; lots_sold_today?: number; }
interface CJson { snapshots?: CSnap[]; as_of?: string; }
function mtdWindow(snaps: CSnap[]) {
  const last = snaps[snaps.length - 1]?.date; if (!last) return snaps.slice(0);
  const ym = last.slice(0, 7);
  return snaps.filter((s) => s.date.slice(0, 7) === ym);
}
const certifiedTiles: Builder = async () => {
  const a = await load<CJson>("/data/certified_stocks_arabica.json");
  const r = await load<CJson>("/data/certified_stocks_robusta.json");
  const out: Record<string, string> = {};
  const aS = a?.snapshots ?? [];
  if (aS.length) {
    const win = mtdWindow(aS);
    const graded = win.reduce((s, x) => s + (x.passed_today_bags ?? 0) + (x.failed_today_bags ?? 0), 0);
    out.arabica = `ICE-certified **arabica** stocks stand at **${n0(aS[aS.length - 1].total_bags ?? 0)} bags** as of ${a?.as_of ?? aS[aS.length - 1].date}, `
      + `with **${n0(graded)} bags** graded month-to-date. ${graded > 0 ? "Active grading is replenishing the deliverable pool." : "Grading activity is quiet this month."}`;
  }
  const rS = r?.snapshots ?? [];
  if (rS.length) {
    const win = mtdWindow(rS);
    const graded = win.reduce((s, x) => s + (x.lots_graded_today ?? 0), 0);
    const sold = win.reduce((s, x) => s + (x.lots_sold_today ?? 0), 0);
    out.robusta = `ICE-certified **robusta** stocks stand at **${n0(rS[rS.length - 1].total_lots_certified ?? 0)} lots** as of ${r?.as_of ?? rS[rS.length - 1].date}, `
      + `with **${n0(graded)} lots** graded and **${n0(sold)} sold** month-to-date.`;
  }
  return Object.keys(out).length ? out : null;
};
const certifiedActivity: Builder = async () => {
  const a = await load<CJson>("/data/certified_stocks_arabica.json");
  const r = await load<CJson>("/data/certified_stocks_robusta.json");
  const ad = a?.snapshots?.at(-1), rd = r?.snapshots?.at(-1);
  if (!ad && !rd) return null;
  return `Recent exchange activity per contract. Arabica certified **${n0(ad?.total_bags ?? 0)} bags** and robusta **${n0(rd?.total_lots_certified ?? 0)} lots** at the latest read. `
    + `Watch gradings (inflow) against decertifications/sales (outflow) for the net direction of deliverable supply.`;
};
const certifiedFlow: Builder = async () => {
  const a = await load<CJson>("/data/certified_stocks_arabica.json"); const aS = a?.snapshots ?? [];
  if (!aS.length) return null;
  const win = mtdWindow(aS);
  const graded = win.reduce((s, x) => s + (x.passed_today_bags ?? 0) + (x.failed_today_bags ?? 0), 0);
  return `Month-to-date certified-stock flow: **${n0(graded)} bags** entered grading. `
    + `The system-flow view nets gradings-in against decertifications-out — a sustained net drawdown is a tightening signal for the deliverable pool.`;
};
const certifiedPeriod = (which: "arabica" | "robusta"): Builder => async () => {
  const j = await load<CJson>(`/data/certified_stocks_${which}.json`); const s = j?.snapshots ?? [];
  if (!s.length) return null;
  const last = s[s.length - 1];
  const total = which === "arabica" ? last.total_bags : last.total_lots_certified;
  const unit = which === "arabica" ? "bags" : "lots";
  return `${which === "arabica" ? "Arabica" : "Robusta"} certified stock totals **${n0(total ?? 0)} ${unit}** as of ${j?.as_of ?? last.date}. `
    + `The period table breaks this into gradings, ageing and ${which === "arabica" ? "decertifications" : "sales/issuance"} so you can see how the balance was built over the window.`;
};

// ── Spot (spot_coffee.json) ───────────────────────────────────────────────────
interface Spot { rows?: { Type?: string }[]; by_type?: Record<string, number>; row_count?: number; as_of?: string; }
const spotTiles: Builder = async () => {
  const d = await load<Spot>("/data/spot_coffee.json"); if (!d?.row_count) return null;
  const bt = d.by_type ?? {};
  const tot = Object.values(bt).reduce((a, b) => a + b, 0) || 1;
  const parts = Object.entries(bt).map(([t, v]) => `${(v / tot * 100).toFixed(0)}% ${t.toLowerCase()}`);
  return `**${d.row_count}** physical spot offers are live as of ${d.as_of ?? "the latest scrape"} (ATTE), split ${parts.join(" / ")} by offer count. `
    + `Spot supply gauges how much physical coffee sellers are pushing to market right now — a near-term availability and differential signal.`;
};
const spotGeneric = (lead: string): Builder => async () => {
  const d = await load<Spot>("/data/spot_coffee.json"); if (!d?.row_count) return null;
  return `${lead} Based on **${d.row_count}** live spot offers as of ${d.as_of ?? "the latest scrape"} (ATTE). `
    + `Use it to spot where physical availability is concentrating and how it compares to exchange-reported stocks.`;
};

// ── ECF (ecf_history.json) ────────────────────────────────────────────────────
interface EcfM { period?: string; value_mt?: number; robusta_mt?: number; }
const ecf: Builder = async () => {
  const d = await load<{ monthly?: EcfM[] }>("/data/ecf_history.json"); const m = d?.monthly; if (!m?.length) return null;
  const last = m[m.length - 1], prev = m[m.length - 2];
  const mv = prev ? chgPct(last.value_mt ?? 0, prev.value_mt ?? 0) : null;
  return `European port stocks (ECF) stood at **${n1((last.value_mt ?? 0) / 1000)} kt** in ${last.period}, **${pct(mv)}** versus the prior reading. `
    + `${last.robusta_mt != null ? `Robusta accounts for **${n1(last.robusta_mt / 1000)} kt** of that. ` : ""}Falling port stocks tighten near-term physical availability in the consuming region.`;
};

// ── Kaffeesteuer (kaffeesteuer.json: {YYYY-MM: value}) ────────────────────────
const kaffee: Builder = async () => {
  const d = await load<Record<string, number>>("/data/kaffeesteuer.json"); if (!d) return null;
  const keys = Object.keys(d).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  if (keys.length < 13) return null;
  const last = keys[keys.length - 1];
  const cur = d[last];
  const avg12 = keys.slice(-13, -1).reduce((a, k) => a + d[k], 0) / 12;
  return `German coffee-tax (Kaffeesteuer) revenue was **${n0(cur)}** in ${monthLabel(last)}, **${pct(chgPct(cur, avg12))}** versus its trailing 12-month average. `
    + `As a near-real-time proxy for German consumption, sustained moves here hint at demand strength or softness in Europe's largest market.`;
};

// ── Currency index (quant_report.json) ────────────────────────────────────────
const currency: Builder = async () => {
  const d = await load<{ currency_index?: { index_value?: number; daily_delta_pct?: number; zscore?: number } }>("/data/quant_report.json");
  const ci = d?.currency_index; if (!ci || ci.index_value == null) return null;
  const z = ci.zscore ?? 0;
  return `The trade-weighted producer-currency index is at **${n1(ci.index_value)}** (**${pct(ci.daily_delta_pct ?? null)}** on the day, z-score **${z.toFixed(1)}**). `
    + `${z > 1 ? "Producer currencies are unusually strong vs USD — supportive of higher local prices and farmer retention." : z < -1 ? "Producer currencies are unusually weak vs USD — incentivising origin selling." : "Producer FX is near its recent norm vs USD."}`;
};

// ── Origin farmgate (origin_prices_history.json) ──────────────────────────────
const farmgate: Builder = async () => {
  const d = await load<{ origins?: Record<string, unknown> }>("/data/origin_prices_history.json");
  const o = d?.origins; if (!o) return null;
  const names = Object.keys(o).map((k) => k.replace(/_/g, " "));
  return `Reindexed farmgate price trends across ${names.join(", ")}. `
    + `Compare the lines to see which origins are seeing the strongest local-price momentum — a driver of farmer selling behaviour and forward availability.`;
};

// ── Fertilizer (farmer_economics.json) ────────────────────────────────────────
interface FertItem { name?: string; price_usd_mt?: number; mom_pct?: number; }
const fertilizer: Builder = async () => {
  const d = await load<{ fertilizer?: { items?: FertItem[] } }>("/data/farmer_economics.json");
  const items = d?.fertilizer?.items; if (!items?.length) return null;
  const parts = items.map((it) => `${it.name} **$${n0(it.price_usd_mt ?? 0)}/MT** (${pct(it.mom_pct ?? null)})`);
  const rising = items.filter((it) => (it.mom_pct ?? 0) > 0).length;
  return `Headline N-P-K input prices: ${parts.join(", ")}. `
    + `${rising >= 2 ? "Broad fertilizer cost pressure squeezes farmer margins and feeds into next-cycle break-even economics." : "Easing input costs support producer margins into the next application window."}`;
};

// ── News sentiment (quant_report.json → sentiment) ────────────────────────────
const newsSentiment: Builder = async () => {
  const d = await load<{ sentiment?: { available?: boolean; net_index?: number; overall_sentiment?: string; overall_confidence?: number; bull_count?: number; bear_count?: number; neutral_count?: number; total?: number } }>("/data/quant_report.json");
  const s = d?.sentiment;
  if (!s?.available || !s.total) return null;
  const net = s.net_index ?? ((s.bull_count ?? 0) - (s.bear_count ?? 0)) / (s.total || 1) * 100;
  const lean = net > 8 ? "bullish" : net < -8 ? "bearish" : "balanced/neutral";
  return `Coffee-news sentiment is **net ${net > 0 ? "+" : ""}${net.toFixed(0)}** (${lean}) across **${s.total}** editorial headlines — `
    + `${s.bull_count ?? 0} bullish / ${s.bear_count ?? 0} bearish / ${s.neutral_count ?? 0} neutral, lead class **${s.overall_sentiment}** at ${(s.overall_confidence ?? 0).toFixed(0)}% confidence. `
    + `A confidence-weighted read of how the latest news flow leans for KC/RC prices.`;
};

// ── ENSO (enso.json) ──────────────────────────────────────────────────────────
const enso: Builder = async () => {
  const d = await load<{ phase?: string; intensity?: string; oni?: number; forecast_direction?: string; analogs?: { year?: number }[] }>("/data/enso.json");
  if (!d?.phase) return null;
  const an = d.analogs?.[0]?.year;
  return `ENSO is in a **${d.phase}${d.intensity ? ` (${d.intensity})` : ""}** state with the latest ONI at **${d.oni ?? "—"}**${d.forecast_direction ? `, forecast to ${d.forecast_direction}` : ""}. `
    + `${an ? `The closest historical analog is **${an}**. ` : ""}ENSO phase shifts rainfall odds across Brazil, Vietnam and Colombia — a leading input to crop-weather risk.`;
};

// ── Weather pack (per origin {origin}_weather.json) ───────────────────────────
interface WxDaily { day: number; accum_mm: number | null; avg_accum_mm?: number; min_accum_mm?: number; max_accum_mm?: number; }
interface Wx { label?: string; updated?: string; station?: string; daily_station?: WxDaily[]; forecast_7d?: { rain_mm?: number }[]; }
const weatherPack = (origin: string, label: string): Builder => async () => {
  const d = await load<Wx>(`/data/${origin}_weather.json`);
  const ds = d?.daily_station;
  if (!Array.isArray(ds) || !ds.length) return null;
  // Latest day with an actual (non-null) accumulation = month-to-date so far.
  const actual = [...ds].reverse().find((r) => r.accum_mm != null);
  if (!actual || actual.accum_mm == null) return null;
  const mtd = actual.accum_mm, avg = actual.avg_accum_mm, lo = actual.min_accum_mm, hi = actual.max_accum_mm;
  const mo = +(d?.updated ?? "").slice(5, 7);
  const monAbbr = mo >= 1 && mo <= 12 ? MONTHS[mo - 1] : "";
  const fc = (d?.forecast_7d ?? []).reduce((a, r) => a + (r.rain_mm ?? 0), 0);
  const vsAvg = avg != null ? chgPct(mtd, avg) : null;
  let zone = "within", risk = "tracking in line with the seasonal norm";
  if (lo != null && mtd < lo) { zone = "below"; risk = "a dry start worth watching for crop-moisture stress"; }
  else if (hi != null && mtd > hi) { zone = "above"; risk = "wetter than normal — flag flowering/harvest disruption risk"; }
  const band = lo != null && hi != null ? `${n0(lo)}–${n0(hi)} mm safe zone` : "seasonal band";
  return `${label} month-to-date rainfall${d?.station ? ` (${d.station})` : ""} is **${n0(mtd)} mm** through ${actual.day} ${monAbbr}`
    + `${avg != null ? ` — **${pct(vsAvg)}** vs the ${n0(avg)} mm normal` : ""}, **${zone}** the ${band}. `
    + `The 7-day forecast adds **${n0(fc)} mm**, ${risk}.`;
};
const weatherAnalogs = (origin: string, label: string): Builder => async () => {
  const d = await load<{ analogs?: { year?: number | string }[] }>(`/data/weather_analogs_${origin}.json`);
  const an = d?.analogs; if (!an?.length) return null;
  const yrs = an.slice(0, 3).map((a) => a.year).filter(Boolean);
  return `The closest historical weather analogs for ${label} are **${yrs.join(", ")}**. `
    + `Their detrended crop outcomes frame a plausible range for this season — useful context for production-risk and balance-sheet scenarios.`;
};

// ── Producer S&D (demand_stocks.json) ─────────────────────────────────────────
const supplyDemand = (key: string, label: string): Builder => async () => {
  const d = await load<{ producers?: Record<string, { latest_year?: string | number; latest_production_mt?: number; latest_exports_mt?: number; latest_stocks_mt?: number }> }>("/data/demand_stocks.json");
  const p = d?.producers?.[key]; if (!p) return null;
  const bits: string[] = [];
  if (p.latest_production_mt != null) bits.push(`production **${n1(p.latest_production_mt / 1000)} kt**`);
  if (p.latest_exports_mt != null) bits.push(`exports **${n1(p.latest_exports_mt / 1000)} kt**`);
  if (p.latest_stocks_mt != null) bits.push(`ending stocks **${n1(p.latest_stocks_mt / 1000)} kt**`);
  if (!bits.length) return null;
  return `USDA PSD balance for **${label}** (${p.latest_year ?? "latest year"}): ${bits.join(", ")}. `
    + `The production-minus-use gap drives the ending-stocks trajectory and, with it, the structural tightness of the origin.`;
};

// ── Brazil type-mix (cecafe.json) ─────────────────────────────────────────────
const brazilTypeShare: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13];
  const share = (row: CecafeRow) => {
    const a = row.arabica ?? 0, c = row.conillon ?? 0, so = row.soluvel ?? 0;
    const t = a + c + so || row.total || 1;
    return { a: a / t * 100, c: c / t * 100, so: so / t * 100 };
  };
  const now = share(r); const then = ya ? share(ya) : null;
  return `Arabica is **${now.a.toFixed(0)}%** of Brazil's export mix in ${monthLabel(r.date)} (conilon ${now.c.toFixed(0)}%, soluble ${now.so.toFixed(0)}%)`
    + `${then ? `, versus **${then.a.toFixed(0)}%** arabica a year earlier` : ""}. `
    + `A rising conilon share signals more robusta-substitutable supply reaching the market.`;
};

const brazilYoyType: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13]; if (!ya) return null;
  const a = chgPct(r.arabica ?? 0, ya.arabica ?? 0);
  const c = chgPct(r.conillon ?? 0, ya.conillon ?? 0);
  const so = chgPct(r.soluvel ?? 0, ya.soluvel ?? 0);
  return `Year-on-year in ${monthLabel(r.date)}: arabica exports **${pct(a)}**, conilon **${pct(c)}**, soluble **${pct(so)}**. `
    + `Diverging growth by type shifts the arabica/robusta balance Brazil is putting on the water.`;
};

const brazilSeasonality: Builder = async () => {
  const d = await cecafe(); const s = d?.series; if (!s?.length) return null;
  const byMonth: Record<number, number[]> = {};
  for (const r of s) { const m = +r.date.slice(5, 7); (byMonth[m] ||= []).push(r.total); }
  const avg = (m: number) => (byMonth[m]?.reduce((x, y) => x + y, 0) ?? 0) / (byMonth[m]?.length || 1);
  const peak = Object.keys(byMonth).map(Number).sort((x, y) => avg(y) - avg(x))[0];
  const latest = s[s.length - 1]; const lm = +latest.date.slice(5, 7);
  const vsNorm = chgPct(latest.total, avg(lm));
  return `Brazil's shipments seasonally peak around **${MONTHS[peak - 1]}**. ${MONTHS[lm - 1]} printed **${n1(kt(latest.total))} kt** this year, `
    + `**${pct(vsNorm)}** versus its multi-year seasonal norm — a read on whether the flow is running hot or cold for the calendar.`;
};

// ── ENSO extras (enso.json) ───────────────────────────────────────────────────
const ensoPlume: Builder = async () => {
  const d = await load<{ oni_forecast?: { season?: string; la_nina?: number; neutral?: number; el_nino?: number }[] }>("/data/enso.json");
  const f = d?.oni_forecast; if (!Array.isArray(f) || !f.length) return null;
  const first = f[0];
  const entries: [string, number | undefined][] = [["La Niña", first.la_nina], ["Neutral", first.neutral], ["El Niño", first.el_nino]];
  const probs = entries.filter((p) => typeof p[1] === "number").sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (!probs.length) return null;
  const [lead, p] = probs[0];
  return `The IRI/CPC plume favours **${lead}** at **${((p ?? 0) * 100).toFixed(0)}%** for ${first.season ?? "the coming season"}. `
    + `The evolving phase probability sets the rainfall-risk backdrop for Brazil, Vietnam and Colombia over the next two quarters.`;
};

const ensoRiskTable: Builder = async () => {
  const d = await load<{ risk?: { summary?: string; pins?: { region?: string; country?: string; level?: string; driver?: string; severity?: number }[] } }>("/data/enso.json");
  const pins = d?.risk?.pins; if (!Array.isArray(pins) || !pins.length) return null;
  const lv = (x: string) => pins.filter((p) => (p.level ?? "").toLowerCase() === x).length;
  const high = lv("high"), mod = lv("moderate");
  const top = [...pins].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))[0];
  return `Of **${pins.length}** tracked growing regions, **${high}** are flagged high-risk and **${mod}** moderate for the coming six months. `
    + `${top?.region ? `**${top.region}${top.country ? `, ${top.country}` : ""}** carries the highest ENSO-driven risk (${top.driver ?? "—"}). ` : ""}`
    + `A regional map of where the current phase most threatens the crop.`;
};

// ── Freight & Port (freight.json / port_activity) ─────────────────────────────
const originFreightCosts: Builder = async () => {
  const d = await load<{ routes?: Route[] }>("/data/freight.json"); const rs = d?.routes; if (!rs?.length) return null;
  const moved = rs.map((r) => ({ ...r, mv: chgPct(r.rate ?? 0, r.prev ?? 0) ?? 0 })).sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv));
  const top = moved[0];
  return `Container freight from the key coffee origins across ${rs.length} routes — biggest move **${top.from}→${top.to}** at **${n0(top.rate ?? 0)} ${top.unit ?? ""}** (**${pct(top.mv)}**). `
    + `The VN→EU vs BR→EU spread is a robusta-vs-arabica logistics-arbitrage signal feeding delivered cost.`;
};

const portActivity: Builder = async () => {
  const d = await load<{ label?: string; country?: string; series?: { date: string; portcalls?: number }[] }>("/data/port_activity/hcmc.json");
  const s = d?.series; if (!Array.isArray(s) || !s.length) return null;
  const last = s[s.length - 1].date; const yr = last.slice(0, 4); const md = last.slice(5);
  const ytd = (y: string) => s.filter((r) => r.date.slice(0, 4) === y && r.date.slice(5) <= md).reduce((a, r) => a + (r.portcalls ?? 0), 0);
  const cur = ytd(yr); const prev = ytd(String(+yr - 1));
  return `**${d?.label ?? "The gateway"}** handled **${n0(cur)}** vessel calls year-to-date, **${pct(chgPct(cur, prev))}** versus the same point last year. `
    + `IMF PortWatch daily calls are a near-real-time proxy for export throughput at the ${d?.country ?? "origin"} coffee gateway.`;
};

// ── Macro (fx / cross-commodity / CPI) ────────────────────────────────────────
const fxTimeseries: Builder = async () => {
  const d = await load<{ pairs?: Record<string, { name?: string; type?: string; history?: { close: number }[] }> }>("/data/fx_history.json");
  const pairs = d?.pairs; if (!pairs) return null;
  const mv = (sym: string, days = 90) => {
    const h = pairs[sym]?.history; if (!h?.length) return null;
    return chgPct(h[h.length - 1].close, h[Math.max(0, h.length - 1 - days)].close);
  };
  const brl = mv("BRL=X"), vnd = mv("VND=X"), cop = mv("COP=X");
  const vals = [brl, vnd, cop].filter((x): x is number => x != null);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length; // USD/local: negative = local stronger
  return `Over ~3 months USD/BRL **${pct(brl)}**, USD/VND **${pct(vnd)}**, USD/COP **${pct(cop)}**. `
    + `${avg < 0 ? "Producer currencies are strengthening vs USD — supportive of higher local prices and farmer retention." : "Producer currencies are weakening vs USD — incentivising origin selling and a headwind for USD-priced futures."}`;
};

const crossCommodity: Builder = async () => {
  const m = await load<{ date: string; commodities?: { symbol: string; close_price?: number }[] }[]>("/data/macro_cot.json");
  if (!Array.isArray(m) || m.length < 5) return null;
  const price = (row: typeof m[number], sym: string) => row.commodities?.find((c) => c.symbol === sym)?.close_price;
  const chg = (sym: string) => { const cur = price(m[m.length - 1], sym), old = price(m[m.length - 5], sym); return cur != null && old != null ? chgPct(cur, old) : null; };
  const ar = chg("arabica"); if (ar == null) return null;
  const su = chg("sugar11"), co = chg("cocoa_ny");
  return `Over the past ~month arabica coffee is **${pct(ar)}**, versus sugar **${pct(su)}** and cocoa **${pct(co)}**. `
    + `When coffee diverges from the softs complex the move is coffee-specific; when it tracks them it's macro / fund flow driving the tape.`;
};

const cpiLatest = (series: Record<string, { name?: string; monthly?: { period: string; yoy_pct?: number | null }[] }> | undefined, key: string) => {
  const m = series?.[key]?.monthly; if (!m?.length) return null;
  const last = [...m].reverse().find((r) => r.yoy_pct != null);
  return last ? { period: last.period, yoy: last.yoy_pct as number } : null;
};

const usCpi: Builder = async () => {
  const d = await load<{ series?: Record<string, { name?: string; monthly?: { period: string; yoy_pct?: number | null }[] }> }>("/data/us_cpi.json");
  const all = cpiLatest(d?.series, "all_items"); const core = cpiLatest(d?.series, "core");
  if (!all) return null;
  return `US CPI ran **${pct(all.yoy)}** year-on-year in ${all.period}${core ? ` (core **${pct(core.yoy)}**)` : ""}. `
    + `${Math.abs(all.yoy - 2) < 0.6 ? "Near the Fed's 2% goal" : all.yoy > 2 ? "Above the Fed's 2% goal" : "Below the Fed's 2% goal"} — the driver of the USD and real-rate backdrop that coffee is priced against.`;
};

const retailCpi: Builder = async () => {
  const d = await load<{ series?: Record<string, { name?: string; monthly?: { period: string; yoy_pct?: number | null }[] }> }>("/data/retail_cpi.json");
  const us = cpiLatest(d?.series, "us_coffee") ?? cpiLatest(d?.series, "us");
  const eu = cpiLatest(d?.series, "eu"); const br = cpiLatest(d?.series, "brazil");
  if (!us) return null;
  const entries: [string, { period: string; yoy: number } | null][] = [["US", us], ["EU", eu], ["Brazil", br]];
  const parts = entries.filter((p) => p[1]).map(([n, v]) => `${n} **${pct(v!.yoy)}**`);
  return `Retail coffee inflation (latest): ${parts.join(", ")} year-on-year. `
    + `Shelf prices lag futures by months, so elevated retail inflation can weigh on consumer demand even after futures cool.`;
};

// ── Signals (quant_report.json / open_direction_history.json) ─────────────────
const priceDirection: Builder = async () => {
  const d = await load<{ open_direction?: { available?: boolean; direction?: string; prob_up?: number; for_session?: string } }>("/data/quant_report.json");
  const od = d?.open_direction; if (!od?.available || od.prob_up == null) return null;
  return `The open-direction model calls **${od.direction}** for ${od.for_session ?? "the next session"} with **P(up) ${(od.prob_up * 100).toFixed(0)}%**. `
    + `A pre-open, out-of-sample classifier on COT positioning, DXY and price momentum — logged before the open, not backfit.`;
};

const openDirectionCalendar: Builder = async () => {
  const rows = await load<{ hit?: boolean | null; status?: string }[]>("/data/open_direction_history.json");
  if (!Array.isArray(rows) || !rows.length) return null;
  const graded = rows.filter((r) => typeof r.hit === "boolean");
  if (!graded.length) return null;
  const hits = graded.filter((r) => r.hit === true).length;
  return `Across **${graded.length}** graded sessions the open-direction model has a **${(hits / graded.length * 100).toFixed(0)}%** hit rate. `
    + `Each call is logged pre-open and graded after the open — a forward, out-of-sample track record rather than an in-sample fit.`;
};

const robustaForecast: Builder = async () => {
  const d = await load<{ robusta_factors?: { available?: boolean; prediction?: { direction?: string; delta_p?: number }; model?: { r_squared?: number; n_obs?: number } } }>("/data/quant_report.json");
  const rf = d?.robusta_factors; if (!rf?.available) return null;
  const p = rf.prediction ?? {}; const m = rf.model ?? {};
  return `The multi-factor OLS model projects robusta **${p.direction}** with ΔP **${p.delta_p ?? "—"} USD/MT** over the next four weeks `
    + `(R² ${m.r_squared != null ? m.r_squared.toFixed(2) : "—"}, n=${m.n_obs ?? "—"}). Positioning, DXY and momentum scored into a single price path.`;
};

// ── COT report (cot.json, reuse metric engine) ────────────────────────────────
const cotReport: Builder = async () => {
  const data = await cotRows(); if (!data) return null;
  const ny = buildMarketMetrics(data.slice(-52), data, "ny");
  const ldn = buildMarketMetrics(data.slice(-52), data, "ldn");
  if (!ny || !ldn) return null;
  return `Automated positioning analysis — latest COT week: NY managed-money net change **${klots(ny.mmLongChangeLots - ny.mmShortChangeLots)}**, `
    + `London **${klots(ldn.mmLongChangeLots - ldn.mmShortChangeLots)}**. The report grades positioning, week-over-week flow, price divergence and crowd risk into an overall directional bias per market.`;
};

// ── ENSO indices (enso_indices.json / enso_subsurface.json) ───────────────────
const ensoDivergence: Builder = async () => {
  const d = await load<{ nino34?: { latest?: { sst_anomaly?: number; phase?: string } }; soi?: { latest?: { soi?: number } } }>("/data/enso_indices.json");
  const n = d?.nino34?.latest; const s = d?.soi?.latest;
  if (!n || n.sst_anomaly == null) return null;
  const phase = (n.phase ?? "").replace(/-/g, " ");
  return `Niño 3.4 SST anomaly at **${n.sst_anomaly >= 0 ? "+" : ""}${n.sst_anomaly}°C**${phase ? ` (${phase})` : ""}${s?.soi != null ? `, with SOI at **${s.soi}**` : ""}. `
    + `The ocean-temperature signal and the SOI atmospheric response together gauge how coupled — and therefore how entrenched — the current ENSO phase is.`;
};

const ensoSubsurface: Builder = async () => {
  const d = await load<{ wwv?: { latest?: { wwv_anomaly?: number; lead_signal?: string }; lead_months?: string } }>("/data/enso_subsurface.json");
  const w = d?.wwv?.latest; if (!w || w.wwv_anomaly == null) return null;
  const lm = d?.wwv?.lead_months ?? "4–6";
  return `Subsurface Warm Water Volume anomaly at **${w.wwv_anomaly >= 0 ? "+" : ""}${w.wwv_anomaly}** (10¹⁴ m³)${w.lead_signal ? `, signalling **${w.lead_signal.replace(/-/g, " ")}**` : ""}. `
    + `WWV leads surface ENSO by ~${lm} months, so a positive anomaly points to El Niño building (negative → La Niña) — an early read on next season's crop-weather odds.`;
};

// ── Demand — consumption & imports (demand_stocks.json / *_coffee_imports.json)
const worldConsumption: Builder = async () => {
  const d = await load<{ world_consumption?: { tracked_consumption_mt?: number; tracked_countries?: number; tracked_latest_year?: number | string; tracked_vs_ico_pct?: number } }>("/data/demand_stocks.json");
  const w = d?.world_consumption; if (!w?.tracked_consumption_mt) return null;
  return `Tracked world coffee consumption is **${n1(w.tracked_consumption_mt / 1e6)} M tonnes** across ${w.tracked_countries ?? "the tracked"} countries (${w.tracked_latest_year ?? "latest year"})`
    + `${w.tracked_vs_ico_pct != null ? `, **${w.tracked_vs_ico_pct.toFixed(0)}%** of the ICO reference total` : ""}. The demand base the global balance is measured against.`;
};

const ageCohort: Builder = async () => {
  const d = await load<{ age_cohort_18plus?: { countries?: Record<string, { annual?: { year: number; pop_18plus?: number }[] }> } }>("/data/demand_stocks.json");
  const c = d?.age_cohort_18plus?.countries; if (!c) return null;
  const names = Object.keys(c); if (!names.length) return null;
  const sumAt = (fromEnd: number) => names.reduce((a, k) => { const arr = c[k].annual ?? []; return a + (arr[arr.length - fromEnd]?.pop_18plus ?? 0); }, 0);
  const last = sumAt(1); const decadeAgo = sumAt(11);
  if (!last || !decadeAgo) return null;
  const yr = (c[names[0]].annual ?? []).at(-1)?.year;
  return `Across **${names.length}** tracked markets the coffee-drinking-age (18+) population has grown **${pct(chgPct(last, decadeAgo))}** over the past decade${yr ? ` (to ${yr})` : ""}. `
    + `A structural tailwind for consumption that is largely independent of the price cycle.`;
};

interface ImportsJson { total_by_year?: Record<string, number>; origins?: { name?: string; latest_mt?: number }[]; }
const importsByOrigin = (src: string, label: string): Builder => async () => {
  const d = await load<ImportsJson>(src); const tby = d?.total_by_year; const origins = d?.origins;
  if (!tby || !Array.isArray(origins) || !origins.length) return null;
  const years = Object.keys(tby).sort(); const ly = years[years.length - 1]; const py = years[years.length - 2];
  const total = tby[ly]; if (total == null) return null;
  const top = [...origins].sort((a, b) => (b.latest_mt ?? 0) - (a.latest_mt ?? 0))[0];
  const share = top?.latest_mt != null ? top.latest_mt / total * 100 : null;
  const yoy = py != null ? chgPct(total, tby[py]) : null;
  return `${label} imported **${n1(total / 1000)} kt** of green coffee in ${ly}${yoy != null ? ` (**${pct(yoy)}** YoY)` : ""}. `
    + `${top?.name ? `Top origin **${top.name}**${share != null ? ` at **${share.toFixed(0)}%**` : ""} of the total. ` : ""}Origin concentration is a supply-security and differential signal for the importing bloc.`;
};

// ── Uganda exports (uganda_monthly.json) ──────────────────────────────────────
interface UgRow { month: string; total_bags?: number; robusta_bags?: number; arabica_bags?: number; by_destination?: { country?: string; bags?: number }[]; }
async function ugSeries(): Promise<UgRow[] | null> {
  const d = await load<{ series?: UgRow[] }>("/data/uganda_monthly.json");
  return Array.isArray(d?.series) && d!.series!.length ? d!.series! : null;
}
const ugKt = (bags: number) => bags * 6e-5; // raw 60-kg bags → kt

const ugandaMonthly: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const last = s[s.length - 1]; const ya = s[s.length - 13];
  const yoy = ya ? chgPct(last.total_bags ?? 0, ya.total_bags ?? 0) : null;
  const rob = last.robusta_bags ?? 0, ara = last.arabica_bags ?? 0; const tot = last.total_bags || (rob + ara) || 1;
  return `Uganda exported **${n1(ugKt(last.total_bags ?? 0))} kt** in ${monthLabel(last.month)}${yoy != null ? ` (**${pct(yoy)}** YoY)` : ""}, `
    + `**${(rob / tot * 100).toFixed(0)}% robusta / ${(ara / tot * 100).toFixed(0)}% arabica**. Africa's top robusta exporter — a key London-market supply read.`;
};
const ugandaPace: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const last = s[s.length - 1]; const ck = vnCrop(last.month);
  const ctd = s.filter((r) => vnCrop(r.month) === ck); const months = new Set(ctd.map((r) => r.month.slice(5)));
  const prevCk = `${+ck.slice(0, 4) - 1}/${String((+ck.slice(0, 4)) % 100).padStart(2, "0")}`;
  const prevCtd = s.filter((r) => vnCrop(r.month) === prevCk && months.has(r.month.slice(5)));
  const ctdT = ctd.reduce((a, r) => a + (r.total_bags ?? 0), 0), prevT = prevCtd.reduce((a, r) => a + (r.total_bags ?? 0), 0);
  return `Through ${MONTHS[+last.month.slice(5) - 1]}, ${ck} crop-year (Oct–Sep) exports total **${n1(ugKt(ctdT))} kt**, **${pct(chgPct(ctdT, prevT))}** versus ${prevCk} at the same stage. `
    + `Pace ${ctdT >= prevT ? "ahead of" : "behind"} last year gauges robusta availability into the marketing year.`;
};
const ugandaAnnual: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const ck = vnCrop(s[s.length - 1].month); const ctd = s.filter((r) => vnCrop(r.month) === ck);
  const rob = ctd.reduce((a, r) => a + (r.robusta_bags ?? 0), 0), ara = ctd.reduce((a, r) => a + (r.arabica_bags ?? 0), 0);
  const tot = rob + ara || 1;
  return `In ${ck} crop-year-to-date, Uganda's exports are **${(rob / tot * 100).toFixed(0)}% robusta** (${n1(ugKt(rob))} kt) and **${(ara / tot * 100).toFixed(0)}% arabica** (${n1(ugKt(ara))} kt). `
    + `The robusta/arabica split decides which futures market the origin feeds.`;
};
const ugandaTypeShare: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const last = s[s.length - 1]; const rob = last.robusta_bags ?? 0, ara = last.arabica_bags ?? 0; const tot = rob + ara || 1;
  const ya = s[s.length - 13];
  const yaRob = ya ? (ya.robusta_bags ?? 0) / ((ya.robusta_bags ?? 0) + (ya.arabica_bags ?? 0) || 1) * 100 : null;
  return `Robusta is **${(rob / tot * 100).toFixed(0)}%** of Uganda's export mix in ${monthLabel(last.month)}${yaRob != null ? `, versus ${yaRob.toFixed(0)}% a year earlier` : ""}. `
    + `The robusta share tracks how much London-deliverable supply Uganda is contributing.`;
};
const ugandaDest: Builder = async () => {
  const s = await ugSeries(); if (!s) return null;
  const last = [...s].reverse().find((r) => Array.isArray(r.by_destination) && r.by_destination!.length);
  const bd = last?.by_destination; if (!bd?.length) return null;
  const tot = bd.reduce((a, r) => a + (r.bags ?? 0), 0) || 1;
  const top = [...bd].sort((a, b) => (b.bags ?? 0) - (a.bags ?? 0)).slice(0, 3);
  return `Top destination **${top[0].country}** at **${((top[0].bags ?? 0) / tot * 100).toFixed(0)}%** of ${monthLabel(last!.month)} exports; `
    + `next: ${top.slice(1).map((t) => `${t.country} (${((t.bags ?? 0) / tot * 100).toFixed(0)}%)`).join(", ")}. Destination concentration maps Uganda's key buyer relationships.`;
};

// ── Indonesia exports (indonesia_exports.json → buildIndonesiaData) ────────────
async function indoData(): Promise<IndonesiaExportsData | null> {
  const raw = await load<RawIndonesiaExports>("/data/indonesia_exports.json");
  if (!raw) return null;
  try { return buildIndonesiaData(raw); } catch { return null; }
}
const idKt = (kg: number) => kg / 1e6; // kg → kt
type IdRow = { date: string; total: number; arabica: number; robusta: number; other: number };

const indoMonthly: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const last = s[s.length - 1]; const ya = s[s.length - 13];
  const yoy = ya ? chgPct(last.total, ya.total) : null;
  return `Indonesia exported **${n1(idKt(last.total))} kt** in ${monthLabel(last.date)}${yoy != null ? ` (**${pct(yoy)}** YoY)` : ""}. `
    + `A dual arabica/robusta origin whose monsoon-driven crop feeds both the KC and RC markets.`;
};
const indoPace: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const last = s[s.length - 1]; const ck = cropKey(last.date);
  const ctd = s.filter((r) => cropKey(r.date) === ck); const months = new Set(ctd.map((r) => r.date.slice(5)));
  const prevCk = `${+ck.slice(0, 4) - 1}/${String((+ck.slice(0, 4)) % 100).padStart(2, "0")}`;
  const prevCtd = s.filter((r) => cropKey(r.date) === prevCk && months.has(r.date.slice(5)));
  const ctdT = ctd.reduce((a, r) => a + r.total, 0), prevT = prevCtd.reduce((a, r) => a + r.total, 0);
  return `Through ${MONTHS[+last.date.slice(5) - 1]}, ${ck} crop-year exports total **${n1(idKt(ctdT))} kt**, **${pct(chgPct(ctdT, prevT))}** versus ${prevCk} at the same stage.`;
};
const indoAnnual: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const r = s[s.length - 1]; const tot = r.arabica + r.robusta + r.other || r.total || 1;
  return `In ${monthLabel(r.date)} Indonesia's export mix was **${(r.arabica / tot * 100).toFixed(0)}% arabica**, `
    + `**${(r.robusta / tot * 100).toFixed(0)}% robusta** and **${(r.other / tot * 100).toFixed(0)}% other**, on **${n1(idKt(r.total))} kt**. Robusta dominance ties Indonesia to the London market.`;
};
const indoTypeShare: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13]; const tot = r.arabica + r.robusta + r.other || 1;
  const yaRob = ya ? ya.robusta / (ya.arabica + ya.robusta + ya.other || 1) * 100 : null;
  return `Robusta is **${(r.robusta / tot * 100).toFixed(0)}%** of Indonesia's export mix in ${monthLabel(r.date)}${yaRob != null ? `, versus ${yaRob.toFixed(0)}% a year earlier` : ""}. `
    + `The arabica/robusta balance shows which market Indonesian supply lands in.`;
};
const indoYoy: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const r = s[s.length - 1]; const ya = s[s.length - 13]; if (!ya) return null;
  return `Year-on-year in ${monthLabel(r.date)}: arabica **${pct(chgPct(r.arabica, ya.arabica))}**, robusta **${pct(chgPct(r.robusta, ya.robusta))}**. `
    + `Diverging growth by type shifts the arabica/robusta balance Indonesia supplies.`;
};
const indoSeasonality: Builder = async () => {
  const d = await indoData(); const s = d?.series as IdRow[] | undefined; if (!s?.length) return null;
  const byMonth: Record<number, number[]> = {};
  for (const r of s) { const m = +r.date.slice(5, 7); (byMonth[m] ||= []).push(r.total); }
  const avg = (m: number) => (byMonth[m]?.reduce((x, y) => x + y, 0) ?? 0) / (byMonth[m]?.length || 1);
  const peak = Object.keys(byMonth).map(Number).sort((x, y) => avg(y) - avg(x))[0];
  const last = s[s.length - 1]; const lm = +last.date.slice(5, 7);
  return `Indonesia's shipments seasonally peak around **${MONTHS[peak - 1]}**. ${MONTHS[lm - 1]} printed **${n1(idKt(last.total))} kt**, **${pct(chgPct(last.total, avg(lm)))}** versus its seasonal norm.`;
};
const indoDest: Builder = async () => {
  const d = await indoData();
  const cc = d?.by_country?.countries; if (!cc) return null; // CountryYear.countries: ctr → ym → kg
  const totals = Object.entries(cc)
    .map(([c, months]) => [c, Object.values(months || {}).reduce((a, b) => a + (b || 0), 0)] as [string, number])
    .filter(([, v]) => v > 0);
  if (!totals.length) return null;
  const grand = totals.reduce((a, [, v]) => a + v, 0) || 1;
  const top = totals.sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `Top destination is **${top[0][0]}** at **${(top[0][1] / grand * 100).toFixed(0)}%** of shipments; `
    + `next ${top.slice(1).map(([c, v]) => `${c} (${(v / grand * 100).toFixed(0)}%)`).join(", ")}. Where Indonesian coffee lands shapes its regional differential.`;
};

// ── Vietnam destination (vn_export_by_destination.json) ───────────────────────
const vietnamDest: Builder = async () => {
  const d = await load<{ countries?: Record<string, Record<string, number>> }>("/data/vn_export_by_destination.json");
  const c = d?.countries; if (!c) return null;
  const totals = Object.entries(c).map(([country, months]) => [country, Object.values(months).reduce((a, b) => a + (b || 0), 0)] as [string, number]);
  const grand = totals.reduce((a, [, v]) => a + v, 0) || 1;
  const top = totals.sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) return null;
  return `Top destination for Vietnamese coffee: **${top[0][0]}** at **${(top[0][1] / grand * 100).toFixed(0)}%** of tracked volume; `
    + `next ${top.slice(1).map(([n, v]) => `${n} (${(v / grand * 100).toFixed(0)}%)`).join(", ")}. Buyer concentration for the world's top robusta exporter.`;
};

// ── Brazil frost & drought risk (farmer_economics.json → weather) ─────────────
const brazilWeatherRisk: Builder = async () => {
  const d = await load<{ weather?: { regions?: { name?: string; frost?: string; drought?: string }[] } }>("/data/farmer_economics.json");
  const rg = d?.weather?.regions; if (!Array.isArray(rg) || !rg.length) return null;
  const frostAt = rg.filter((r) => r.frost && r.frost.toUpperCase() !== "NONE");
  const droughtHi = rg.filter((r) => ["HIGH", "MED", "H", "M"].includes((r.drought ?? "").toUpperCase()));
  const worst = frostAt[0];
  return `Across ${rg.length} Brazil growing regions, **${frostAt.length}** show frost risk and **${droughtHi.length}** elevated drought (CSI) risk in the forecast window`
    + `${worst?.name ? `; ${worst.name} flags frost **${worst.frost}**` : ""}. Frost and drought are the two dominant weather threats to the arabica crop.`;
};

// ── id → builder map ──────────────────────────────────────────────────────────
const INSIGHTS: Record<string, Builder> = {
  // Futures
  daily_quotes: dailyQuotes,
  cot_overview: cotOverview,
  oi_fnd: oiFnd,
  cot_heatmap: cotGeneric("Rolling 13-week positioning-signal heatmap"),
  cot_gauges: cotGeneric("52-week positioning gauges"),
  cot_global_flow: cotGeneric("Cross-market managed-money flow"),
  cot_industry_pulse: cotGeneric("Industry coverage in metric tons"),
  cot_dry_powder: cotGeneric("Dry-powder positioning (room to add vs extremes)"),
  cot_cycle_location: cotGeneric("Overbought/oversold cycle-location matrix"),
  cot_signals: cotSignals,
  cot_report: cotReport,
  // Freight
  freight_spot: freightSpot,
  freight_evolution: freightEvolution,
  port_activity: portActivity,
  origin_freight_costs: originFreightCosts,
  // Supply — Brazil
  brazil_daily_registration: brazilDaily,
  brazil_monthly_volume: brazilMonthly,
  brazil_annual_trend: brazilAnnual,
  brazil_cumulative_pace: brazilPace,
  brazil_destination: brazilDest,
  brazil_type_share: brazilTypeShare,
  brazil_yoy_type: brazilYoyType,
  brazil_seasonality: brazilSeasonality,
  brazil_supply_demand: supplyDemand("brazil", "Brazil"),
  brazil_weather_analogs: weatherAnalogs("brazil", "Brazil"),
  brazil_weather_pack: weatherPack("brazil", "Brazil"),
  brazil_weather_risk: brazilWeatherRisk,
  // Supply — Vietnam & others
  vietnam_monthly_volume: vietnamMonthly,
  vietnam_cumulative_pace: vietnamPace,
  vietnam_annual_volume: vietnamAnnual,
  vietnam_destination: vietnamDest,
  vietnam_supply_demand: supplyDemand("vietnam", "Vietnam"),
  vietnam_weather_analogs: weatherAnalogs("vietnam", "Vietnam"),
  vietnam_weather_pack: weatherPack("vn", "Vietnam"),
  colombia_weather_pack: weatherPack("colombia", "Colombia"),
  honduras_weather_pack: weatherPack("honduras", "Honduras"),
  ethiopia_weather_pack: weatherPack("ethiopia", "Ethiopia"),
  uganda_monthly_volume: ugandaMonthly,
  uganda_cumulative_pace: ugandaPace,
  uganda_annual_trend: ugandaAnnual,
  uganda_type_share: ugandaTypeShare,
  uganda_destination: ugandaDest,
  uganda_weather_pack: weatherPack("uganda", "Uganda"),
  indonesia_monthly_volume: indoMonthly,
  indonesia_cumulative_pace: indoPace,
  indonesia_annual_trend: indoAnnual,
  indonesia_type_share: indoTypeShare,
  indonesia_yoy_type: indoYoy,
  indonesia_seasonality: indoSeasonality,
  indonesia_destination: indoDest,
  indonesia_weather_pack: weatherPack("indonesia", "Indonesia"),
  enso_oni: enso,
  enso_plume: ensoPlume,
  enso_risk_table: ensoRiskTable,
  enso_divergence: ensoDivergence,
  enso_subsurface: ensoSubsurface,
  // Demand
  certified_stocks_tiles: certifiedTiles,
  certified_stocks_activity: certifiedActivity,
  certified_stocks_flow: certifiedFlow,
  certified_stocks_period_arabica: certifiedPeriod("arabica"),
  certified_stocks_period_robusta: certifiedPeriod("robusta"),
  spot_tiles: spotTiles,
  spot_origin_port: spotGeneric("Where each origin's offered spot volume sits across European ports."),
  spot_ecf: spotGeneric("Offered spot volume as a share of ECF reported European port stocks."),
  spot_square_map: spotGeneric("Each square is roughly one lot, coloured by origin and crop-year freshness."),
  ecf_port_stocks: ecf,
  kaffeesteuer: kaffee,
  world_consumption: worldConsumption,
  age_cohort: ageCohort,
  us_imports_origin: importsByOrigin("/data/us_coffee_imports.json", "The US"),
  eu_imports_origin: importsByOrigin("/data/eu_coffee_imports.json", "The EU"),
  // Macro
  coffee_currency_index: currency,
  origin_farmgate_prices: farmgate,
  fertilizer_inputs: fertilizer,
  fx_timeseries: fxTimeseries,
  cross_commodity: crossCommodity,
  us_cpi: usCpi,
  retail_cpi: retailCpi,
  // Macro — Signals
  news_sentiment: newsSentiment,
  price_direction: priceDirection,
  open_direction_calendar: openDirectionCalendar,
  robusta_forecast: robustaForecast,
};

/**
 * Resolve the auto-comment for a note id (`chartId` or `chartId__noteKey`).
 * Returns null on any failure so the caller falls back to the empty placeholder.
 */
export async function getInsight(noteId: string): Promise<string | null> {
  const [id, key] = noteId.split("__");
  const fn = INSIGHTS[id];
  if (!fn) return null;
  try {
    const r = await fn();
    if (r == null) return null;
    if (typeof r === "string") return r.trim() || null;
    const picked = key ? r[key] : Object.values(r)[0];
    return (picked ?? "").trim() || null;
  } catch {
    return null;
  }
}
