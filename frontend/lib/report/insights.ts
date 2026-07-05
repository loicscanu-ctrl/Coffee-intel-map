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
  // Freight
  freight_spot: freightSpot,
  freight_evolution: freightEvolution,
  // Supply — Brazil
  brazil_daily_registration: brazilDaily,
  brazil_monthly_volume: brazilMonthly,
  brazil_annual_trend: brazilAnnual,
  brazil_cumulative_pace: brazilPace,
  brazil_destination: brazilDest,
  brazil_supply_demand: supplyDemand("brazil", "Brazil"),
  brazil_weather_analogs: weatherAnalogs("brazil", "Brazil"),
  brazil_weather_pack: weatherPack("brazil", "Brazil"),
  // Supply — Vietnam & others
  vietnam_monthly_volume: vietnamMonthly,
  vietnam_cumulative_pace: vietnamPace,
  vietnam_annual_volume: vietnamAnnual,
  vietnam_supply_demand: supplyDemand("vietnam", "Vietnam"),
  vietnam_weather_analogs: weatherAnalogs("vietnam", "Vietnam"),
  vietnam_weather_pack: weatherPack("vn", "Vietnam"),
  colombia_weather_pack: weatherPack("colombia", "Colombia"),
  honduras_weather_pack: weatherPack("honduras", "Honduras"),
  ethiopia_weather_pack: weatherPack("ethiopia", "Ethiopia"),
  uganda_weather_pack: weatherPack("uganda", "Uganda"),
  indonesia_weather_pack: weatherPack("indonesia", "Indonesia"),
  enso_oni: enso,
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
  // Macro
  coffee_currency_index: currency,
  origin_farmgate_prices: farmgate,
  fertilizer_inputs: fertilizer,
  news_sentiment: newsSentiment,
  // Vietnam exports (cecafe-style not available — handled generically)
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
