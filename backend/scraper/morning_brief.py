"""
morning_brief.py
Daily Telegram brief: futures (front 2 + calendar spreads), local origin
prices with replacement values, FX, CoT positioning, weather alerts,
freight, macro (Coffee Currency Index + cross-commodity), and news.

Reads from static JSON files (written by export_static_json.py) + the
NewsItem DB table.

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
import re
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


# ── Number / unit formatting ──────────────────────────────────────────────────

def _signed(v: float, decimals: int = 2) -> str:
    return f"{v:+.{decimals}f}"

def _fmt_eu_int(n: float) -> str:
    """European thousand-separator format: 87100 → '87.100'."""
    return f"{int(n):,}".replace(",", ".")

def _fmt_brl(n: float) -> str:
    """Brazilian decimal format: 900.0 → '900,00'."""
    return f"{n:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


# ── Futures section ───────────────────────────────────────────────────────────

# Conversion constant: cents/lb → USD/ton.
CENTS_LB_TO_USD_TON = 22.0462

def _month_code(month_str: str) -> str:
    """'AN 07/26' → 'N'; 'RN 07/26' → 'N'.

    The acaphe label is "{commodity_letter}{month_letter} MM/YY" — the
    month letter is the second character of the first token.
    """
    parts = month_str.split()
    if not parts:
        return "?"
    head = parts[0]
    return head[1] if len(head) >= 2 else "?"


def _active_contracts(chain: list[dict]) -> list[dict]:
    """Drop contracts that are in or past First Notice Day.

    `fut_fnd` is populated by the acaphe scraper when a contract is
    approaching, at, or past FND — those are no longer the relevant
    speculative price anchor. Returns the chronologically next
    trade-able contracts.
    """
    if not chain:
        return []
    return [c for c in chain if not c.get("fut_fnd")]


def _spread(curr_front: float, curr_back: float,
            prev_front: float | None, prev_back: float | None) -> tuple[float, float | None]:
    """Calendar spread (front − back) and its day-on-day change."""
    spread = curr_front - curr_back
    if prev_front is None or prev_back is None:
        return spread, None
    return spread, spread - (prev_front - prev_back)


def _prices_section() -> str:
    """Two front non-FND contracts + the next two calendar spreads, per market."""
    acaphe = _load("acaphe_live.json")
    if not acaphe:
        return ""

    out = ["<b>Prices</b>"]

    for label, key, unit, dp in [
        ("KC", "arabica", "c/lb",   2),
        ("RC", "robusta", "USD/t",  0),
    ]:
        chain = _active_contracts(acaphe.get(key, []))
        if len(chain) < 2:
            continue

        # First, second, third (for the second spread). Third is optional.
        c1, c2 = chain[0], chain[1]
        c3 = chain[2] if len(chain) >= 3 else None

        # Loop-bound vars (`dp`, `unit`, `label`) are pinned via default args
        # so ruff's B023 sees the binding as static — closures rebuilt every
        # iteration anyway, the defaults just make the binding explicit.
        def _row(contract: dict, dp: int = dp, unit: str = unit, label: str = label) -> str:
            month = _month_code(contract.get("month", ""))
            price = contract.get("last")
            chg   = contract.get("change")
            if price is None:
                return ""
            price_str = f"{price:.{dp}f} {unit}"
            chg_str   = f" ({_signed(chg, dp)})" if isinstance(chg, (int, float)) else ""
            return f"{label} {month}: <b>{price_str}</b>{chg_str}"

        for c in [c1, c2]:
            line = _row(c)
            if line:
                out.append(line)

        # Calendar spreads — front/second, second/third
        def _spread_line(a: dict, b: dict, dp: int = dp) -> str | None:
            af, bf = a.get("last"), b.get("last")
            ap, bp = a.get("prev"), b.get("prev")
            if af is None or bf is None:
                return None
            s, ds = _spread(af, bf, ap, bp)
            am = _month_code(a.get("month", ""))
            bm = _month_code(b.get("month", ""))
            s_str  = _signed(s, dp)
            ds_str = f" ({_signed(ds, dp)})" if ds is not None else ""
            return f"  {am}/{bm}: {s_str}{ds_str}"

        sp1 = _spread_line(c1, c2)
        if sp1:
            out.append(sp1)
        if c3:
            sp2 = _spread_line(c2, c3)
            if sp2:
                out.append(sp2)

        out.append("")  # blank between KC and RC blocks

    return "\n".join(out).rstrip()


# ── Cost detail / replacement ─────────────────────────────────────────────────

# Approximate farm-gate-to-FOB cost in USD/ton. Editable here when the
# logistics chain shifts; used to compute "replacement" — what a roaster
# pays to land green from this origin vs the futures front.
FARM_TO_FOB_USD_TON: dict[str, int] = {
    "VN FAQ":  50,
    "CON T7":  200,
    "UGA S15": 200,
    "BR ARA":  200,
}

# Reference contract per origin — Arabica origins benchmark against KC,
# Robusta origins against RC. The letter in the line ("K", "N", "U", ...)
# is filled in dynamically from whichever month was chosen as the front
# non-FND contract above.
_ROBUSTA_ORIGINS = {"VN FAQ", "CON T7", "UGA S15"}
_ARABICA_ORIGINS = {"BR ARA"}


def _fx_dict() -> dict[str, float]:
    """Parse `latest_prices.json` FX rates into a {label: float} map.

    The file stores them as `{label: "USD/BRL", value: "5.0486"}` — we
    just want a name → rate lookup.
    """
    latest = _load("latest_prices.json")
    out: dict[str, float] = {}
    if not latest:
        return out
    for t in latest.get("tickers", []):
        if t.get("category") != "fx":
            continue
        try:
            out[t["label"]] = float(str(t["value"]).replace(",", ""))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _front_usd_t(label: str, acaphe: dict | None) -> tuple[str, float | None]:
    """(month_letter, USD/ton price) of the relevant front contract.

    Robusta origins anchor against RC N (the front-eligible Robusta
    contract); Arabica origins against KC N. Front-eligible = first
    chain entry whose fut_fnd is null.
    """
    if not acaphe:
        return "?", None
    chain_key = "arabica" if label in _ARABICA_ORIGINS else "robusta"
    chain = _active_contracts(acaphe.get(chain_key, []))
    if not chain:
        return "?", None
    front = chain[0]
    month = _month_code(front.get("month", ""))
    price = front.get("last")
    if price is None:
        return month, None
    if chain_key == "arabica":
        return month, float(price) * CENTS_LB_TO_USD_TON
    return month, float(price)


def _replacement_line(label: str, local_value: float, unit_label: str,
                      usd_t: float, ref_month: str, ref_usd_t: float | None) -> list[str]:
    farm_fob = FARM_TO_FOB_USD_TON.get(label, 0)
    lines = []
    # Local + USD on one line (matches the live frontend table).
    if label == "VN FAQ":
        local_str = f"{_fmt_eu_int(local_value)} VND"
    elif label in ("CON T7", "BR ARA"):
        local_str = f"{_fmt_brl(local_value)} BRL"
    else:  # UGA S15 already in USD
        local_str = f"{local_value:.2f}"
    lines.append(f"  <b>{label}</b>: {local_str} (${usd_t:,.0f})")
    lines.append(f"  {unit_label}: {farm_fob}")
    if ref_usd_t is not None:
        repl = (usd_t + farm_fob) - ref_usd_t
        lines.append(f"  Replacement: {ref_month}{_signed(repl, 0)}")
    return lines


def _cost_detail_section() -> str:
    """Per-origin local price, USD conversion, farm-to-FOB, replacement vs futures front."""
    origins_doc = _load("origin_prices_history.json") or {}
    origins = origins_doc.get("origins", {})
    fx = _fx_dict()
    acaphe = _load("acaphe_live.json")
    rc_month, rc_usd_t = _front_usd_t("VN FAQ", acaphe)        # RC for any robusta origin
    kc_month, kc_usd_t = _front_usd_t("BR ARA", acaphe)        # KC for arabica origins

    def _latest_price(slot_name: str) -> float | None:
        history = (origins.get(slot_name) or {}).get("history") or []
        if not history:
            return None
        return history[-1].get("price")

    lines: list[str] = []

    # Vietnam — VND/kg → USD/ton = VND/kg ÷ FX × 1000.
    vn = _latest_price("vietnam")
    if vn is not None and (rate := fx.get("USD/VND")):
        usd_t = vn / rate * 1000
        lines += _replacement_line(
            "VN FAQ", vn, "Farm gate to FOB",
            usd_t, rc_month, rc_usd_t,
        )

    # Brazil Conilon Tipo 7 — BRL/saca-60kg → USD/ton = BRL/60kg ÷ FX × 1000.
    cn = _latest_price("brazil_conilon")
    if cn is not None and (rate := fx.get("USD/BRL")):
        usd_t = cn / 60 / rate * 1000
        lines += _replacement_line(
            "CON T7", cn, "Farm gate to FOB",
            usd_t, rc_month, rc_usd_t,
        )

    # Uganda Screen 15 — USD/cwt (100 lb = 45.359 kg) → USD/ton = price × 22.046.
    ug = _latest_price("uganda")
    if ug is not None:
        usd_t = ug * 22.0462
        lines += _replacement_line(
            "UGA S15", ug, "Farm gate to FOB",
            usd_t, rc_month, rc_usd_t,
        )

    # Brazil Arabica — same conversion as Conilon. Pre-#61, brazil_arabica
    # history was empty in production; with the CEPEA NewsItem hookup the
    # daily price will start populating and this block will surface.
    ba = _latest_price("brazil_arabica")
    if ba is not None and (rate := fx.get("USD/BRL")):
        usd_t = ba / 60 / rate * 1000
        lines += _replacement_line(
            "BR ARA", ba, "Farm gate to FOB",
            usd_t, kc_month, kc_usd_t,
        )

    return "\n".join(lines) if lines else ""


# ── FX section ────────────────────────────────────────────────────────────────

def _fx_section() -> str:
    latest = _load("latest_prices.json")
    if not latest:
        return ""
    keep = {"USD/BRL", "USD/VND", "USD/IDR"}
    rows = []
    for t in latest.get("tickers", []):
        if t.get("category") == "fx" and t.get("label") in keep:
            rows.append(f"  {t['label']}={t['value']}")
    if not rows:
        return ""
    return "<b>FX</b>\n" + "\n".join(rows)


# ── CoT section (kept simple — full signal listing deferred to Phase 2) ──────

def _cot_section() -> str:
    """Latest MM net for NY + age. Signals listing waits on Phase 2
    (Python port of signalEngine OR pre-export from the frontend build)."""
    cot_data = _load("cot_recent.json")
    if not cot_data or not isinstance(cot_data, list):
        return ""

    latest = cot_data[-1]
    date_str = latest.get("date", "?")
    ny  = latest.get("ny", {})
    ldn = latest.get("ldn", {})

    def _net(side: dict) -> int | None:
        ml = side.get("mm_long"); ms = side.get("mm_short")
        return None if ml is None or ms is None else int(ml - ms)

    ny_net  = _net(ny)
    ldn_net = _net(ldn)
    if ny_net is None and ldn_net is None:
        return ""

    age_str = ""
    try:
        report_date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=UTC)
        days_old = (datetime.now(UTC) - report_date).days
        if days_old > 0:
            age_str = f" · {days_old}d old"
    except (ValueError, TypeError):
        pass

    prev = cot_data[-2] if len(cot_data) >= 2 else {}
    def _net_change(curr: int | None, side_prev: dict) -> str:
        prev_net = _net(side_prev or {})
        if curr is None or prev_net is None:
            return ""
        return f" (WoW {_signed(curr - prev_net, 0)})"

    lines = [f"<b>CoT</b> (report week {date_str}{age_str})"]
    if ny_net is not None:
        lines.append(f"  NY MM net: <b>{_signed(ny_net, 0)} lots</b>{_net_change(ny_net, prev.get('ny', {}))}")
    if ldn_net is not None:
        lines.append(f"  LDN MM net: <b>{_signed(ldn_net, 0)} lots</b>{_net_change(ldn_net, prev.get('ldn', {}))}")
    return "\n".join(lines)


# ── Weather alerts (kept as-is — seasonal-baseline filtering is Phase 2) ─────

def _weather_alerts_section() -> str:
    """Collect HIGH drought or CSI alerts across all country supply JSONs.

    NOTE: doesn't filter for seasonality yet. A region's DROUGHT=HIGH may
    be a normal dry-season reading rather than an anomaly — the seasonal
    filter (Phase 2) needs per-region monthly baselines that don't exist
    in the current data files.
    """
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


# ── Freight ───────────────────────────────────────────────────────────────────

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
            chg_str = f" ({_signed(chg, 0)})" if chg is not None else ""
            lines.append(f"  {r['from']} -> {r['to']}: {rate:,}{chg_str}")
    return "\n".join(lines) if len(lines) > 1 else ""


# ── News section — inline data label extraction ──────────────────────────────

# Mirrors frontend/components/map/NewsFeed.tsx::extractDataLabel.
_RE_BRL = re.compile(r"R\$\s*([\d.,]+)\s*(?:/\s*([A-Za-zçãáéõ]+))?")
_RE_USD_PREFIX = re.compile(r"USD\s*([\d.,]+)\s*(?:/\s*([A-Za-z]+))?")
_RE_DOLLAR     = re.compile(r"\$\s*([\d.,]+)\s*(?:/\s*([A-Za-z]+))?")
_RE_VOLUME     = re.compile(r"(\d[\d.,]*)\s*(kt|mln|million|thousand|bags|tonnes|k_bags)", re.IGNORECASE)


def _extract_data_label(body: str | None) -> str | None:
    if not body:
        return None
    m = _RE_BRL.search(body)
    if m:
        unit = f" / {m.group(2)}" if m.group(2) else ""
        return f"{m.group(1)} BRL{unit}"
    m = _RE_USD_PREFIX.search(body)
    if m:
        unit = f" / {m.group(2)}" if m.group(2) else ""
        return f"{m.group(1)} USD{unit}"
    m = _RE_DOLLAR.search(body)
    if m:
        unit = f" / {m.group(2)}" if m.group(2) else ""
        return f"{m.group(1)} USD{unit}"
    m = _RE_VOLUME.search(body)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return None


def _news_section(db) -> str:
    """Last 24h news items grouped by category, with the extracted data label
    inlined when one is present in the item body (otherwise just the title).

    "Next 24h to watch out" is not built — there is no scheduled-events
    data source in the current pipeline. That bucket is Phase 2.
    """
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
            .limit(15)
            .all()
        )
        if not items:
            return ""

        by_cat: dict[str, list[tuple[str, str | None]]] = {}
        for it in items:
            cat = (it.category or "general").upper()
            label = _extract_data_label(it.body)
            by_cat.setdefault(cat, []).append((it.title or "", label))

        lines = ["<b>News (last 24h)</b>"]
        for cat, rows in by_cat.items():
            lines.append(f"  [{cat}]")
            for title, label in rows[:3]:
                title_clean = title[:120]
                if label:
                    lines.append(f"    - {title_clean} : <b>{label}</b>")
                else:
                    lines.append(f"    - {title_clean}")
        return "\n".join(lines)
    except Exception as e:
        return f"<b>News</b>: error — {e}"


# ── Macro: Coffee Currency Index + cross-commodity weekly perf ───────────────

# Symbols rolled into the "Energy" cross-commodity line. The macro_cot file
# sectors crude, distillates, and natgas under the umbrella `hard` category
# alongside metals, so we hand-pick the energy subset rather than dumping
# the whole bucket.
_ENERGY_SYMBOLS = {"wti", "brent", "natgas", "heating_oil", "rbob", "lsgo"}


def _macro_section() -> str:
    lines: list[str] = []

    # Coffee Currency Index — value, daily delta %, z-score (if present).
    quant = _load("quant_report.json") or {}
    ci = quant.get("currency_index", {}) if isinstance(quant, dict) else {}
    idx = ci.get("index_value")
    if isinstance(idx, (int, float)):
        dlt = ci.get("daily_delta_pct")
        z   = ci.get("zscore")
        delta_str = f" ({_signed(dlt, 2)}%)" if isinstance(dlt, (int, float)) else ""
        z_str     = f", z={_signed(z, 2)}" if isinstance(z, (int, float)) else ""
        lines.append(f"  Coffee Currency Index: <b>{idx:.2f}</b>{delta_str}{z_str}")

    # Cross-commodity weekly % change from macro_cot. Last week's vs prev.
    macro = _load("macro_cot.json")
    if isinstance(macro, list) and len(macro) >= 2:
        curr_w = macro[-1].get("commodities") or []
        prev_w = {c.get("symbol"): c for c in (macro[-2].get("commodities") or [])}

        def _pct(curr_p: float | None, prev_p: float | None) -> float | None:
            if not (isinstance(curr_p, (int, float)) and isinstance(prev_p, (int, float))):
                return None
            if prev_p <= 0:
                return None
            return (curr_p - prev_p) / prev_p * 100

        buckets: dict[str, list[tuple[str, float]]] = {
            "Softs":  [],
            "Grains": [],
            "Energy": [],
        }
        for c in curr_w:
            sym    = c.get("symbol")
            sector = c.get("sector")
            curr_p = c.get("close_price")
            prev_c = prev_w.get(sym, {})
            prev_p = prev_c.get("close_price")
            chg    = _pct(curr_p, prev_p)
            if chg is None:
                continue
            if sector == "softs":
                buckets["Softs"].append((sym, chg))
            elif sector == "grains":
                buckets["Grains"].append((sym, chg))
            elif sector == "hard" and sym in _ENERGY_SYMBOLS:
                buckets["Energy"].append((sym, chg))

        for sector_label, items in buckets.items():
            if not items:
                continue
            items.sort(key=lambda x: -abs(x[1]))
            parts = [f"{s} {_signed(c, 1)}%" for s, c in items[:4]]
            lines.append(f"  {sector_label}: {', '.join(parts)}")

    if not lines:
        return ""
    return "<b>Macro</b>\n" + "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def build_message(db=None) -> str:
    now_utc = datetime.now(UTC)
    header  = f"<b>Coffee Intel — {now_utc.strftime('%a %d %b %Y')}</b>"

    static_sections = [
        _prices_section,
        _cost_detail_section,
        _fx_section,
        _cot_section,
        _weather_alerts_section,
        _freight_section,
        _macro_section,
    ]

    sections = [header]
    for fn in static_sections:
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
