from __future__ import annotations

from telegram.data import load


def handle(args: str, context: dict) -> str:
    data = load("demand_stocks.json")
    if not data:
        return "ECF data unavailable. Run /run ecf"

    ecf = data.get("ecf", {})
    monthly = ecf.get("monthly", [])
    if not monthly:
        return "ECF data empty."

    last4 = monthly[-4:]
    lines = [
        "<b>ECF European Port Stocks</b>",
        f"Updated: {ecf.get('last_updated', '?')}",
        "",
    ]
    for i, m in enumerate(last4):
        prev = last4[i - 1] if i > 0 else None
        mom = ""
        if prev:
            delta = m["value_mt"] - prev["value_mt"]
            pct   = delta / prev["value_mt"] * 100
            mom   = f"  ({'+' if delta >= 0 else ''}{delta:,} MT / {'+' if pct >= 0 else ''}{pct:.1f}%)"
        lines.append(f"  {m['period']}: {m['value_mt']:,} MT{mom}")
    return "\n".join(lines)
