from __future__ import annotations
from telegram.data import load


def handle(args: str, context: dict) -> str:
    chain  = load("futures_chain.json")
    latest = load("latest_prices.json")

    lines = ["<b>Current Prices</b>"]

    if chain:
        arab = chain.get("arabica", {}).get("contracts", [])
        rob  = chain.get("robusta",  {}).get("contracts", [])
        if arab:
            r = arab[0]
            last = r.get("last")
            if last is not None:
                lines.append(f"  KC ({r.get('symbol','?')})  {last:.2f} ¢/lb")
        if rob:
            r = rob[0]
            last = r.get("last")
            if last is not None:
                lines.append(f"  RC ({r.get('symbol','?')})  {last:,.0f} USD/MT")

    if latest:
        tickers = latest.get("tickers", [])
        phys_labels = {"VN FAQ", "CON T7", "UGA S15"}
        for t in tickers:
            if t.get("label") in phys_labels:
                lines.append(f"  {t['label']}: {t['value']}")
        fx_labels = {"USD/BRL", "USD/VND", "USD/IDR"}
        fx = [f"{t['label']}={t['value']}" for t in tickers if t.get("label") in fx_labels]
        if fx:
            lines.append("  FX: " + " | ".join(fx))

    return "\n".join(lines) if len(lines) > 1 else "Price data unavailable. Run /run prices"
