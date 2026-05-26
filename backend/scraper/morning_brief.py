"""
morning_brief.py
Sends a daily Telegram morning brief. Message is built by telegram/handlers/brief.py.

Required env vars:
  TELEGRAM_BOT_TOKEN  — from @BotFather
  TELEGRAM_CHAT_ID    — your chat or group id
  DATABASE_URL        — postgres DSN (optional, unused now but kept for compat)

Optional env vars:
  DATA_DIR            — path to frontend/public/data (auto-detected from repo root)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests

# ── Path setup ─────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR  = Path(os.environ.get("DATA_DIR", str(_REPO_ROOT / "frontend" / "public" / "data")))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")


# ── JSON loader (kept for backwards-compat with existing tests) ───────────────

def _load(filename: str) -> dict | list | None:
    path = _DATA_DIR / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Utility functions (kept for backwards-compat with existing tests) ─────────

def _pct_change(change: float | None, prev: float | None) -> float | None:
    if not isinstance(change, (int, float)) or not isinstance(prev, (int, float)) or prev == 0:
        return None
    return change / prev * 100


def _rain_cue(mtd: float, lo: float, hi: float) -> str:
    if mtd < lo:
        return "record-dry"
    if mtd > hi:
        return "record-wet"
    span = hi - lo
    if span <= 0:
        return "normal"
    frac = (mtd - lo) / span
    if frac <= 0.25:
        return "dry"
    if frac >= 0.75:
        return "wet"
    return "normal"


def _split_message(text: str, limit: int = 3900) -> list[str]:
    chunks: list[str] = []
    cur = ""

    def _flush() -> None:
        nonlocal cur
        if cur:
            chunks.append(cur)
            cur = ""

    for block in text.split("\n\n"):
        candidate = block if not cur else f"{cur}\n\n{block}"
        if len(candidate) <= limit:
            cur = candidate
            continue
        _flush()
        if len(block) <= limit:
            cur = block
            continue
        for line in block.split("\n"):
            cand2 = line if not cur else f"{cur}\n{line}"
            if len(cand2) <= limit:
                cur = cand2
            else:
                _flush()
                cur = line if len(line) <= limit else line[:limit]
                if len(line) > limit:
                    _flush()
    _flush()
    return chunks or [text[:limit]]


_SUPPLY_FILES = [
    ("farmer_economics", "Brazil"),
    ("vietnam_supply",   "Vietnam"),
    ("colombia_supply",  "Colombia"),
    ("honduras_supply",  "Honduras"),
    ("indonesia_supply", "Indonesia"),
    ("uganda_supply",    "Uganda"),
    ("ethiopia_supply",  "Ethiopia"),
]


def _weather_rows() -> list[dict]:
    rows: list[dict] = []
    for fname, country in _SUPPLY_FILES:
        data = _load(f"{fname}.json")
        weather = data.get("weather") if isinstance(data, dict) else None
        if not weather:
            continue
        for reg in weather.get("regions", []):
            mtd = reg.get("rain_mtd_mm")
            lo  = reg.get("rain_hist_min")
            hi  = reg.get("rain_hist_max")
            has_rain = all(isinstance(v, (int, float)) for v in (mtd, lo, hi))
            rows.append({
                "country": country,
                "name":    reg.get("name", "?"),
                "drought": reg.get("drought", "NONE"),
                "csi":     reg.get("csi_30d_level", "NONE"),
                "mtd":     mtd if has_rain else None,
                "lo":      lo  if has_rain else None,
                "hi":      hi  if has_rain else None,
                "cue":     _rain_cue(mtd, lo, hi) if has_rain else None,
            })
    return rows


def _supply_weather_section() -> str:
    rows = _weather_rows()
    if not rows:
        return ""

    out = ["<b>━ SUPPLY & WEATHER</b>"]
    rain_rows = [r for r in rows if r["mtd"] is not None]

    if rain_rows:
        for r in rain_rows:
            tag_bits = []
            if r["drought"] == "HIGH":
                tag_bits.append("drought HIGH")
            if r["csi"] == "HIGH":
                tag_bits.append("CSI HIGH")
            tag = (" · " + ", ".join(tag_bits)) if tag_bits else ""
            out.append(
                f"  {r['country']}/{r['name']}: MTD {r['mtd']:.0f}mm · "
                f"hist {r['lo']:.0f}–{r['hi']:.0f} (this date) · {r['cue']}{tag}"
            )
    else:
        alerts = []
        for r in rows:
            if r["drought"] == "HIGH":
                alerts.append(f"  DROUGHT HIGH — {r['country']}/{r['name']}")
            if r["csi"] == "HIGH":
                alerts.append(f"  CSI HIGH — {r['country']}/{r['name']}")
        if len(out) == 1 and not alerts:
            return ""
        out.extend(alerts)

    return "\n".join(out)


# ── Message builder ───────────────────────────────────────────────────────────

def build_message(db=None) -> str:
    from telegram.handlers.brief import build_brief_message
    return build_brief_message(db)


def send_telegram(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[morning_brief] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set")
        return False
    url  = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    resp = requests.post(url, data={
        "chat_id":    TELEGRAM_CHAT_ID,
        "text":       text,
        "parse_mode": "HTML",
    }, timeout=15)
    if resp.ok:
        print("[morning_brief] Telegram message sent OK")
        return True
    print(f"[morning_brief] Telegram error: {resp.status_code} {resp.text[:200]}")
    return False


def main():
    db = None
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        try:
            from database import SessionLocal
            db = SessionLocal()
        except Exception as e:
            print(f"[morning_brief] DB connect failed: {e}")

    try:
        msg = build_message(db)
        print("[morning_brief] Message preview:\n")
        print(msg.encode("ascii", "replace").decode())
        print()
        send_telegram(msg)
    finally:
        if db:
            db.close()


if __name__ == "__main__":
    main()
