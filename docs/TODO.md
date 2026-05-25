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

- [x] **Vietnam weather stale — FIXED (pending next run).** Added `vn` to the
      DAILY pipeline (`fetch_origin_weather.py` ORIGINS), which refreshes
      `vn_weather.json` actuals/daily/forecast from live Open-Meteo while keeping
      its curated climatology. `doc["updated"]` is stamped to TODAY, so the
      freshness blind spot resolves on its own. **Verify after the next
      `weather-fetch` run (05:40 UTC):** vn_weather.json `updated` = today and
      actual_cur advances daily. NOTE: VN's curated Jan/Feb actuals will be
      replaced by live history (Mar→ only, like other origins) since the forecast
      API only exposes ~92 past days.
- [ ] **Backfill Jan/early-Feb 2026 actuals — RUN the new backfill workflow.**
      Correction to an earlier note: the history store
      (`backend/seed/weather_history/{origin}.json`) is append-only and already
      persists everything from ~2026-02-20 onward (it never deletes), so going
      forward nothing is lost. Jan 1–Feb 19 are simply pre-accumulation (daily
      pipeline started ~late Feb; the forecast API only reaches 92 days back).
      New `backfill_weather_history.py` + "0.4 – Backfill weather history" workflow
      fetch those days from the Open-Meteo ARCHIVE host and fill the gap
      (idempotent). **TODO:** dispatch the workflow once and confirm Jan/Feb appear.
      RISK: the archive host may be blocked from CI (the daily fetcher uses the
      forecast host for that reason) — if the run fails at preflight, archive
      egress isn't allowlisted and Jan/Feb 2026 stays a one-time gap (next year is
      covered by daily accumulation regardless).
- [ ] **Honduras May rainfall ~16% of normal is REAL, not a bug** (other 6 origins
      66–123% via the same builder; daily station ~7mm MTD). Likely a genuine
      early-rainy-season deficit — worth a drought-risk flag. Re-check once May is
      complete (figure is month-to-date through ~May 24).
