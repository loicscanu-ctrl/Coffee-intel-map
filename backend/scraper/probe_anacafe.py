"""
Diagnostic probe: does a GitHub runner reach ANACAFE, and can we read the
rendered quetzal grade prices off the calculator?

Pure diagnostic — no DB, no commits. Run via the "Probe: ANACAFE" workflow
(workflow_dispatch). It:
  1. Raw-fetches the ANACAFE endpoints (egress check) + saves bodies as artifacts.
  2. RENDER DIAGNOSTIC: loads the calculator in Chromium, polls while it hydrates,
     and prints the rendered DOM around each grade label + every quetzal-looking
     number — so the real structure is visible in the run logs (which we can read
     even when artifacts aren't downloadable). Saves the rendered HTML too.
  3. Runs the actual Guatemala scraper and prints the grade prices.

Exits non-zero only if the scraper returns no prices.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

DEBUG = Path("debug/anacafe_probe")
DEBUG.mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

ENDPOINTS = {
    "precios":    "https://whatsapp.anacafe.org/Comunes/Precios",
    "tasacambio": "https://whatsapp.anacafe.org/Comunes/TasaCambio",
    "calculator": "https://pro.anacafe.org/preciosReferencia/calculator/",
}
CALC_URL = ENDPOINTS["calculator"]


def raw_probe() -> None:
    for name, url in ENDPOINTS.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body, status = r.read(), r.status
            (DEBUG / f"{name}.txt").write_bytes(body)
            preview = body[:160].decode("utf-8", "replace").replace("\n", " ")
            print(f"[raw] {name:11s} HTTP {status}  {len(body):>7} bytes  preview: {preview}")
        except urllib.error.HTTPError as e:
            print(f"[raw] {name:11s} HTTPError {e.code} {e.reason}")
        except Exception as e:  # noqa: BLE001 — diagnostic
            print(f"[raw] {name:11s} {type(e).__name__}: {e}")


async def render_diag() -> None:
    """Render the calculator and print enough of the hydrated DOM to fix the parser."""
    from bs4 import BeautifulSoup
    from playwright.async_api import async_playwright

    from scraper.sources.guatemala import parse_rendered_grades

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-GT")
        page = await ctx.new_page()
        try:
            await page.goto(CALC_URL, wait_until="domcontentloaded", timeout=45_000)
        except Exception as e:  # noqa: BLE001
            print(f"[diag] goto error: {e}")

        html = ""
        for i in range(15):  # poll up to 15s while the SPA hydrates
            await page.wait_for_timeout(1_000)
            html = await page.content()
            low = html.lower()
            gtq, fx = parse_rendered_grades(html)
            print(f"[diag] t={i + 1:>2}s len={len(html):>6} parser_grades={len(gtq)} fx={fx} "
                  f"| lavado={'lavado' in low} quintal={'quintal' in low} "
                  f"oro={'café oro' in low or 'cafe oro' in low} "
                  f"Q#={'q1,' in low or 'q2,' in low} tipo={'tipo de cambio' in low}")
            if gtq and fx:
                break

        (DEBUG / "calculator_rendered.html").write_text(html, encoding="utf-8")
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        print(f"\n[diag] rendered visible text length: {len(text)}")

        # Context around the labels we care about — reveals the real markup shape.
        for tok in ["Prima", "lavado", "Duro", "Estrictamente", "Tipo de cambio", "quintal", "oro"]:
            idx = text.lower().find(tok.lower())
            print(f"[diag] text@'{tok}': "
                  + (repr(text[max(0, idx - 40):idx + 120]) if idx >= 0 else "NOT FOUND"))

        # Every quetzal-looking number in the rendered text, with a little context.
        nums = list(re.finditer(r"Q?\s?[0-9][0-9,]*\.[0-9]{2}", text))
        print(f"[diag] {len(nums)} price-like numbers in text:")
        for m in nums[:25]:
            s = m.start()
            print(f"        {m.group()!r}  ⟵  {text[max(0, s - 45):s]!r}")

        await ctx.close()
        await browser.close()


async def scraper_probe() -> dict | None:
    from playwright.async_api import async_playwright

    from scraper.sources import guatemala

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-GT")
        page = await ctx.new_page()
        try:
            items = await guatemala.run(page)
        finally:
            await ctx.close()
            await browser.close()

    if not items:
        print("[scraper] guatemala.run() returned NO items")
        return None
    meta = json.loads(items[0]["meta"])
    print(f"[scraper] body: {items[0]['body']}")
    print(f"[scraper] meta: {json.dumps(meta, indent=2)}")
    return meta


def main() -> None:
    print("=== RAW endpoint reachability (egress check) ===")
    raw_probe()
    print("\n=== RENDER DIAGNOSTIC (calculator DOM) ===")
    asyncio.run(render_diag())
    print("\n=== Guatemala scraper (render + formula fallback) ===")
    meta = asyncio.run(scraper_probe())
    grades = (meta or {}).get("grades_usd_quintal") or {}
    print(f"\nRESULT: {'PASS' if grades else 'FAIL'} — {len(grades)} grades, "
          f"method={meta.get('method') if meta else None}")
    sys.exit(0 if grades else 1)


if __name__ == "__main__":
    main()
