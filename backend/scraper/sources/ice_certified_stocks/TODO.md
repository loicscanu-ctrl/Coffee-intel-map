# ICE Certified Stocks — open items

Working list of refinements deferred during build-out. Cross off as done; add
new ones here so they don't get lost in chat scroll-back.

## Open

### 5. Issued port-of-issuance (Robusta) — PARKED (user choice)
Iss/recv carries `member × origin × sold`, but not port. Inference would
need a fragile 3-way join across stock-deltas + tenders + iss-recv. Will
revisit only if a clear use-case demands port-of-issuance on Robusta
member rows.

### 11. Arabica age_detail (per port × day-bucket) — PARTIAL
- ✅ Issuers (sell-side) wired as Issued row's `port_issuer` drill.
- ✅ Stoppers (buy-side) wired as a new "Received" row, same drill.
- 🟡 `arabica.latest_detail.age_detail` (per port × 30-day age-bucket like
  "0721 to 0750") — not yet rendered. Current Arabica Stocks drill is
  `port_group_origin`; to add age slicing, introduce a new drill
  `port_age_group_origin` (port → age bucket → group → origin) rather
  than replacing the group view. Skipped for now to keep the panel concise.

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
- ✅ Stocks drill: port → age → origin (Arabica: port → group → origin;
  Robusta: monthly age buckets — origin layer now inferred from gradings
  flow in the source month).
- ✅ Decertified per-port drill (both markets); robusta also gets per-(port,
  age) and per-(port, age, origin) layers.
- ✅ Robusta Issued drill: member → origin (from iss/recv.members), member
  set union'd across all column windows.
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
- ✅ Arabica Issued — wired from workbook `issuers_today` (sheet 8a). Live
  scraper has no ICE source for this section; workbook covers the gap.
- ✅ Arabica Poison criteria — locked in v1: origins in Group 3 or Group 4
  (the discount-tier naturals). Graded drills into Coffee/Poison sub-rows,
  each opens port → origin.
- ✅ Panel v4 — 11-point feedback addressed:
  - Master ports/groups/origins/members/issuers/age-buckets now derived from
    the UNION of every column window, not just "Current" (fixes Arabica
    Group 2/4 being hidden when the latest week is Group-0-only).
  - Arabica `port_issuer` drill on Issued (clearing-member breakdown).
  - Arabica `port_group_origin` drill on Stocks + Decertified (replaces
    the obscure "Regular / Transition" age split).
  - Robusta Graded gets `graded_with_poison` drill: 2 sub-rows
    (Coffee / Poison), each opens port → origin.
  - Robusta Pending grading gets `queue_forecast` drill (queue + forecast
    sub-rows from grading_overview).
  - Robusta Decertified gets same drill shape as Stocks (port → age → origin),
    with per (port, age) values inferred from month-over-month bucket change.
  - Stocks/Decertified age buckets now labelled by graded month
    ("Mar-26") instead of "1 mo since graded" (raw bucket shown as a
    smaller suffix).
- ✅ TODO #1 — Clearing-member code → friendly-name map locked in v2
  with the user's authoritative 35-code list (`CLEARING_MEMBER_NAMES` in
  `CertifiedStocksPanel.tsx`). Same dict is reused by both markets via the
  `ROBUSTA_MEMBER_NAMES` alias. Arabica firm names (which arrive as long
  strings like "167 Division Marex Capital Markets Inc.", "SG Americas
  Securities, LLC", "ABN Amro\n127") get the matching code prefixed via
  `_displayFirmName()` / `_codeForFirmName()` regex patterns — covers
  every distinct firm seen in the workbook today.
- ✅ TODO #2 — Port code → friendly-name maps for both markets
  (`ARABICA_PORT_NAMES`, `ROBUSTA_PORT_NAMES`). Display format is
  "`CODE · City`"; unknown codes fall through to the raw code.
- ✅ TODO #4 — Robusta origin under (port, age) — `_rOriginsForAgeBucket()`
  attributes bucket lots to origins from the gradings flow during the
  source month at that port (`*` inferred).
- ✅ TODO #10 — Drill-down expanded state persisted to localStorage via
  `useExpandedSet()` hook. Survives page reloads.
- ✅ TODO #11 (partial) — Arabica `stoppers_today` rendered as a new
  "Received" row with the same port → clearing-member drill as Issued.
  `age_detail` deferred (see Open #11).
- ✅ TODO #12 — Deep-history lazy load: chart range toggle (1y / 5y / 10y /
  all) with `useDeepHistory()` hook that fetches deep chunks on demand.
- ✅ TODO #9 — Period-view columns now snap to calendar weeks (Mon-Sun):
  "Current" = this week's Mon → today; "1w ago" = previous full Mon-Sun.
  `_mondayOf()` helper does the snap; month-end columns unchanged.
- ✅ TODO #6 — Tiered HHMMSS guesser for the Robusta stock_report.csv.
  Tier 1 = top-5 most-frequent HHMMSS from `stock_report_hits.json`
  (≤5 GETs, self-tunes after every success). Tier 2 = 120-second sweep
  of the published 10:30:00–10:31:59 window (only on miss, only for the
  latest day so daily cron stays bounded). Hits log starts seeded with
  the 3 bootstrap values and grows with every confirmed capture.
- ✅ TODO #8 — Audit closed without building a raw-bytes cache. Live
  parsers (arabica_xls / stock_report / age_allowance / gradings /
  iss_recv / pdfs / tenders) verified exhaustive for the URLs they
  fetch. One workbook-importer omission fixed: sheet 6_ny_gradings was
  dropping the `origin` column — now surfaced as
  `snapshots[].graded_today_by_origin` + `graded_today_by_port_origin`.
  Remaining gaps are derivable (wow/mom/yoy %s) or already covered by
  workbook ingest (arabica iss/recv has no live ICE source URL — workbook
  fills it on demand).
- ✅ Bug fix — workbook pivot rows labelled "TOTAL" were being treated as
  a real warehouse port, double-counting the arabica grand total
  (rendered 887,216 bags instead of the actual 443,608). Added
  `_is_aggregate_port()` filter at every parser entry that consumes a
  port_code (plus regression tests in
  `backend/tests/test_import_synthesis_xlsx.py`). Re-imported all
  arabica + robusta JSONs.
