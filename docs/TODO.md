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

- [ ] **Vietnam weather is stale & not auto-refreshed.** `vn_weather.json` is a
      static seed (`backend/scripts/seed_origin_weather.py` / vn source), updated
      manually (`updated` stuck at 2026-05-12), and is NOT in the daily Open-Meteo
      builder's `ORIGINS` (`backend/scripts/build_origin_weather.py`). health.json
      has a single `.scrapers.weather` timestamp (the origin/drought scrape) that
      does NOT represent the VN seed, so freshness shows green while VN actuals are
      frozen. Fix: add `vietnam` to `build_origin_weather.py` ORIGINS (real fix —
      refreshes daily + gives it Jan/Feb), or at minimum track vn_weather freshness
      in export_health and surface staleness.
- [ ] **Jan/Feb (and early-year temp) actuals missing for all scraped origins.**
      `monthly_actual_cur` begins in March; `monthly_actual_temp_cur` even later.
      Investigate `_year_series`/assembly in build_origin_weather.py — the
      current-year actual series should start at January (archive covers it).
- [ ] **Honduras May rainfall ~16% of normal is REAL, not a bug** (other 6 origins
      66–123% via the same builder; daily station ~7mm MTD). Likely a genuine
      early-rainy-season deficit — worth a drought-risk flag. Re-check once May is
      complete (figure is month-to-date through ~May 24).
