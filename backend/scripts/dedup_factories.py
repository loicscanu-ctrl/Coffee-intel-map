"""
dedup_factories.py — clean stale Factory rows that have accumulated in the live DB.

Background
----------
`backend/seed.py` inserts rows into the `factories` table by name match —
on subsequent runs, only rows with a not-yet-seen name are added. When a
factory in `backend/seed/factories.json` is renamed or consolidated, the
old name stays in the live DB forever.

Forensic analysis of `backend/seed/factories.json` across git history
identified three such orphans, all from a Westrock cluster cleanup:

  S&D Coffee Concord            → Westrock Concord (ex-S&D)
  Westrock Conway Factory       → Westrock Conway Complex
  Westrock Conway (Extracts)    → Westrock Conway Complex

The local SQLite test DB confirms all three are present, sharing exact
coords with their canonical replacements. Production likely has the same
state, plus possibly additional manually-inserted rows we cannot see from
the repo. This script handles both cases.

Behaviour
---------
By default runs in dry-run mode:
  * loads the current `backend/seed/factories.json`
  * pulls every row from the live `factories` table
  * partitions into canonical / confirmed-orphan / other-orphan
  * prints a per-row report
  * exits with no DB changes

With --apply, deletes the orphan rows. By default, each deleted row is
first copied into a `factories_archive` table (created if missing) so the
operation is fully reversible. Pass --no-archive to skip the backup.

Usage
-----
  python backend/scripts/dedup_factories.py             # dry run
  python backend/scripts/dedup_factories.py --apply     # apply with archive
  python backend/scripts/dedup_factories.py --apply --no-archive  # irreversible

Database connection is read from `DATABASE_URL` (same env var the FastAPI
backend uses). Falls back to the local SQLite test DB when unset.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make `backend/` importable so we can reuse the existing SessionLocal / models.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from database import SessionLocal, engine  # noqa: E402
from models import Factory  # noqa: E402

SEED_PATH = ROOT / "seed" / "factories.json"

# Rows whose names appeared in earlier versions of `backend/seed/factories.json`
# but were removed in a later commit. Mapped to the canonical replacement so
# the dry-run report explains what's happening.
CONFIRMED_ORPHANS: dict[str, str] = {
    "S&D Coffee Concord":          "Westrock Concord (ex-S&D)",
    "Westrock Conway Factory":     "Westrock Conway Complex",
    "Westrock Conway (Extracts)":  "Westrock Conway Complex",
}


# Common UTF-8-as-Latin-1 mojibake sequences observed in factory names.
# Used as a regex fallback when the full latin-1 round-trip fails (which
# happens on PARTIALLY mojibake'd strings — e.g. "CafÃ© Maringá", where
# "Café" got Latin-1-corrupted but "á" survived as proper UTF-8 because
# it was decoded from a different code path).
_MOJIBAKE_MAP: dict[str, str] = {
    "Ã©": "é", "Ã¨": "è", "Ãª": "ê", "Ã«": "ë",
    "Ã¡": "á", "Ã ": "à", "Ã¢": "â", "Ã£": "ã", "Ã¤": "ä",
    "Ã­": "í", "Ã¬": "ì", "Ã®": "î", "Ã¯": "ï",
    "Ã³": "ó", "Ã²": "ò", "Ã´": "ô", "Ãµ": "õ", "Ã¶": "ö",
    "Ãº": "ú", "Ã¹": "ù", "Ã»": "û", "Ã¼": "ü",
    "Ã±": "ñ", "Ã§": "ç", "ÃŸ": "ß",
    "Ã\x81": "Á", "Ã‰": "É", "Ã\x8d": "Í", "Ã“": "Ó", "Ãš": "Ú",
}


def _demojibake(s: str) -> str | None:
    """Recover a UTF-8 string that was decoded as Latin-1 on insertion.

    The production DB has accumulated rows whose names appear as e.g.
    "CafÃ©s Novell Vilafranca" — the UTF-8 bytes for `é` (`\\xc3\\xa9`)
    misinterpreted as the Latin-1 sequence `Ã©`. A round-trip through
    `latin-1` encode → `utf-8` decode undoes the corruption:

        "CafÃ©s Novell Vilafranca".encode("latin-1").decode("utf-8")
            == "Cafés Novell Vilafranca"

    Fallback: when the round-trip fails (partial mojibake — some chars
    already proper UTF-8 break the latin-1 encode step), substitute the
    known mojibake sequences via `_MOJIBAKE_MAP`.

    Returns the recovered string if it differs from the input AND contains
    at least one non-ASCII character (guards against accidental conversion
    of strings that legitimately contain `Ã`). Returns None when no
    recovery is possible.
    """
    # Primary path: full latin-1 round-trip.
    try:
        fixed = s.encode("latin-1").decode("utf-8")
        if fixed != s and any(ord(c) > 127 for c in fixed):
            return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass

    # Fallback path: regex substitution for partial mojibake.
    fixed = s
    for moji, proper in _MOJIBAKE_MAP.items():
        fixed = fixed.replace(moji, proper)
    if fixed != s and any(ord(c) > 127 for c in fixed):
        return fixed

    return None


def _create_archive_table_if_needed(db) -> None:
    """Best-effort archive table creation; works on both Postgres and SQLite."""
    dialect = engine.dialect.name
    if dialect == "postgresql":
        ddl = """
            CREATE TABLE IF NOT EXISTS factories_archive (
                archived_id    SERIAL PRIMARY KEY,
                archived_at    TIMESTAMP NOT NULL DEFAULT NOW(),
                archive_reason TEXT NOT NULL,
                factory_id     INTEGER NOT NULL,
                name           VARCHAR(500),
                company        VARCHAR(200),
                capacity       VARCHAR(200),
                cap_kt         FLOAT,
                type           VARCHAR(50),
                lat            FLOAT,
                lng            FLOAT
            );
        """
    else:
        # SQLite — also covers the local test.db path.
        ddl = """
            CREATE TABLE IF NOT EXISTS factories_archive (
                archived_id    INTEGER PRIMARY KEY AUTOINCREMENT,
                archived_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                archive_reason TEXT NOT NULL,
                factory_id     INTEGER NOT NULL,
                name           VARCHAR(500),
                company        VARCHAR(200),
                capacity       VARCHAR(200),
                cap_kt         REAL,
                type           VARCHAR(50),
                lat            REAL,
                lng            REAL
            );
        """
    db.execute(text(ddl))
    db.commit()


def _archive_row(db, row: Factory, reason: str) -> None:
    db.execute(
        text(
            """
            INSERT INTO factories_archive
                (archive_reason, factory_id, name, company, capacity, cap_kt, type, lat, lng)
            VALUES
                (:reason, :id, :name, :company, :capacity, :cap_kt, :type, :lat, :lng)
            """
        ),
        {
            "reason": reason,
            "id": row.id,
            "name": row.name,
            "company": row.company,
            "capacity": row.capacity,
            "cap_kt": row.cap_kt,
            "type": row.type,
            "lat": row.lat,
            "lng": row.lng,
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Clean stale Factory rows from the live DB.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete the orphan rows. Without this flag, the script prints a report and exits.",
    )
    parser.add_argument(
        "--no-archive",
        action="store_true",
        help="Skip writing rows to factories_archive before deletion. Irreversible.",
    )
    args = parser.parse_args()

    # Load canonical seed names.
    if not SEED_PATH.exists():
        print(f"ERROR: seed file not found at {SEED_PATH}", file=sys.stderr)
        return 2
    with SEED_PATH.open(encoding="utf-8") as f:
        seed = json.load(f)
    seed_names: set[str] = {x["n"] for x in seed.get("factories", []) if "n" in x}
    seed_by_coord: dict[tuple[float, float], list[dict]] = {}
    for x in seed.get("factories", []):
        coord = tuple(x.get("l", [None, None]))
        seed_by_coord.setdefault(coord, []).append(x)

    print(f"Loaded {len(seed_names)} canonical factory names from {SEED_PATH.relative_to(ROOT.parent)}")

    db = SessionLocal()
    try:
        all_rows = db.query(Factory).all()
        print(f"Live DB has {len(all_rows)} factory rows")

        canonical: list[Factory] = []
        confirmed_orphans: list[Factory] = []
        mojibake_orphans: list[tuple[Factory, str]] = []  # (row, recovered_name)
        other_orphans: list[Factory] = []

        for r in all_rows:
            if r.name in CONFIRMED_ORPHANS:
                confirmed_orphans.append(r)
                continue
            if r.name in seed_names:
                canonical.append(r)
                continue
            # Try demojibake — if the recovered name matches a seed entry,
            # this is a mojibake duplicate of that canonical row.
            recovered = _demojibake(r.name)
            if recovered and recovered in seed_names:
                mojibake_orphans.append((r, recovered))
                continue
            other_orphans.append(r)

        print(f"  Canonical (in current seed):            {len(canonical)}")
        print(f"  Confirmed orphans (will be deleted):    {len(confirmed_orphans)}")
        print(f"  Mojibake orphans (will be deleted):     {len(mojibake_orphans)}")
        print(f"  Other orphans (review before applying): {len(other_orphans)}")
        print()

        if confirmed_orphans:
            print("CONFIRMED ORPHANS — deleted on --apply:")
            for i, r in enumerate(sorted(confirmed_orphans, key=lambda x: x.name), 1):
                replacement = CONFIRMED_ORPHANS[r.name]
                # Find the replacement in seed to confirm the match
                same_coord = seed_by_coord.get((r.lat, r.lng), [])
                same_coord_names = [s["n"] for s in same_coord]
                coord_match = "✓ same coord" if replacement in same_coord_names else "⚠ coord mismatch"
                print(f"  {i}. \"{r.name}\"")
                print(f"       company={r.company!r}  type={r.type!r}  coord=({r.lat}, {r.lng})  cap_kt={r.cap_kt}")
                print(f"       → likely canonical: \"{replacement}\" ({coord_match})")
            print()

        if mojibake_orphans:
            print("MOJIBAKE ORPHANS — deleted on --apply:")
            print("(UTF-8 names mis-decoded as Latin-1 on some past insert. The")
            print(" canonical row with the same name in proper UTF-8 already exists")
            print(" in the seed AND in the DB.)")
            print()
            for i, (r, recovered) in enumerate(
                sorted(mojibake_orphans, key=lambda pair: pair[0].name), 1
            ):
                print(f"  {i}. \"{r.name}\"")
                print(f"       company={r.company!r}  type={r.type!r}  coord=({r.lat}, {r.lng})  cap_kt={r.cap_kt}")
                print(f"       → recovered UTF-8: \"{recovered}\" (matches a seed entry)")
            print()

        if other_orphans:
            print("OTHER ORPHANS — DB rows whose names aren't in the current seed.")
            print("These need a human eyeball — they may be legitimate manual inserts")
            print("(e.g. a facility added by hand) or stale rows from a pre-git seed")
            print("iteration. They WILL be deleted on --apply unless you intervene.")
            print()
            for i, r in enumerate(sorted(other_orphans, key=lambda x: x.name), 1):
                # Best-effort: find a same-coord seed entry to suggest as canonical
                near = seed_by_coord.get((r.lat, r.lng), [])
                near_str = ""
                if near:
                    near_str = "  — same-coord seed entry: " + ", ".join(
                        f'"{s["n"]}"' for s in near
                    )
                print(f"  {i}. \"{r.name}\"")
                print(f"       company={r.company!r}  type={r.type!r}  coord=({r.lat}, {r.lng})  cap_kt={r.cap_kt}")
                if near_str:
                    print(f"      {near_str}")
            print()

        if not (confirmed_orphans or mojibake_orphans or other_orphans):
            print("No orphan rows found. DB is clean.")
            return 0

        if not args.apply:
            print("DRY RUN — no DB changes. Pass --apply to delete.")
            return 0

        mojibake_rows = [r for r, _ in mojibake_orphans]
        to_delete = confirmed_orphans + mojibake_rows + other_orphans

        if not args.no_archive:
            _create_archive_table_if_needed(db)
            mojibake_name_set = {r.name for r in mojibake_rows}
            for r in to_delete:
                if r.name in CONFIRMED_ORPHANS:
                    reason = "dedup_factories.py: known-orphan rename/consolidation"
                elif r.name in mojibake_name_set:
                    reason = "dedup_factories.py: UTF-8/Latin-1 mojibake duplicate of canonical row"
                else:
                    reason = "dedup_factories.py: name not in current backend/seed/factories.json"
                _archive_row(db, r, reason)
            db.commit()
            print(f"Archived {len(to_delete)} row(s) to factories_archive.")

        for r in to_delete:
            db.delete(r)
        db.commit()
        print(f"Deleted {len(to_delete)} row(s).")

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
