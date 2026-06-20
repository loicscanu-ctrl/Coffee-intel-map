"""
guatemala.py — Guatemala coffee reference prices (ANACAFE).

ANACAFE publishes daily "Precios de referencia locales" per quality grade, in
GTQ per quintal (100 lb) of café oro, at
https://pro.anacafe.org/preciosReferencia/calculator/ (a React app).

Primary path — RENDER: load the calculator and read the rendered
"Precio por quintal café oro" row directly. The page lays the grades out as a
header row (Prima lavado | Duro | Estrictamente duro) and a values row
(Q1,807.29 | Q1,853.01 | Q1,875.87), so we map the three quetzal values to the
grades by column order. This is the *true* published price — no assumptions.

Fallback — FORMULA: if the render doesn't yield the row, reconstruct it from the
NY 'C' close (Precios endpoint) and the USD→GTQ rate (TasaCambio endpoint) minus
ANACAFE's per-grade deduction: GTQ = (C_close − deduction) × rate.

NOTE: pro.anacafe.org / whatsapp.anacafe.org must be on the network egress
allowlist (works on the CI runner; this dev sandbox blocks them).
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
_TASA_URL    = "https://whatsapp.anacafe.org/Comunes/TasaCambio"

# café oro column order on the calculator → grade key.
_GRADE_KEYS = ["prima_lavado", "duro", "estrictamente_duro"]

# Fallback only: per-grade deduction vs the NY 'C' close, in US¢/lb
# (== USD per 100-lb quintal), reverse-engineered from ANACAFE's published
# prices. Used only when the render path fails.
_DEDUCTION_CENTS = {"prima_lavado": 37.91, "duro": 31.91, "estrictamente_duro": 28.91}


def parse_precios_close(result_text: str) -> float | None:
    """Front-position NY 'C' close from the Precios `result` blob. Requires a
    decimal so it skips the 'Ultimo Cierre: DD/MM/YYYY' date line."""
    m = re.search(r"Cierre:\s*(\d+\.\d+)", result_text or "")
    try:
        return float(m.group(1)) if m else None
    except ValueError:
        return None


def parse_rendered_grades(html: str) -> dict[str, float]:
    """Read the rendered 'Precio por quintal café oro' row → {grade: GTQ}.
    The three quetzal values are taken in column order (Prima / Duro / SHB)."""
    from bs4 import BeautifulSoup
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    m = re.search(r"caf[eé]\s+oro\s+((?:Q?\s?[\d,]+\.\d{2}\s*){3})", text, re.I)
    if not m:
        return {}
    nums = re.findall(r"[\d,]+\.\d{2}", m.group(1))
    if len(nums) < 3:
        return {}
    return {k: float(nums[i].replace(",", "")) for i, k in enumerate(_GRADE_KEYS)}


def _make_item(grades_gtq: dict[str, float], usd_gtq_rate: float | None,
               close: float | None, method: str) -> dict:
    pretty = ", ".join(f"{k.replace('_', ' ').title()} Q{v:,.2f}" for k, v in grades_gtq.items())
    return {
        "title":    f"Guatemala ANACAFE Precios de Referencia – {_today()}",
        "body":     (f"ANACAFE café oro reference prices (GTQ/quintal): {pretty}."
                     + (f" USD→GTQ {usd_gtq_rate}." if usd_gtq_rate else "")
                     + (f" NY 'C' {close:.2f}." if close is not None else "")
                     + f" [{method}]"),
        "source":   "ANACAFE",
        "category": "supply",
        "lat":      _LAT,
        "lng":      _LNG,
        "tags":     ["price", "guatemala", "anacafe", "arabica", "precio-referencia"],
        "meta":     json.dumps({
            "grades_gtq_quintal": grades_gtq,      # GTQ per 100-lb quintal (the published price)
            "usd_gtq_rate":       usd_gtq_rate,    # USD→GTQ (TasaCambio)
            "ny_c_close":         close,
            "as_of":              _today(),
            "method":             method,
            "source":             "ANACAFE",
        }),
    }


async def _get_json(page, url: str) -> dict | None:
    try:
        resp = await page.request.get(url, timeout=20_000)
        if resp.ok:
            return await resp.json()
    except Exception as e:  # noqa: BLE001
        print(f"[guatemala] {url} failed: {e}")
    return None


async def run(page) -> list[dict]:
    grades_gtq: dict[str, float] = {}
    method = ""

    # A) Render the calculator and read the café-oro row directly.
    try:
        await page.goto(_CALC_URL, wait_until="domcontentloaded", timeout=45_000)
        for _ in range(15):  # poll while the React app hydrates the prices
            await page.wait_for_timeout(1_000)
            grades_gtq = parse_rendered_grades(await page.content())
            if grades_gtq:
                break
        if grades_gtq:
            method = "rendered"
            print(f"[guatemala] scraped {len(grades_gtq)} café-oro grades from the calculator")
    except Exception as e:  # noqa: BLE001
        print(f"[guatemala] calculator render failed: {e}")

    # USD→GTQ rate (for the USD value) and the C close (reference + fallback).
    tasa = await _get_json(page, _TASA_URL)
    usd_gtq_rate = None
    if tasa and tasa.get("tasaCambioMember"):
        try:
            usd_gtq_rate = float(tasa["tasaCambioMember"])
        except (TypeError, ValueError):
            pass
    precios = await _get_json(page, _PRECIOS_URL)
    close = parse_precios_close((precios or {}).get("result", "")) if precios else None

    # B) Fallback: reconstruct the GTQ prices from the close + rate − deduction.
    if not grades_gtq and close is not None and usd_gtq_rate is not None:
        grades_gtq = {k: round((close - d) * usd_gtq_rate, 2) for k, d in _DEDUCTION_CENTS.items()}
        method = "computed"
        print("[guatemala] using computed café-oro grades ((C − deduction) × rate)")

    if not grades_gtq:
        print("[guatemala] no ANACAFE prices available")
        return []
    return [_make_item(grades_gtq, usd_gtq_rate, close, method)]
