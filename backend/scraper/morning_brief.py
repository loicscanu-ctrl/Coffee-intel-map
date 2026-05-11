"""
morning_brief.py
Sends a daily Telegram morning brief with prices, COT, weather alerts, and news.
Reads from static JSON files (written by export_static_json.py) + DB for news.

Required env vars:
  TELEGRAM_BOT_TOKEN  — from @BotFather
  TELEGRAM_CHAT_ID    — your chat or group id
  DATABASE_URL        — postgres DSN (optional — skips news section if missing)

Optional env vars:
  DATA_DIR            — path to frontend/public/data (auto-detected from repo root)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import requests

# ── Path setup ─────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR  = Path(os.environ.get("DATA_DIR", str(_REPO_ROOT / "frontend" / "public" / "data")))

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")


# ── JSON helpers ───────────────────────────────────────────────────────────────

def _load(filename: str) -> dict | list | None:
    path = _DATA_DIR / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Section builders ──────────────────────────────────────────────────────────

def _fmt_change(v) -> str:
    if not isinstance(v, (int, float)):
        return ""
    sign = "+" if v >= 0 else ""
    return f" ({sign}{v:.0f})"


def _prices_section() -> str:
    lines = ["<b>Prices</b>"]

    # Futures from acaphe_live.json — first row is always front month
    acaphe = _load("acaphe_live.json")
    if acaphe:
        arabica = acaphe.get("arabica", [])
        robusta = acaphe.get("robusta", [])
        if arabica:
            row = arabica[0]
            last = row.get("last")
            if last:
                lines.append(f"  KC ({row.get('month', '')}): <b>{last:.2f}c/lb</b>{_fmt_change(row.get('change'))}")
        if robusta:
            row = robusta[0]
            last = row.get("last")
            if last:
                lines.append(f"  RC ({row.get('month', '')}): <b>{last:.0f} USD/t</b>{_fmt_change(row.get('change'))}")

    # Physical prices from latest_prices.json
    latest = _load("latest_prices.json")
    if latest:
        tickers = latest.get("tickers", [])
        phys_labels = {"VN FAQ", "CON T7", "UGA S15"}
        for t in tickers:
            if t.get("label") in phys_labels:
                lines.append(f"  {t['label']}: {t['value']}")

    # FX from latest_prices.json
    if latest:
        tickers = latest.get("tickers", [])
        fx_labels = ["USD/BRL", "USD/VND", "USD/IDR"]
        fx_parts = []
        for t in tickers:
            if t.get("label") in fx_labels:
                fx_parts.append(f"{t['label']}={t['value']}")
        if fx_parts:
            lines.append(f"  FX: {' | '.join(fx_parts)}")

    return "\n".join(lines) if len(lines) > 1 else ""


def _cot_section() -> str:
    cot_data = _load("cot_recent.json")
    if not cot_data or not isinstance(cot_data, list):
        return ""

    latest = cot_data[-1]
    date_str = latest.get("date", "?")
    ny = latest.get("ny", {})

    mm_long  = ny.get("mm_long")
    mm_short = ny.get("mm_short")
    if mm_long is None or mm_short is None:
        return ""

    mm_net = mm_long - mm_short
    sign   = "+" if mm_net >= 0 else ""

    # CFTC report covers positions as of Tuesday close, published Friday
    age_str = ""
    try:
        report_date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=UTC)
        days_old = (datetime.now(UTC) - report_date).days
        if days_old > 0:
            age_str = f" · {days_old}d old"
    except (ValueError, TypeError):
        pass

    # Week-on-week change if previous row exists
    wow_str = ""
    if len(cot_data) >= 2:
        prev_ny = cot_data[-2].get("ny", {})
        p_long  = prev_ny.get("mm_long", 0)
        p_short = prev_ny.get("mm_short", 0)
        p_net   = (p_long or 0) - (p_short or 0)
        delta   = mm_net - p_net
        wow_str = f" (WoW {'+' if delta >= 0 else ''}{delta:,})"

    pmpu_net = (ny.get("pmpu_long", 0) or 0) - (ny.get("pmpu_short", 0) or 0)

    return (
        f"<b>CoT — NY Arabica</b> (report week {date_str}{age_str})\n"
        f"  MM net: <b>{sign}{mm_net:,} lots</b>{wow_str}\n"
        f"  Producers net: {'+' if pmpu_net >= 0 else ''}{pmpu_net:,} lots"
    )


def _weather_alerts_section() -> str:
    """Collect HIGH drought or CSI alerts across all country supply JSONs."""
    alerts = []
    files = [
        ("brazil_supply",    "Brazil"),
        ("vietnam_supply",   "Vietnam"),
        ("colombia_supply",  "Colombia"),
        ("honduras_supply",  "Honduras"),
        ("indonesia_supply", "Indonesia"),
        ("uganda_supply",    "Uganda"),
        ("ethiopia_supply",  "Ethiopia"),
    ]
    for fname, country in files:
        data = _load(f"{fname}.json")
        if not data:
            continue
        weather = data.get("weather")
        if not weather:
            continue
        for reg in weather.get("regions", []):
            name   = reg.get("name", "?")
            drought = reg.get("drought", "NONE")
            csi_30  = reg.get("csi_30d_level", "NONE")
            if drought == "HIGH":
                alerts.append(f"  DROUGHT HIGH — {country}/{name}")
            if csi_30 == "HIGH":
                alerts.append(f"  CSI HIGH — {country}/{name}")

    if not alerts:
        return ""
    return "<b>Weather Alerts</b>\n" + "\n".join(alerts)


def _enso_section() -> str:
    # Use brazil supply JSON which has ENSO (sourced from NOAA CPC)
    data = _load("brazil_supply.json") or _load("vietnam_supply.json")
    if not data:
        return ""
    enso = data.get("enso")
    if not enso:
        return ""
    phase     = enso.get("phase", "neutral").replace("-", " ").title()
    intensity = enso.get("intensity", "Weak")
    oni       = enso.get("oni", 0.0)
    direction = enso.get("forecast_direction", "")
    return (
        f"<b>ENSO</b>: {intensity} {phase} (ONI {oni:+.1f})"
        + (f"\n  {direction}" if direction else "")
    )


def _freight_section() -> str:
    data = _load("freight.json")
    if not data:
        return ""
    routes = data.get("routes", [])
    lines = ["<b>Freight (USD/FEU)</b>"]
    key_routes = {"vn-eu", "br-eu", "vn-us"}
    for r in routes:
        if r.get("id") in key_routes:
            rate = r.get("rate")
            prev = r.get("prev")
            chg  = rate - prev if rate and prev else None
            chg_str = f" ({'+' if chg >= 0 else ''}{chg:.0f})" if chg is not None else ""
            lines.append(f"  {r['from']} -> {r['to']}: {rate:,}{chg_str}")
    return "\n".join(lines) if len(lines) > 1 else ""


def _news_section(db) -> str:
    """Last 24h news items — top 5 by recency, sorted by category."""
    if db is None:
        return ""
    try:
        sys.path.insert(0, str(_REPO_ROOT / "backend"))
        from models import NewsItem

        cutoff = datetime.now(UTC) - timedelta(hours=24)
        items = (
            db.query(NewsItem)
            .filter(NewsItem.pub_date >= cutoff)
            .order_by(NewsItem.pub_date.desc())
            .limit(10)
            .all()
        )
        if not items:
            return ""

        by_cat: dict[str, list] = {}
        for it in items[:7]:
            cat = it.category or "general"
            by_cat.setdefault(cat, []).append(it.title)

        lines = ["<b>News (24h)</b>"]
        for cat, titles in by_cat.items():
            lines.append(f"  [{cat.upper()}]")
            for t in titles[:2]:
                lines.append(f"    - {t[:120]}")
        return "\n".join(lines)
    except Exception as e:
        return f"<b>News</b>: error — {e}"


# ── Main ──────────────────────────────────────────────────────────────────────

def build_message(db=None) -> str:
    now_utc = datetime.now(UTC)
    header  = f"<b>Coffee Intel — {now_utc.strftime('%a %d %b %Y')}</b>"

    sections = [header]
    for fn in [_prices_section, _cot_section, _weather_alerts_section, _enso_section, _freight_section]:
        try:
            s = fn()
            if s:
                sections.append(s)
        except Exception as e:
            sections.append(f"[{fn.__name__} error: {e}]")

    try:
        news = _news_section(db)
        if news:
            sections.append(news)
    except Exception as e:
        sections.append(f"[news error: {e}]")

    return "\n\n".join(sections)


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
            sys.path.insert(0, str(_REPO_ROOT / "backend"))
            from database import SessionLocal
            db = SessionLocal()
        except Exception as e:
            print(f"[morning_brief] DB connect failed: {e}")

    try:
        msg = build_message(db)
        print("[morning_brief] Message preview:\n")
        print(msg)
        print()
        send_telegram(msg)
    finally:
        if db:
            db.close()


if __name__ == "__main__":
    main()
