"""
capture_kc_at_rc_close.py
Record the front-month Arabica (KC) price at the instant ICE Robusta (RC)
closes its London session (17:30 London time), once per trading day.

Why
===
ICE Robusta (London) closes at 17:30 London; ICE Arabica/Coffee C (New York)
keeps trading for ~1 more hour and settles at 13:30 ET. During that final
hour New York prices in information London robusta has already stopped
trading on — and robusta tends to gap toward it at its next open. So the
feature

    kc_after_rc_diff = KC_settle / KC_at_RC_close − 1

(the NY-only move in the window after London closes) is a leading indicator
for robusta's next-session direction. The open-direction model consumes it
(scraper/quant_model/open_direction.py) once this history accumulates.

KC_settle is already in the daily price archive. The missing piece is
KC_at_RC_close — an *intraday* snapshot at 17:30 London — which this script
records going forward (there's no free deep intraday KC history to backfill,
so the feature comes online after a few weeks of capture).

How
===
The acaphe live-quotes poll (workflow 0.1) already fetches both KC and RC
every 15 min during trading hours and pushes the snapshot to Upstash Redis.
This script just READS that snapshot — no Playwright, no scraping — and:

  1. Confirms the snapshot is fresh (≤ _MAX_AGE_MIN old) so we're not
     recording a stale quote.
  2. Confirms the current London wall-clock is within the RC-close window
     (17:30 London ± _WINDOW_MIN). A late cron fire lands OUTSIDE the window
     and SKIPS — we never record a wrong-time price. Clean data over
     complete data: a missed day just means one fewer feature observation,
     which the model handles via graceful degradation.
  3. Appends {date, kc_at_rc_close, ...} to
     frontend/public/data/kc_at_rc_close_history.json (dedup by date — first
     valid capture per day wins — keep ~2y).

DST is handled by zoneinfo("Europe/London"): the workflow fires at both
16:30 and 17:30 UTC (covering 17:30 London in BST and GMT respectively),
and the London-time guard lets exactly the right one through per season.

Usage (debug):
    cd backend
    UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
        python -m scraper.capture_kc_at_rc_close
"""
from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UPSTASH_URL   = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
REDIS_KEY     = "live_quotes"

OUT_PATH = Path(__file__).parents[2] / "frontend" / "public" / "data" / "kc_at_rc_close_history.json"

_LONDON       = ZoneInfo("Europe/London")
_RC_CLOSE_HM  = (17, 30)   # 17:30 London — robusta session close (owner spec)
_WINDOW_MIN   = 8          # ± minutes around 17:30 London the capture is valid
_MAX_AGE_MIN  = 20         # snapshot must be at most this old (poll is every 15m)
_KEEP_DAYS    = 730        # ~2y of history retained


def _redis_get(key: str) -> dict | list | None:
    """GET a key from Upstash Redis via REST. Returns the parsed JSON value
    (the poll stores the snapshot as a JSON string) or None on any failure."""
    if not UPSTASH_URL or not UPSTASH_TOKEN:
        print("[kc-capture] Upstash not configured — nothing to read.", file=sys.stderr)
        return None
    try:
        resp = requests.post(
            UPSTASH_URL,
            headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"},
            json=["GET", key],
            timeout=8,
        )
        resp.raise_for_status()
        result = resp.json().get("result")
        if not result:
            return None
        return json.loads(result) if isinstance(result, str) else result
    except Exception as exc:
        print(f"[kc-capture] Redis GET failed: {exc}", file=sys.stderr)
        return None


def _minutes_from_rc_close(now_london: datetime) -> float:
    """Signed minutes between now (London) and today's 17:30 London close."""
    close = now_london.replace(hour=_RC_CLOSE_HM[0], minute=_RC_CLOSE_HM[1],
                               second=0, microsecond=0)
    return (now_london - close).total_seconds() / 60.0


def _front_kc_last(snapshot: dict) -> tuple[float, str] | None:
    """Front-month KC last price + month label from the live snapshot.

    acaphe stores arabica contracts front-first (nearest expiry at index 0),
    each as {month, last, ...}. Returns (last_price, month) or None.
    """
    arabica = snapshot.get("arabica") or []
    for entry in arabica:
        last = entry.get("last")
        if last is None:
            continue
        try:
            return float(last), str(entry.get("month") or "")
        except (TypeError, ValueError):
            continue
    return None


def _snapshot_age_min(snapshot: dict, now_utc: datetime) -> float | None:
    """Minutes since the snapshot's fetched_at. None if unparseable."""
    fa = snapshot.get("fetched_at")
    if not fa:
        return None
    try:
        ts = datetime.fromisoformat(str(fa).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        return (now_utc - ts).total_seconds() / 60.0
    except Exception:
        return None


def _load_history() -> list[dict]:
    if not OUT_PATH.exists():
        return []
    try:
        data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_history(rows: list[dict]) -> None:
    rows = sorted(rows, key=lambda r: r.get("date", ""))[-_KEEP_DAYS:]
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")


def run(now_utc: datetime | None = None) -> dict:
    """Returns a small status dict (recorded / skipped + reason). `now_utc`
    is injectable for tests; defaults to the real clock."""
    now_utc = now_utc or datetime.now(UTC)
    now_london = now_utc.astimezone(_LONDON)
    date_str = now_london.strftime("%Y-%m-%d")

    # 1. London-time gate — only record near 17:30 London (handles DST + a
    #    late cron fire, which lands outside the window and skips).
    off = _minutes_from_rc_close(now_london)
    if abs(off) > _WINDOW_MIN:
        return {"recorded": False, "reason": f"outside RC-close window ({off:+.0f} min from 17:30 London)"}

    # 2. Already captured today? First valid capture per day wins.
    history = _load_history()
    if any(r.get("date") == date_str for r in history):
        return {"recorded": False, "reason": f"already captured for {date_str}"}

    # 3. Read the fresh live snapshot from Redis.
    snap = _redis_get(REDIS_KEY)
    if not isinstance(snap, dict):
        return {"recorded": False, "reason": "no live snapshot in Redis"}

    age = _snapshot_age_min(snap, now_utc)
    if age is None or age > _MAX_AGE_MIN:
        return {"recorded": False, "reason": f"snapshot too old/unknown ({age} min)"}

    front = _front_kc_last(snap)
    if front is None:
        return {"recorded": False, "reason": "no front-month KC last in snapshot"}
    kc_last, kc_month = front

    record = {
        "date":            date_str,
        "kc_at_rc_close":  kc_last,
        "kc_month":        kc_month,
        "london_time":     now_london.strftime("%Y-%m-%d %H:%M %Z"),
        "snapshot_age_min": round(age, 1),
        "fetched_at":      snap.get("fetched_at"),
    }
    history.append(record)
    _write_history(history)
    print(f"[kc-capture] recorded {date_str}: KC {kc_last} ({kc_month}) "
          f"at {record['london_time']}, snap age {age:.1f}m")
    return {"recorded": True, "record": record}


if __name__ == "__main__":
    status = run()
    print(json.dumps(status, ensure_ascii=False, indent=2))
    # Exit 0 even when skipped — a skip is a normal no-op, not a failure.
    sys.exit(0)
