from __future__ import annotations

from telegram.data import load

# Severity (lowercase) → fixed-width display tag. CRIT/ALERT/WARN/INFO matches
# the per-rule listing block format spec in issue #132 Body-1.
#
# Schema drift caught on first live render: existing quant signals (CR5, ML5,
# …) use severity="warn"; the Phase 5 agronomic engine (PR #140) uses
# severity="watch". Both denote the same severity tier. We accept both spellings
# everywhere so the sort + display work uniformly across categories. The
# /signals page refactor (issue #132 item 21) should converge them at the
# source eventually; until then, this handler treats them as synonyms.
_SEVERITY_TAG = {
    "critical": "CRIT",
    "alert":    "ALERT",
    "watch":    "WARN",
    "warn":     "WARN",
    "info":     "INFO",
}
_SEVERITY_RANK = {"critical": 4, "alert": 3, "watch": 2, "warn": 2, "info": 1}


def _signal_line(s: dict) -> str:
    """One Telegram-formatted line: `  [TAG] id name (+score, magnitude)`."""
    sev = (s.get("severity") or "info").lower()
    tag = _SEVERITY_TAG.get(sev, sev.upper()[:5])
    score = s.get("score", 0)
    magnitude = s.get("magnitude", "")
    score_str = f"{'+' if score > 0 else ''}{score}"
    detail = f"{score_str}, {magnitude}" if magnitude else score_str
    return f"  [{tag}] {s.get('id', '?')} {s.get('name', '')} ({detail})"


def _format_signals_block(signals: list, market: str) -> list[str]:
    """Filter signals to the given market, sort by severity then |score|,
    return display lines including the header. Empty list if no signals."""
    filtered = [s for s in signals if s.get("market") == market]
    if not filtered:
        return []
    filtered.sort(key=lambda s: (-_SEVERITY_RANK.get((s.get("severity") or "info").lower(), 0),
                                  -abs(s.get("score", 0))))
    lines = [f"\nSignals ({market}):"]
    lines.extend(_signal_line(s) for s in filtered)
    return lines


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

    # Per-rule signals block (issue #132 Body-1). signals.json is published
    # daily by workflow 1.4; AGRO rows have market="PHYS" and are excluded
    # naturally by the NY/LDN filter — they belong on a future /agro command.
    sig_doc = load("signals.json")
    if isinstance(sig_doc, dict):
        signals = sig_doc.get("signals") or []
        if signals:
            lines.extend(_format_signals_block(signals, "NY"))
            lines.extend(_format_signals_block(signals, "LDN"))

    return "\n".join(lines)
