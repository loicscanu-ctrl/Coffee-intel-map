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
