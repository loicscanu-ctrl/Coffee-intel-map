from __future__ import annotations
from telegram.data import load


def _arrow(current, previous) -> str:
    if current is None or previous is None:
        return "?"
    return "▲" if current > previous else "▼" if current < previous else "→"


def _net(row: dict, key_long: str, key_short: str) -> int | None:
    l = row.get(key_long)
    s = row.get(key_short)
    if l is None or s is None:
        return None
    return l - s


def _find_rows(data: list) -> tuple[dict | None, dict | None]:
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


def handle(args: str, context: dict) -> str:
    data = load("cot_recent.json")
    if not data or not isinstance(data, list):
        return "No COT data available yet."

    latest, prev = _find_rows(data)
    if not latest:
        return "No COT data available yet."

    date_str = latest["date"]
    lines = [f"<b>COT Report — wk {date_str}</b>"]

    for market, mkt_key, price_key, unit in [
        ("NY Arabica (KC)", "ny",  "price_ny",  "¢/lb"),
        ("London Robusta (RC)", "ldn", "price_ldn", "USD/MT"),
    ]:
        cur = latest.get(mkt_key, {})
        prv = prev.get(mkt_key, {}) if prev else {}

        mm_net   = _net(cur, "mm_long", "mm_short")
        p_mm_net = _net(prv, "mm_long", "mm_short") if prv else None

        if mm_net is not None and p_mm_net is not None:
            delta = mm_net - p_mm_net
            wow = f" {_arrow(mm_net, p_mm_net)}{'+' if delta >= 0 else ''}{delta:,} WoW"
        else:
            wow = ""

        prod_net = _net(cur, "pmpu_long", "pmpu_short")
        p_prod   = _net(prv, "pmpu_long", "pmpu_short") if prv else None
        if prod_net is not None and p_prod is not None:
            pd = prod_net - p_prod
            prod_wow = f" {_arrow(prod_net, p_prod)}{'+' if pd >= 0 else ''}{pd:,} WoW"
        else:
            prod_wow = ""

        oi      = cur.get("oi_total")
        p_oi    = prv.get("oi_total") if prv else None
        price   = cur.get(price_key)
        p_price = prv.get(price_key) if prv else None

        lines.append(f"\n── {market} ──")
        if price is not None:
            lines.append(f"Price: {price:,.2f} {unit}  {_arrow(price, p_price)}")
        if oi is not None:
            lines.append(f"OI:    {oi:,}  {_arrow(oi, p_oi)}")
        if mm_net is not None:
            sign = "+" if mm_net >= 0 else ""
            lines.append(f"MM net: {sign}{mm_net:,}{wow}")
            lines.append(f"  longs: {cur.get('mm_long', 0):,} / shorts: {cur.get('mm_short', 0):,}")
        if prod_net is not None:
            sign = "+" if prod_net >= 0 else ""
            lines.append(f"Producers: {sign}{prod_net:,}{prod_wow}")
            lines.append(f"  shorts: {cur.get('pmpu_short', 0):,} / longs: {cur.get('pmpu_long', 0):,}")
        if mm_net is None and prod_net is None:
            lines.append("  (data pending next release)")

    return "\n".join(lines)
