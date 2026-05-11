/**
 * originPrices.ts
 *
 * Computes per-origin price labels for the map's permanent tooltips.
 * Each origin shows three lines: local-currency price, USD equivalent,
 * and the differential vs the matching futures front month (KC for
 * arabica, RC for robusta).
 *
 * Data sources (already on disk under /public/data):
 *   - latest_prices.json  — physical tickers + FX rates
 *   - acaphe_live.json    — KC / RC front-month
 */

export interface OriginPrice {
  countryName: string;     // canonical name for the label header
  matchKeys: string[];     // lowercase substrings that identify a country
                           // pin (e.g. ["vietnam", "viet nam"]). Pin name
                           // is matched case-insensitively against these.
  local: string;           // "88,300 VND/kg"
  usd: string;             // "$3,371/MT"
  diff: string;            // "+50 vs RC"   or  "−120 vs KC"
  diffColor: string;       // CSS color for the diff line
}

/** Find the OriginPrice that matches a country-pin name. Case-insensitive
 *  substring match against the entry's matchKeys, so DB labels like
 *  "Vietnam", "VIETNAM", "Viet Nam", "Brasil" all resolve correctly. */
export function findPriceForPin(prices: OriginPrice[], pinName: string): OriginPrice | undefined {
  const lc = pinName.toLowerCase();
  return prices.find(p => p.matchKeys.some(k => lc.includes(k)));
}

interface Ticker { label: string; value: string; category: string }
interface LatestPrices { tickers: Ticker[] }
interface AcapheLive {
  robusta: Array<{ last: number | null }>;
  arabica: Array<{ last: number | null }>;
}

/** Parse "88.300 VND ($3,371)" → { local: "88.300 VND", usd: 3371 }
 *  Brazilian/Vietnamese style numbers (dot as thousands separator) are
 *  preserved as written.
 */
function parsePhysical(value: string): { localStr: string; usd: number | null } {
  // Split off the parenthesised USD if present
  const usdMatch = value.match(/\$([0-9,.]+)/);
  const usd = usdMatch ? Number(usdMatch[1].replace(/,/g, "")) : null;
  // Everything before the "$" parenthesis is the local-currency part
  const local = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return { localStr: local, usd };
}

/** Arabica futures: ¢/lb → USD/MT. 1 MT = 2204.62 lb, 1¢ = $0.01.
 *  Exported for when arabica-origin pins (Colombia, Honduras, Ethiopia)
 *  are wired up — diff them against KC, not RC.
 */
export function kcCentsToUsdMt(cents: number): number {
  return cents * 22.0462;
}

function fmtDiff(usdPhys: number, benchmarkUsdMt: number): { diff: string; color: string } {
  const d = Math.round(usdPhys - benchmarkUsdMt);
  if (d === 0) return { diff: "flat", color: "#94a3b8" };
  const sign = d > 0 ? "+" : "−";
  return {
    diff: `${sign}${Math.abs(d)} USD`,
    color: d > 0 ? "#22c55e" : "#ef4444",
  };
}

export function computeOriginPrices(
  latest: LatestPrices | null,
  acaphe: AcapheLive | null,
): OriginPrice[] {
  const out: OriginPrice[] = [];
  if (!latest || !acaphe) return out;

  const tickers = new Map(latest.tickers.map(t => [t.label, t.value]));

  // Front-month benchmarks (USD/MT). RC trades natively in USD/MT; KC is
  // ¢/lb and needs conversion (used once arabica-origin pins are wired up).
  const rcFront = acaphe.robusta?.[0]?.last ?? null;

  // ── Vietnam (FAQ — robusta) ─────────────────────────────────────────────
  // Ticker: "VN FAQ" -> "88.300 VND ($3,371)"
  const vn = tickers.get("VN FAQ");
  if (vn && rcFront != null) {
    const { localStr, usd } = parsePhysical(vn);
    if (usd != null) {
      const { diff, color } = fmtDiff(usd, rcFront);
      out.push({
        countryName: "Vietnam",
        matchKeys: ["vietnam", "viet nam"],
        local: `${localStr}/kg`,
        usd:   `$${usd.toLocaleString()}/MT`,
        diff:  `${diff} vs RC`,
        diffColor: color,
      });
    }
  }

  // ── Uganda (Screen 15 — robusta) ────────────────────────────────────────
  // Ticker: "UGA S15" -> "166.93 ($3,680)"  (USD/cwt + USD/MT)
  const uga = tickers.get("UGA S15");
  if (uga && rcFront != null) {
    const { localStr, usd } = parsePhysical(uga);
    if (usd != null) {
      const { diff, color } = fmtDiff(usd, rcFront);
      out.push({
        countryName: "Uganda",
        matchKeys: ["uganda"],
        local: `${localStr} USD/cwt`,
        usd:   `$${usd.toLocaleString()}/MT`,
        diff:  `${diff} vs RC`,
        diffColor: color,
      });
    }
  }

  // ── Brazil Conilon (CON T7 — robusta) ───────────────────────────────────
  // Ticker: "CON T7" -> "870,00 BRL ($2,959)"
  const con = tickers.get("CON T7");
  if (con && rcFront != null) {
    const { localStr, usd } = parsePhysical(con);
    if (usd != null) {
      const { diff, color } = fmtDiff(usd, rcFront);
      out.push({
        countryName: "Brazil",
        matchKeys: ["brazil", "brasil"],
        local: `${localStr}/bag (Conilon)`,
        usd:   `$${usd.toLocaleString()}/MT`,
        diff:  `${diff} vs RC`,
        diffColor: color,
      });
    }
  }

  return out;
}
