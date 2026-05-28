# ICE Certified Stocks — open items

Working list of refinements deferred during build-out. Cross off as done; add
new ones here so they don't get lost in chat scroll-back.

## Open

### 5. Issued port-of-issuance (Robusta) — DEFERRED
Iss/recv carries `member × origin × sold`, but not port. To get port, the
3-way join is:
- Daily stock-delta per port (from stock_report.csv day-over-day) → per-port
  outflow.
- Daily tenders per origin → total tendered origin volume.
- Member-of-issuance from iss/recv.
Join (member, origin, day) ↔ (port, origin, day) ↔ (member, day) to estimate
which port each member's sales came from. All inferred, flag with `*`.

Not yet attempted: the inference is fragile (some days have no tender event;
stock-delta can be confounded by re-grading; member attribution is noisy).
Will revisit when there's a clear use-case demanding port-of-issuance for
Robusta member rows.

### 6. Robusta stock_report HHMMSS guess set — DEFERRED (Akamai risk)
Currently tries 3 fixed publish times (`103021`, `103126`, `103045`). Real
publish times vary daily; we capture ~2/5 days. Expanding the guess set
risks Akamai 429-burst penalties (we hit 3600 s Retry-After in the past
during 180-day backfills). Options:
- Scrape the `/stock_reports/` directory listing if exposed (preferred).
- Subscribe to ICE's email/RSS notification if any exists.
- Workbook ingest already fills the gap for historical backfill.

### 8. Raw-bytes artifact cache (architectural) — DEFERRED
Persist the raw .xls / .csv / .pdf / .txt bytes per day (GitHub artifact or
S3) so future parser changes can re-derive shape without re-fetching ICE.
~30–50 MB for 180 days. Means a UI change that needs a new field never
requires another 90-min backfill. CI workflow change of moderate scope —
not started.

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
- ✅ TODO #1 — Robusta member code → friendly-name map
  (`ROBUSTA_MEMBER_NAMES` in `CertifiedStocksPanel.tsx`; covers ADU, DMG,
  FCI, FIM, ICS, ITL, MCQ, MFL, PFU, SCD).
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
