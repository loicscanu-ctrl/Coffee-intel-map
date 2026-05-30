from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from telegram.data import load

STC = {1:"H",2:"H",3:"K",4:"K",5:"N",6:"N",7:"U",8:"U",9:"X",10:"X",11:"F",12:"F"}


def _arrow(a, b) -> str:
    if a is None or b is None:
        return "?"
    return "▲" if a > b else "▼" if a < b else "→"


def _rc_section(chain: dict | None, acaphe: dict | None) -> tuple[str, str | None, float | None]:
    """Returns (formatted line, front RC contract letter, front price)."""
    if not chain:
        return "RC  data unavailable", None, None
    contracts = chain.get("robusta", {}).get("contracts", [])
    if not contracts:
        return "RC  data unavailable", None, None
    c    = contracts[0]
    last = c.get("last")
    sym  = c.get("symbol", "?")
    m    = re.match(r'^RM([A-Z])', sym)
    letter = m.group(1) if m else "?"
    if last is None:
        return f"RC  data unavailable ({sym})", letter, None
    # Try acaphe_live for daily change
    change = None
    if acaphe:
        rob_live = acaphe.get("robusta", [])
        if rob_live:
            change = rob_live[0].get("change")
    arrow   = ("▲" if change > 0 else "▼" if change < 0 else "→") if change is not None else "→"
    delta_s = f"{arrow}{change:+,.0f}" if change is not None else arrow
    return f"RC   {last:,.0f}  {delta_s}   ({sym})", letter, last


def _kc_section(chain: dict | None, acaphe: dict | None) -> str:
    if not chain:
        return "KC  data unavailable"
    contracts = chain.get("arabica", {}).get("contracts", [])
    if not contracts:
        return "KC  data unavailable"
    c    = contracts[0]
    last = c.get("last")
    sym  = c.get("symbol", "?")
    if last is None:
        return "KC  data unavailable"
    change = None
    if acaphe:
        arab_live = acaphe.get("arabica", [])
        if arab_live:
            change = arab_live[0].get("change")
    arrow   = ("▲" if change > 0 else "▼" if change < 0 else "→") if change is not None else "→"
    delta_s = f"{arrow}{change:+.2f}" if change is not None else arrow
    return f"KC   {last:.2f}  {delta_s}   ({sym})"


def _vn_faq_line(latest: dict | None, front_letter: str | None, front_price: float | None) -> str:
    if not latest:
        return ""
    for t in latest.get("tickers", []):
        if t.get("label") == "VN FAQ":
            val = t["value"]
            # Format: "87.700 VND ($3,347)"
            m_vnd = re.match(r'^([\d.]+)\s+VND', val)
            m_usd = re.search(r'\$([0-9,]+)', val)
            if m_vnd and m_usd and front_price:
                vnd = int(m_vnd.group(1).replace(".", ""))
                usd = int(m_usd.group(1).replace(",", ""))
                diff = round(usd - front_price + 100)
                letter = front_letter or "N"
                return f"VN FAQ  {vnd:,} VND · {letter}{diff:+d} (incl. +100 logistics)"
            return f"VN FAQ  {val}"
    return ""


def _find_cot_rows(data: list) -> tuple[dict | None, dict | None]:
    latest = prev = None
    for row in reversed(data):
        ny = row.get("ny", {})
        if ny.get("mm_long") is not None:
            if latest is None:
                latest = row
            elif prev is None:
                prev = row
                break
    return latest, prev


def _cot_brief_block(cot_data: list | None) -> str:
    if not cot_data:
        return ""
    latest, prev = _find_cot_rows(cot_data)
    if not latest:
        return ""

    date_str = latest["date"]
    try:
        d  = datetime.strptime(date_str, "%Y-%m-%d")
        wk = f"{d.day} {d.strftime('%b')}"
    except ValueError:
        wk = date_str

    blocks = []
    for label, mkt_key, price_key, unit in [
        ("COT KC", "ny",  "price_ny",  "¢/lb"),
        ("COT RC", "ldn", "price_ldn", "USD/MT"),
    ]:
        cur = latest.get(mkt_key, {})
        prv = prev.get(mkt_key, {}) if prev else {}

        mm_long  = cur.get("mm_long")
        mm_short = cur.get("mm_short")
        if mm_long is None:
            blocks.append(f"<b>{label}</b> (wk {wk}): data pending")
            continue

        mm_net   = mm_long - mm_short
        p_mm_net = ((prv.get("mm_long") or 0) - (prv.get("mm_short") or 0)) if prv else None
        wow_delta = mm_net - p_mm_net if p_mm_net is not None else None

        price   = cur.get(price_key)
        p_price = prv.get(price_key) if prv else None
        oi      = cur.get("oi_total")
        p_oi    = prv.get("oi_total") if prv else None
        prod_net  = (cur.get("pmpu_long") or 0) - (cur.get("pmpu_short") or 0)
        p_prod    = ((prv.get("pmpu_long") or 0) - (prv.get("pmpu_short") or 0)) if prv else None
        other_net = (cur.get("other_long") or 0) - (cur.get("other_short") or 0)
        p_other   = ((prv.get("other_long") or 0) - (prv.get("other_short") or 0)) if prv else None

        price_s = f"{price:,.2f} {unit}" if price else "?"
        oi_s    = f"{oi:,}" if oi else "?"
        sign    = "+" if mm_net >= 0 else ""
        wow_s   = f" {_arrow(mm_net, p_mm_net)}{'+' if (wow_delta or 0) >= 0 else ''}{wow_delta:,}" if wow_delta is not None else ""

        lines = [
            f"<b>{label}</b> (wk {wk}):",
            f"Price {_arrow(price, p_price)} {price_s} · OI {_arrow(oi, p_oi)} {oi_s}",
            f"Roasters {_arrow(other_net, p_other)} · Producers {_arrow(prod_net, p_prod)}",
            f"MM net {sign}{mm_net:,}{wow_s}",
        ]
        blocks.append("\n".join(lines))

    return "\n\n".join(blocks)


def _brazil_brief_block(daily: dict | None) -> str:
    if not daily:
        return ""
    section = daily.get("arabica", {})
    if not section:
        return ""
    month = sorted(section.keys())[-1]
    days  = sorted(section[month].keys(), key=int)
    day   = days[-1]

    arab = section[month][day]
    con  = (daily.get("conillon", {}).get(month, {}).get(day) or 0)
    sol  = (daily.get("soluvel",  {}).get(month, {}).get(day) or 0)
    total = arab + con + sol

    yr, mo = map(int, month.split("-"))
    mo -= 1
    if mo == 0:
        mo, yr = 12, yr - 1
    pm = f"{yr:04d}-{mo:02d}"
    day_int = int(day)

    def prior(key: str) -> int | None:
        s = daily.get(key, {}).get(pm, {})
        avail = sorted(s.keys(), key=int)
        best = next((d for d in reversed(avail) if int(d) <= day_int), None)
        return s[best] if best else None

    p_arab = prior("arabica")
    p_con  = prior("conillon")
    p_sol  = prior("soluvel")

    lines = [
        f"<b>Brazil daily reg</b> ({month}/{day}): {total:,} bags",
        "MoM:",
    ]
    for label, cur, prv in [("Arabica", arab, p_arab), ("Conilon", con, p_con), ("Soluble", sol, p_sol)]:
        if prv is not None:
            d = cur - prv
            lines.append(f"  {_arrow(cur, prv)}{'+' if d >= 0 else ''}{d:,} {label}")
        else:
            lines.append(f"  {label}: {cur:,}")
    return "\n".join(lines)


def _drought_below_seasonal_floor(reg: dict) -> bool:
    """True iff this region's current MTD rain is below the historical
    minimum MTD rain for THIS calendar month — i.e. the dryness is
    record-breaking for the season, not just an absolute-rainfall reading
    the upstream scraper flagged as HIGH.

    Without this gate, the brief alerts every "drought=HIGH" reading
    including normal seasonal dryness (Sul de Minas in winter, Central
    Highlands in December, Honduras in March). Issue #132 Body-3.

    Returns False when either field is missing — fail-closed; absence of
    baseline data shouldn't generate noise.
    """
    cur = reg.get("rain_mtd_mm")
    floor = reg.get("rain_hist_min")
    if not isinstance(cur, (int, float)) or not isinstance(floor, (int, float)):
        return False
    return cur < floor


def _weather_line() -> str:
    alerts = []
    supply_files = [
        ("brazil_supply",    "Brazil"),
        ("vietnam_supply",   "Vietnam"),
        ("colombia_supply",  "Colombia"),
        ("honduras_supply",  "Honduras"),
        ("indonesia_supply", "Indonesia"),
        ("ethiopia_supply",  "Ethiopia"),
    ]
    for fname, country in supply_files:
        data = load(f"{fname}.json")
        if not data:
            continue
        weather = data.get("weather", {})
        for reg in weather.get("regions", []):
            # Drought alerts: gated by the seasonal baseline check so we
            # only flag dryness that is anomalous for THIS month. Normal
            # seasonal dry-season readings stay silent on the brief.
            if reg.get("drought") == "HIGH" and _drought_below_seasonal_floor(reg):
                alerts.append(f"{country}/{reg.get('name', '?')} drought")
            # CSI alerts kept as-is — no per-month historical baseline
            # ships in the supply JSON for CSI, and the categorical level
            # H already incorporates an upstream severity assessment that
            # blends multiple stress dimensions (rain + VHI + temp).
            if reg.get("csi_30d_level") == "HIGH":
                alerts.append(f"{country}/{reg.get('name', '?')} CSI")
    return " · ".join(alerts[:3]) if alerts else ""


# Display label per events.json category code. Kept compact ([XXX] prefix
# style) to match the brief's text-dense tone — no emoji decoration.
_EVENT_CATEGORY_LABEL = {
    "wasde":           "WASDE",
    "ico":             "ICO",
    "vietnam_customs": "VN",
    "cecafe":          "CECAFÉ",
    "fnd":             "FND",
    "central_bank":    "CB",
    "other":           "EVT",
}


def _upcoming_events_section(now: datetime | None = None) -> str | None:
    """Format the "Coming up · next 24h" block for the morning brief.

    Reads frontend/public/data/events.json (the hand-curated +
    build_events_calendar.py output) and returns a Telegram block for
    events dated today or tomorrow (UTC day boundary, matching how event
    dates are stored as YYYY-MM-DD without a timezone). Returns None when
    nothing's scheduled so the brief silently omits the section.
    """
    doc = load("events.json")
    if not isinstance(doc, dict):
        return None
    events = doc.get("events") or []
    if not events:
        return None

    today = (now or datetime.now(UTC)).date()
    tomorrow = today + timedelta(days=1)
    today_iso, tomorrow_iso = today.isoformat(), tomorrow.isoformat()

    upcoming = [
        e for e in events
        if isinstance(e, dict) and e.get("date") in (today_iso, tomorrow_iso)
    ]
    if not upcoming:
        return None

    # Chronological — today before tomorrow, then by category for stable
    # ordering across runs.
    upcoming.sort(key=lambda e: (e.get("date") or "", e.get("category") or ""))

    lines = ["🗓 <b>Coming up · next 24h</b>"]
    for e in upcoming:
        when = "Today   " if e["date"] == today_iso else "Tomorrow"
        cat = _EVENT_CATEGORY_LABEL.get(e.get("category") or "other", "EVT")
        title = (e.get("title") or "").strip()
        lines.append(f"  {when} · [{cat}] {title}")
    return "\n".join(lines)


def build_brief_message(db=None) -> str:
    now = datetime.now(UTC)
    # "%-d" strips leading zero on Linux/Mac; falls back to "%d" on Windows
    try:
        day_str = now.strftime("%a %-d %b")
    except ValueError:
        day_str = now.strftime("%a %d %b").lstrip("0").replace(" 0", " ")

    chain  = load("futures_chain.json")
    latest = load("latest_prices.json")
    acaphe = load("acaphe_live.json")
    cot    = load("cot_recent.json")
    daily  = load("cecafe_daily.json")

    rc_line, front_letter, front_price = _rc_section(chain, acaphe)
    kc_line   = _kc_section(chain, acaphe)
    vn_line   = _vn_faq_line(latest, front_letter, front_price)
    cot_block = _cot_brief_block(cot if isinstance(cot, list) else None)
    bra_block = _brazil_brief_block(daily if isinstance(daily, dict) else None)
    weather   = _weather_line()
    upcoming  = _upcoming_events_section(now)

    parts: list[str] = [f"☕ <b>Coffee Intel · {day_str}</b>", ""]
    parts.append(rc_line)
    parts.append(kc_line)
    if vn_line:
        parts.append(vn_line)

    if cot_block:
        parts.append("")
        parts.append(cot_block)

    if bra_block:
        parts.append("")
        parts.append(bra_block)

    if weather:
        parts.append("")
        parts.append(weather)

    if upcoming:
        parts.append("")
        parts.append(upcoming)

    parts.append("")
    parts.append("/quote · /cot · /brazil · /ecf")

    return "\n".join(parts)


def handle(args: str, context: dict) -> str:
    return build_brief_message()
