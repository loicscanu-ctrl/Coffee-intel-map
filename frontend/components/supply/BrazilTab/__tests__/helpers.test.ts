import { describe, expect, it } from "vitest";
import {
  bagsToKT, buildFilteredSeries, cropYearKey, fmtBags, getHub,
  intensityColor, monthLabel, offsetYM, shiftMonth, shortMonthLabel, toEn,
} from "../helpers";
import type { CountryYear, VolumeSeries } from "../types";


describe("toEn / getHub", () => {
  it("translates Portuguese country names to English", () => {
    expect(toEn("ALEMANHA")).toBe("Germany");
    expect(toEn("E.U.A.")).toBe("USA");
    expect(toEn("PAISES BAIXOS (HOLANDA)")).toBe("Netherlands");
  });

  it("falls back to the input when no translation exists", () => {
    expect(toEn("UNKNOWN_COUNTRY")).toBe("UNKNOWN_COUNTRY");
    expect(toEn("")).toBe("");
  });

  it("groups countries into hubs", () => {
    expect(getHub("ALEMANHA")).toBe("Central Europe");
    expect(getHub("CHINA")).toBe("East Asia");
    expect(getHub("EGITO")).toBe("North Africa");
  });

  it("returns 'Other' for unknown countries", () => {
    expect(getHub("ATLANTIS")).toBe("Other");
  });
});


describe("bagsToKT", () => {
  it("converts bags to kilotons (60 kg per bag)", () => {
    // 1M bags × 60 kg = 60,000,000 kg = 60 kt
    expect(bagsToKT(1_000_000)).toBe(60);
  });

  it("rounds to one decimal place", () => {
    expect(bagsToKT(123_456)).toBe(7.4);   // 123456 * 60 / 1e6 = 7.40736 → 7.4
    expect(bagsToKT(0)).toBe(0);
  });
});


describe("monthLabel / shortMonthLabel", () => {
  it("returns 3-letter month name from a YYYY-MM string", () => {
    expect(monthLabel("2026-01-15")).toBe("Jan");
    expect(monthLabel("2026-12-01")).toBe("Dec");
  });

  it("formats short month with year (Apr-26 style)", () => {
    expect(shortMonthLabel("2026-04")).toBe("Apr-26");
    expect(shortMonthLabel("2025-11")).toBe("Nov-25");
  });
});


describe("cropYearKey", () => {
  it("groups April–December into the starting crop year", () => {
    expect(cropYearKey("2024-04-15")).toBe("2024/25");
    expect(cropYearKey("2024-12-31")).toBe("2024/25");
  });

  it("groups January–March into the prior crop year", () => {
    expect(cropYearKey("2025-01-01")).toBe("2024/25");
    expect(cropYearKey("2025-03-31")).toBe("2024/25");
  });

  it("flips at the April/March boundary", () => {
    expect(cropYearKey("2025-03-31")).toBe("2024/25");
    expect(cropYearKey("2025-04-01")).toBe("2025/26");
  });
});


describe("shiftMonth", () => {
  it("shifts forward and backward by N months", () => {
    expect(shiftMonth("2026-04", 1)).toBe("2026-05");
    expect(shiftMonth("2026-04", -1)).toBe("2026-03");
    expect(shiftMonth("2026-04", 0)).toBe("2026-04");
  });

  it("crosses year boundaries correctly", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-04", -12)).toBe("2025-04");
  });

  it("zero-pads single-digit months", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    // Crossing into the next year still zero-pads correctly
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});


describe("fmtBags", () => {
  it("uses M suffix for millions", () => {
    expect(fmtBags(1_500_000)).toBe("1.50M");
    expect(fmtBags(2_000_000)).toBe("2.00M");
  });

  it("uses k suffix for thousands", () => {
    expect(fmtBags(12_345)).toBe("12k");
    expect(fmtBags(1_500)).toBe("2k");   // rounded
  });

  it("returns raw number below 1k", () => {
    expect(fmtBags(500)).toBe("500");
    expect(fmtBags(0)).toBe("0");
  });
});


describe("offsetYM", () => {
  it("offsets back by 12 months", () => {
    expect(offsetYM("2026-04", 12)).toBe("2025-04");
    expect(offsetYM("2026-01", 12)).toBe("2025-01");
  });

  it("crosses year boundaries", () => {
    expect(offsetYM("2026-04", 13)).toBe("2025-03");
    expect(offsetYM("2026-04", 24)).toBe("2024-04");
  });
});


describe("intensityColor", () => {
  it("returns the highest-intensity color above 0.9", () => {
    expect(intensityColor(0.95)).toBe("#60a5fa");
    expect(intensityColor(1.0)).toBe("#60a5fa");
  });

  it("returns the lowest-intensity color below 0.2", () => {
    expect(intensityColor(0.0)).toBe("#0f172a");
    expect(intensityColor(0.19)).toBe("#0f172a");
  });

  it("steps through buckets as ratio increases", () => {
    expect(intensityColor(0.21)).toBe("#1e293b");
    expect(intensityColor(0.41)).toBe("#1e3a5f");
    expect(intensityColor(0.61)).toBe("#1d4ed8");
    expect(intensityColor(0.76)).toBe("#2563eb");
    expect(intensityColor(0.91)).toBe("#60a5fa");
  });
});


describe("buildFilteredSeries", () => {
  function mkCY(countries: Record<string, Record<string, number>>): CountryYear {
    return { months: [], countries };
  }

  it("returns an empty array when no country matches", () => {
    const out = buildFilteredSeries(["FRANCA"], {}, mkCY({}), mkCY({}));
    expect(out).toEqual([]);
  });

  it("sums monthly volumes across matching countries and sources", () => {
    const history = {
      "old": mkCY({
        "ALEMANHA": { "2024-01": 100, "2024-02": 200 },
      }),
    };
    const prev    = mkCY({ "ALEMANHA": { "2025-01": 300 } });
    const current = mkCY({ "ALEMANHA": { "2026-01": 400 } });
    const out = buildFilteredSeries(["ALEMANHA"], history, prev, current);
    const byDate: Record<string, VolumeSeries> = {};
    out.forEach(r => { byDate[r.date] = r; });
    expect(byDate["2024-01"].total).toBe(100);
    expect(byDate["2024-02"].total).toBe(200);
    expect(byDate["2025-01"].total).toBe(300);
    expect(byDate["2026-01"].total).toBe(400);
  });

  it("merges volumes when same date appears in multiple sources", () => {
    const history = {
      "h": mkCY({ "ALEMANHA": { "2025-01": 100 } }),
    };
    const prev    = mkCY({ "ALEMANHA": { "2025-01": 200 } });
    const current = mkCY({ "ALEMANHA": { "2025-01": 50 } });
    const out = buildFilteredSeries(["ALEMANHA"], history, prev, current);
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(350);
  });

  it("aggregates across multiple countries", () => {
    const cy = mkCY({
      "ALEMANHA": { "2025-01": 100 },
      "FRANCA":   { "2025-01": 50 },
    });
    const out = buildFilteredSeries(["ALEMANHA", "FRANCA"], {}, cy, cy);
    expect(out).toHaveLength(1);
    // cy is passed twice (as prev AND current), so both contribute
    expect(out[0].total).toBe((100 + 50) * 2);
  });

  it("returns rows sorted by date ascending", () => {
    const cy = mkCY({
      "ALEMANHA": { "2026-01": 1, "2024-06": 2, "2025-09": 3 },
    });
    const out = buildFilteredSeries(["ALEMANHA"], {}, mkCY({}), cy);
    expect(out.map(r => r.date)).toEqual(["2024-06", "2025-09", "2026-01"]);
  });

  it("zeros out type breakdowns (not available across history)", () => {
    const cy = mkCY({ "ALEMANHA": { "2025-01": 100 } });
    const out = buildFilteredSeries(["ALEMANHA"], {}, mkCY({}), cy);
    expect(out[0].arabica).toBe(0);
    expect(out[0].conillon).toBe(0);
    expect(out[0].soluvel).toBe(0);
    expect(out[0].torrado).toBe(0);
    expect(out[0].total_verde).toBe(0);
    expect(out[0].total_industria).toBe(0);
  });
});
