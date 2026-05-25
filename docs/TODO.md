# TODO / follow-ups

## Brazil farmer-selling (Safras) — verify the fixes (commits cf79f51 + 51c9e88)
ROOT CAUSE FOUND (via the new export log): `_find_latest_article_url` returned the
first DOM sales link — a featured **July 2025 '31% of 2025/26'** post — and the
crop-year guard correctly skipped it (31% « stored 83%), so data froze at 2026-04-14.
Fixes: (a) collect ALL candidate articles and pick the most-recent by
(crop_year, crop-month, survey day); (b) crop-year-aware guard accepts a new-crop
reset; (c) export now logs each candidate + the selected one.
**Verify after the next 1.4 run:**
- [ ] Log shows multiple `candidate …` lines and a `Selected most-recent article …`.
- [ ] If the newest Safras survey > April 2026, `farmer_selling_brazil.json` updates
      (report_date advances, % reflects it). If April is still newest, it stays 83%/77%
      (correct — not a bug).

## CI — sliced 1.4 export (commit 75398fb) — mechanism VERIFIED in production
The "1.4 – Export and Publish" workflow exports only the topic slice tied to each
trigger and gates `npm ci` + signals to COT-relevant runs.

- [x] **News slice CONFIRMED.** Commit `4cac0f0` (1.4 run, 2026-05-25 09:32)
      touched exactly `news.json`, `latest_prices.json`, `vn_physical_prices.json`
      + `health.json` (always-on) and **no `signals.json`** — i.e. it sliced to the
      news topics, skipped the other ~18, and kept the npm/signals gate off. Proves
      the scope-decision, `--only` filter, health-always-runs, and signals-gating.
- [ ] **COT slice** — confirm on the next 2.3 run: commits only
      `cot.json`/`cot_recent.json`/`macro_cot.json`/`oi_fnd_chart.json` (+ `signals.json`).
      (Same mechanism as the verified news path, different topic list.)
- [x] **Daily-OI slice CONFIRMED.** Commit `086c803` (1.4 fired by a manual 1.3,
      2026-05-25 11:16) touched only `latest_prices.json` + `health.json`
      (`futures_chain`/`oi_fnd_chart` re-exported but unchanged) — no `signals.json`,
      none of the other ~18 topics. Scoping + npm/signals gating confirmed.
- [ ] **Full export** — confirm a cron/dispatch run still writes everything + signals.
- Safety net: the nightly cron runs a full export, so a missed file self-heals.

## Weather — backend follow-ups (frontend rendering fixed in WeatherCharts)
Frontend now renders missing months as gaps (not 0) and shows per-region crop
share in the filter. Remaining items are in the data pipeline:

- [x] **Vietnam weather stale — DONE & verified.** `vn` added to the daily
      pipeline; `vn_weather.json` now `updated=2026-05-25` with a `weather_history/vn.json`
      created. Refreshes daily; freshness blind spot resolved.
- [x] **Backfill Jan/early-Feb 2026 — DONE & verified.** Archive reachable from
      CI; after the region-resilience + fill-null-fields + merge-upsert fixes, the
      re-run filled all 7 origins with complete Jan–May rain AND temperature (no
      gaps). Daily accumulation preserves it going forward.
- [ ] **Temp gap for 2 provinces — RE-RUN 0.4 backfill.** Ethiopia/Jimma (Jan-Mar)
      and Honduras/Copán (Feb-Mar) still have null temp because those archive cells
      returned a null `temperature_2m_mean` (rain was fine), and the chart blanks a
      month if any selected province is null. FIX (committed): backfill + daily
      fetch now fall back to `(tmax+tmin)/2` when the mean is null. Re-dispatch
      "0.4 – Backfill weather history" to fill them.
- [x] **Monthly Rainfall current-month now projected to month-end** (weighted,
      same basis as the cumulative chart) so the partial month is comparable to the
      full-month climatology — fixes the "VN 112.5 vs daily 129.9" confusion. The
      residual weighted-vs-Dak-Lak-station difference is by design (daily chart is
      single-station).
- [x] **Production-at-risk readout** added — surfaces the % of selected production
      whose projected current-month rainfall is in its drought-risk zone, naming the
      regions (counters weighted-average masking). Frontend-only, live.
- [x] **Daily Accumulated chart prod-weighted — DONE & verified.** After the 0.4
      run, all 7 origins have populated per-province `daily_accum_cur` (through
      day 25), so the daily chart now weights across selected regions and responds
      to the filter. `daily_accum_ly` is empty (no 2025 daily history) → last-year
      line uses the climatology fallback, as designed.
- [ ] **Honduras May rainfall ~16% of normal is REAL, not a bug** (other 6 origins
      66–123% via the same builder; daily station ~7mm MTD). Likely a genuine
      early-rainy-season deficit — worth a drought-risk flag. Re-check once May is
      complete (figure is month-to-date through ~May 24).
