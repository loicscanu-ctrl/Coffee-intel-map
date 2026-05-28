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
Currently flat (no breakdown, no drill) because the criteria are TBD. Once
defined, mirror the Robusta logic:
- Edit `_isArabicaPoison(e)` in `CertifiedStocksPanel.tsx`.
- Flip `ARABICA_DRILL["Poison"]` to `"port_origin"` (or whichever).
- Flip `ARABICA_DRILL["Passing rate"]` to `"passing_breakdown"`.

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
