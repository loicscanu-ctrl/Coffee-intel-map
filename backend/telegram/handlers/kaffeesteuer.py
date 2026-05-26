from __future__ import annotations
from telegram.data import load


def handle(args: str, context: dict) -> str:
    data = load("kaffeesteuer.json")
    if not data:
        return "Kaffeesteuer data unavailable. Run /run kaffeesteuer"

    items = sorted(data.items())
    last3 = items[-3:]
    lines = ["<b>German Coffee Clearances (GZD)</b>", ""]
    for period, val in last3:
        yr, mo = period.split("-")
        prev_key = str(int(yr) - 1) + "-" + mo
        prev_val = data.get(prev_key)
        yoy = ""
        if prev_val:
            pct = (val - prev_val) / prev_val * 100
            yoy = f"  ({'+' if pct >= 0 else ''}{pct:.1f}% YoY)"
        lines.append(f"  {period}: {val:,} bags{yoy}")
    return "\n".join(lines)
