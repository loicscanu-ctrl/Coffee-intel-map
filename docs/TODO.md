# TODO / follow-ups

## CI — verify the sliced 1.4 export (commit 75398fb)
The "1.4 – Export and Publish" workflow now exports only the topic slice tied to
each trigger (and gates `npm ci` + signals to COT-relevant runs). This was
validated locally (py-compile, YAML parse, backward-compatible `main()`), but
**not yet exercised in production**.

To confirm:
- [ ] Run a manual `workflow_dispatch` of 1.4 → should do a FULL export + signals.
- [ ] After the next **2.3 COT Scraper** run, check 1.4 committed only
      `cot.json`/`cot_recent.json`/`macro_cot.json`/`oi_fnd_chart.json` (+ `signals.json`).
- [ ] After the next **1.3 Daily OI** run, check it touched only
      `futures_chain.json`/`oi_fnd_chart.json`/`latest_prices.json` and skipped `npm ci`.
- [ ] After the next **1.1 News** run, check it touched only the news/news-derived
      price files and skipped `npm ci`.
- Safety net: the nightly cron still runs a full export, so a missed file
  self-heals within a day.

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
- [ ] **Honduras May rainfall ~16% of normal is REAL, not a bug** (other 6 origins
      66–123% via the same builder; daily station ~7mm MTD). Likely a genuine
      early-rainy-season deficit — worth a drought-risk flag. Re-check once May is
      complete (figure is month-to-date through ~May 24).
