# ICE Certified Stocks — open items

Working list of refinements deferred during build-out. Cross off as done; add
new ones here so they don't get lost in chat scroll-back.

## Open

### 1. Member code → friendly name mapping
Iss/recv reports use 3–4 letter clearing-member codes (`FIM`, `ICS`, `ADU`,
`MFL`, `SCD`, …). Display would benefit from a code-→-name lookup
(`FIM → Marex Financial`, etc.) — small static dict in
`frontend/components/demand/CertifiedStocksPanel.tsx` once we have an
authoritative source list.

### 2. Port-code mismatch / friendly-name lookup
Same physical warehouse appears under different codes across sources:
- Arabica xls: `HA/BR` (combined Hamburg/Bremen slot)
- Robusta stock_report.csv: `HAM`, `BRE` (separate)
- Robusta age_allowance.xlsx: adds `GEN`, `NYK`, no `LIV`
Build a display-only friendly name lookup per market (don't merge across
markets — different ICE warehouse designations).

### 3. Arabica Poison criteria
**Pending user decision.** The Arabica column no longer renders a standalone
"Poison" row — once criteria are defined, mirror the Robusta logic:
- Add `_isArabicaPoison(e)` analogous to `_isRobustaPoison()` in
  `CertifiedStocksPanel.tsx`.
- Flip `ARABICA_DRILL["Graded"]` from `"port_origin_inferred"` to
  `"graded_with_poison"` so Graded gets the Coffee/Poison sub-row split.
- Flip `ARABICA_DRILL["Passing rate"]` from `"none"` to `"passing_breakdown"`.
- Re-add "Poison" to `ARABICA_METRICS` only if you want it as a standalone
  row (not strictly needed once Graded carries the breakdown).

### 4. Robusta origin under (port, age)
Today renders `"origin attribution — inferred next iteration*"` placeholder.
Build the actual inference: for each `(port, months_since_graded)` bucket
from the monthly age-allowance, attribute origins by the gradings flow during
the source month at that port. Output should retain the `*` flag.

### 5. Issued port-of-issuance (Robusta)
Iss/recv carries `member × origin × sold`, but not port. To get port:
- Daily stock-delta per port (from stock_report.csv day-over-day) gives
  per-port outflow.
- Daily tenders per origin gives total tendered origin volume.
- Member-of-issuance from iss/recv.
Join (member, origin, day) ↔ (port, origin, day) ↔ (member, day) to estimate
which port each member's sales came from. All inferred, flag with `*`.

### 6. Robusta stock_report HHMMSS guess set
Currently tries 3 fixed publish times (`103021`, `103126`, `103045`). Real
publish times vary daily; we capture ~2/5 days. Either:
- Expand the guess set with wider time spread (more 404s = more Akamai burst
  pressure, careful).
- Scrape the `/stock_reports/` directory listing if exposed.
- Subscribe to ICE's email/RSS notification if any exists.

### 7. Arabica Issued source
ICE doesn't publish an arabica equivalent of iss/recv that I've found. Until
a source surfaces, Issued stays as `—` in the Arabica column. Options to
investigate: ICE Futures US public docs index for daily reports, or derive
from `total - (decert + transition + rebagging)` over the window.

### 8. Raw-bytes artifact cache (architectural)
Persist the raw .xls / .csv / .pdf / .txt bytes per day (GitHub artifact or
S3) so future parser changes can re-derive shape without re-fetching ICE.
~30–50 MB for 180 days. Means a UI change that needs a new field never
requires another 90-min backfill.

### 9. Period-view "Current" column boundary
Today: `Current = today − 6 to today` (rolling 7 days). Confirm with user
whether this should be Mon-Sun calendar week instead, or stay rolling.

### 10. Drill-down auto-expand-state persistence
Nice-to-have: persist `expanded` Set to localStorage so the user's last
drill state survives page reloads.

### 11. Wire the workbook's new fields into the panel
- ✅ `arabica.snapshots[].issuers_today` — wired as `port_issuer` drill on
  Arabica Issued (clearing-member firm names appear under each port).
- 🟡 `arabica.snapshots[].stoppers_today` — populated and exported, but
  panel does not yet have a "Received" row to render it. Consider adding
  if buy-side flow ever matters.
- 🟡 `arabica.latest_detail.age_detail` — per port × age-bucket-in-days
  (e.g. "0721 to 0750"). Current Arabica Stocks drill is
  `port_group_origin`; if we want age slicing, add a new drill
  `port_age_group_origin` rather than replacing the group view.
- ✅ `arabica.snapshots[].passed_today_bags / failed_today_bags` rendered
  in Graded + Passing rate.

### 12. Deep-history chart background
12 deep-chunk JSONs are on disk (`certified_stocks_<market>_deep_<years>.json`,
1990–2029). Add a frontend toggle / lazy-loader that fetches the relevant
chunks when the user expands the time-series chart's range beyond 365 days.
Each chunk is light (date + total + by_port_totals, no by_origin) so even
loading all 12 is < 2 MB total.

## Done (kept for reference)

- ✅ Probe verified all 10 source URLs reachable from CI (no Akamai walls on
  publicdocs paths).
- ✅ Parsers for all 10 sources (6 text/CSV inline-verified, 4 binary verified
  against uploads).
- ✅ Per-path throttle (1 s for /publicdocs/, 5 s for /marketdata/) and 429
  backoff with self-tuning escalation.
- ✅ Merge-into-existing on write (daily cron can extend history without loss).
- ✅ Snapshot enrichment: each arabica snapshot carries
  `sections.{section}.{by_port, by_group, by_origin{by_port, group, total}}`
  so drill-down works on history, not just `latest_detail`.
- ✅ Period view with window semantics: flow metrics sum across the window;
  inventory metrics use end-of-window snapshot.
- ✅ Robusta poison redefinition (subset of tenderable matching low-quality
  criteria, not failed-grading).
- ✅ Passing rate breakdown (Robusta): "of which Poison %" + "of which Coffee %".
- ✅ Arabica Pending grading drill: port → group → origin.
- ✅ Stocks drill: port → age → origin (Arabica: Regular/Transition; Robusta:
  monthly age buckets — origin layer still inferred per #4).
- ✅ Decertified per-port drill (both markets).
- ✅ Robusta Issued drill: member → origin (from iss/recv.members).
- ✅ Workflow `PYTHONUNBUFFERED=1` so long backfills show real-time progress.
- ✅ Per-path rate limiting fix (2 s `/publicdocs/`, 5 s `/marketdata/`,
  Retry-After cap at 90 s, abort on > 600 s penalty).
- ✅ Manual-ingest importer for raw ICE source files
  (`backend/scripts/import_ice_historical.py`).
- ✅ Synthesis-workbook importer with zero-skip + 5-year deep history chunks
  (`backend/scripts/import_synthesis_xlsx.py`).
- ✅ 12 deep-history JSONs on disk: Arabica 2010–2029, Robusta 1990–2029.
- ✅ Robusta 0-stock dates dropped from snapshots (importer-side filter +
  post-merge cleanup of legacy entries).
- ✅ Panel v4 — 11-point feedback addressed:
  - Master ports/groups/origins/members/issuers/age-buckets now derived from
    the UNION of every column window, not just "Current" (fixes Arabica
    Group 2/4 being hidden when the latest week is Group-0-only).
  - Arabica `port_issuer` drill on Issued (clearing-member breakdown).
  - Arabica `port_group_origin` drill on Stocks + Decertified (replaces
    the obscure "Regular / Transition" age split).
  - Removed standalone Arabica "Poison" row (criteria TBD — see #3).
  - Robusta Graded gets `graded_with_poison` drill: 2 sub-rows
    (Coffee / Poison), each opens port → origin.
  - Robusta Pending grading gets `queue_forecast` drill (queue + forecast
    sub-rows from grading_overview).
  - Robusta Decertified gets same drill shape as Stocks (port → age → origin),
    with per (port, age) values inferred from month-over-month bucket change.
  - Stocks/Decertified age buckets now labelled by graded month
    ("Mar-26") instead of "1 mo since graded" (raw bucket shown as a
    smaller suffix).
