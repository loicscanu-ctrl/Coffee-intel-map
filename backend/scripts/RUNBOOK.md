# Operational scripts — runbook

Two one-shot scripts that modify the production DB. Both default to dry-run
and require an explicit `--apply` flag to commit. Both archive the rows
they remove/modify to a separate `*_archive` table, so a rollback is
SQL-only ("re-insert from archive where archive_reason = …").

Run from a host with `DATABASE_URL` pointing at prod (NOT the GitHub
Action runner — these are intentionally manual).

---

## 1. `backfill_max_oi_prices.py` — rebuild the COT price track under the max-OI rule

**What it does**: For every row in `cot_weekly`, recomputes
`price_{ny,ldn}` from the contract that held the largest OI on that
Tuesday (instead of the old "first non-near-expiry" rule that was
incorrect in the 2-3 weeks before each front-month's FND). Writes the
chosen contract symbol to `price_contract_{ny,ldn}` so the Industry
Pulse chart can draw contract-switch markers at every historical roll.

**Reversibility**: every modified row is copied to `cot_weekly_price_archive`
before update. Restore with:
```sql
UPDATE cot_weekly cw SET
  price_ny           = a.price_ny,
  price_ldn          = a.price_ldn,
  price_contract_ny  = a.price_contract_ny,
  price_contract_ldn = a.price_contract_ldn
FROM cot_weekly_price_archive a
WHERE cw.date = a.date AND a.archive_reason = 'backfill_max_oi_prices.py';
```

### Step-by-step

```bash
# 1. From a machine with DATABASE_URL pointing at prod:
export DATABASE_URL='postgresql://...'

# 2. Dry-run first — prints every row it WOULD modify. No DB writes.
python backend/scripts/backfill_max_oi_prices.py

# 3. Eyeball the output. Sanity-check at known roll boundaries:
#    NY (KC): 17 business days before the 1st business day of each of
#             Mar / May / Jul / Sep / Dec — these are the weeks where
#             max-OI should switch to the next contract.
#    LDN (RC): 26 business days before Jan/Mar/May/Jul/Sep/Nov.
#    If a Tuesday inside that window does NOT show a contract change,
#    investigate before proceeding.

# 4. If output looks right, apply:
python backend/scripts/backfill_max_oi_prices.py --apply

# 5. Confirm by re-rendering the Industry Pulse chart on the dashboard.
#    Contract-switch markers (pink dashed lines) should appear at every
#    historical roll boundary, not just from May 2026 onwards.
```

### If something looks wrong

- **Stooq returns no price**: the script falls back to the previous week's
  price for that row and logs a warning. Look at the warning count in the
  dry-run header; a few are normal (holiday weeks), dozens means Stooq is
  unreachable.
- **Wrong contract chosen**: open the script and inspect
  `ROLL_WINDOW_DAYS_BY_MARKET` (currently NY=17, LDN=26). These match the
  empirical observation; if they need re-tuning, change there and re-dry-run.

### What to paste back if you want me to review

The full dry-run stdout. The interesting line is the per-week diff section
showing `OLD: price=X.XX contract=KCN26 → NEW: price=Y.YY contract=KCU26`.

---

## 2. `dedup_factories.py` — remove orphaned and mojibake factory rows

**What it does**: scans the `factories` table for rows that:
  1. Have names recorded in `CONFIRMED_ORPHANS` (rows removed from
     `seed/factories.json` in earlier commits but never deleted from DB).
  2. Have UTF-8-decoded-as-Latin-1 mojibake names whose recovered form
     matches a seed entry (e.g. `CafÃ©s Novell` → seed has `Cafés Novell`).
  3. Match neither and are not in the current seed — flagged as
     "other_orphans" for manual review (NOT deleted automatically).

Archives every deleted row to `factories_archive` (created on first run).

**Reversibility**: restore with:
```sql
INSERT INTO factories (id, name, company, capacity, cap_kt, type, lat, lng)
SELECT factory_id, name, company, capacity, cap_kt, type, lat, lng
FROM factories_archive
WHERE archive_reason LIKE 'dedup_factories.py%';
```

### Step-by-step

```bash
export DATABASE_URL='postgresql://...'

# 1. Dry-run — prints the three groups it'd touch:
#    - confirmed_orphans: deleted
#    - mojibake_orphans:  deleted (with recovered name shown for verification)
#    - other_orphans:     listed for manual review, NOT deleted
python backend/scripts/dedup_factories.py --dry-run

# 2. Eyeball: the mojibake_orphans section should show pairs like
#       "CafÃ©s Novell Vilafranca"  → recovered: "Cafés Novell Vilafranca"
#    The recovered name should match a seed entry. If a "recovered" name
#    looks wrong (still has Ã or unfamiliar chars), DON'T apply — the
#    iterative demojibake may not have converged for that row.

# 3. Apply:
python backend/scripts/dedup_factories.py --apply

# 4. Spot-check by querying the map — the duplicate pins for canonical
#    names should be gone.
```

### Edge cases the script does NOT handle

- **Double-encoded triples** (corruption applied 3+ times): the demojibake
  loop caps at 3 passes. If the dry-run flags a row that still looks
  mojibake'd after recovery, log it manually and don't apply.
- **`other_orphans`**: these are rows in DB but not in seed AND not
  mojibake'd. Could be hand-inserts you want to keep, or stale rows.
  The script lists them but does NOT delete — your call per row.

### What to paste back if you want me to review

The dry-run summary (the counts at the top) plus the full `mojibake_orphans`
table. The `other_orphans` list only matters if you want my read on whether
specific rows should be deleted.

---

## Order of operations

These two scripts are independent — neither depends on the other. Suggested
order:

1. `dedup_factories.py` first (smaller blast radius, fewer rows touched).
2. `backfill_max_oi_prices.py` second (rewrites a long history of price
   data; bigger commit, more to verify).

Both can be re-run after `--apply` if you re-discover orphans / re-tune the
max-OI rule — they're idempotent against their own previous applications.
