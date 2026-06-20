"""
guatemala.py — Guatemala coffee reference prices (ANACAFE).

ANACAFE publishes daily "Precios de referencia locales" per quality grade, in
GTQ per quintal (100 lb) of café oro. Those grade prices are computed in the
calculator's JavaScript from the NY 'C' close + USD→GTQ rate + a per-grade
differential; only the C closes and the FX are exposed as JSON endpoints.

We try two ways (per the "try both" decision) and keep whichever works:
  A) Render the calculator with Playwright and scrape the displayed GTQ grade
     prices (always current with ANACAFE's own differential), then GTQ→USD.
  B) Fall back to the formula: fetch the C close from the Precios endpoint and
     subtract ANACAFE's per-grade deduction (reverse-engineered from their
     published prices). Always yields a number from a reliable endpoint.

Both paths produce USD per quintal (100 lb), which == US¢/lb numerically, so the
origin table converts ×22.0462 → USD/MT with no FX needed.

NOTE: pro.anacafe.org / whatsapp.anacafe.org must be on the network egress
allowlist for this to fetch (works on the CI runner; this sandbox blocks them).
"""
from __future__ import annotations

import json
import re
from datetime import date


def _today() -> str:
    return date.today().isoformat()


_LAT, _LNG = 14.6349, -90.5069   # Guatemala City
_CALC_URL    = "https://pro.anacafe.org/preciosReferencia/calculator/"
_PRECIOS_URL = "https://whatsapp.anacafe.org/Comunes/Precios"

# Per-grade deduction vs the NY 'C' close, in US¢/lb (== USD per 100-lb quintal),
# reverse-engineered from ANACAFE's published quetzal prices on 2026-06-18:
#   grade_usd_per_qq = C_close − deduction.   e.g. 275.10 − 28.91 = 246.19 (SHB).
# The relative quality steps (ED 0 / Duro +3 / Prima +9) are stable; the base
# tracks ANACAFE's cost stack and may need occasional recalibration.
ANACAFE_DEDUCTION_CENTS = {
    "prima_lavado":       37.91,
    "duro":               31.91,
    "estrictamente_duro": 28.91,
}

# Rendered-page grade label → grade key (longest label matched first).
_GRADE_LABELS = [
    ("estrictamente_duro", "estrictamente duro"),
    ("duro",               "duro"),
    ("prima_lavado",       "prima lavado"),
]


def parse_precios_close(result_text: str) -> float | None:
    """Front-position NY 'C' close from the Precios endpoint's `result` blob
    (the first 'Cierre:  NNN.NN'). Requires a decimal so it skips the
    'Ultimo Cierre: DD/MM/YYYY' date line."""
    m = re.search(r"Cierre:\s*(\d+\.\d+)", result_text or "")
    try:
        return float(m.group(1)) if m else None
    except ValueError:
        return None


def parse_rendered_grades(html: str) -> tuple[dict[str, float], float | None]:
    """Scrape the rendered calculator: GTQ/quintal per grade + the USD→GTQ rate."""
    from bs4 import BeautifulSoup
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

    fx_m = re.search(r"[Tt]ipo de cambio[^0-9]*([0-9]+\.[0-9]+)", text)
    fx = float(fx_m.group(1)) if fx_m else None

    # Mask the longer label so "duro" can't match inside "estrictamente duro".
    masked = re.sub(r"estrictamente\s+duro", "ESTRICTODURO", text, flags=re.I)
    gtq: dict[str, float] = {}
    label_to_token = {"estrictamente_duro": "ESTRICTODURO", "duro": "duro", "prima_lavado": "prima lavado"}
    for key, token in label_to_token.items():
        m = re.search(re.escape(token) + r"\D*Q?\s*([0-9][0-9,]*\.[0-9]{2})", masked, re.I)
        if m:
            try:
                gtq[key] = float(m.group(1).replace(",", ""))
            except ValueError:
                pass
    return gtq, fx


def _make_item(grades_usd_qq: dict[str, float], close: float | None, method: str) -> dict:
    pretty = ", ".join(f"{k.replace('_', ' ').title()} {v:.2f}" for k, v in grades_usd_qq.items())
    return {
        "title":    f"Guatemala ANACAFE Precios de Referencia – {_today()}",
        "body":     (
            f"ANACAFE reference prices (USD/quintal, 100 lb): {pretty}."
            + (f" NY 'C' close {close:.2f}." if close is not None else "")
            + f" [{method}]"
        ),
        "source":   "ANACAFE",
        "category": "supply",
        "lat":      _LAT,
        "lng":      _LNG,
        "tags":     ["price", "guatemala", "anacafe", "arabica", "precio-referencia"],
        "meta":     json.dumps({
            "grades_usd_quintal": grades_usd_qq,   # USD per 100-lb quintal
            "ny_c_close":         close,
            "as_of":              _today(),
            "method":             method,
            "source":             "ANACAFE",
        }),
    }


async def run(page) -> list[dict]:
    grades_usd: dict[str, float] = {}
    close: float | None = None
    method = ""

    # A) Render the calculator and scrape the displayed grade prices. The page
    # shows a loading spinner then fills the prices in asynchronously, so poll
    # the DOM for a few seconds rather than grabbing the content immediately.
    try:
        await page.goto(_CALC_URL, wait_until="networkidle", timeout=30_000)
        gtq: dict[str, float] = {}
        fx: float | None = None
        for _ in range(8):  # up to ~8s after networkidle for the spinner to clear
            await page.wait_for_timeout(1_000)
            gtq, fx = parse_rendered_grades(await page.content())
            if gtq and fx:
                break
        if gtq and fx:
            grades_usd = {k: round(v / fx, 2) for k, v in gtq.items()}
            method = "rendered"
            print(f"[guatemala] scraped {len(grades_usd)} ANACAFE grades from the calculator")
    except Exception as e:
        print(f"[guatemala] calculator render failed: {e}")

    # B) Fetch the NY 'C' close (always — for the stored value + the fallback).
    try:
        resp = await page.request.get(_PRECIOS_URL, timeout=20_000)
        if resp.ok:
            close = parse_precios_close((await resp.json()).get("result", ""))
    except Exception as e:
        print(f"[guatemala] Precios endpoint failed: {e}")

    # Fallback: compute grades from the close + ANACAFE deductions.
    if not grades_usd and close is not None:
        grades_usd = {k: round(close - d, 2) for k, d in ANACAFE_DEDUCTION_CENTS.items()}
        method = "computed"
        print("[guatemala] using computed ANACAFE grades (C close − deduction)")

    if not grades_usd:
        print("[guatemala] no ANACAFE prices available")
        return []
    return [_make_item(grades_usd, close, method)]
