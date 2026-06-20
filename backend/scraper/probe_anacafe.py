"""
Diagnostic probe: does a GitHub runner reach ANACAFE, and does the Guatemala
scraper return prices?

Pure diagnostic — no DB, no commits. Run via the "Probe: ANACAFE" workflow
(workflow_dispatch). It:
  1. Raw-fetches the ANACAFE endpoints (Precios / TasaCambio / calculator) to
     confirm egress + saves the bodies to debug/anacafe_probe/ as artifacts so
     the real structure can be inspected offline.
  2. Runs the actual Guatemala scraper (Playwright render + formula fallback)
     and prints the grade prices.

Exits non-zero if the scraper returns no prices, so the workflow run reflects
PASS/FAIL at a glance.
"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Make `scraper.*` importable when run as `python backend/scraper/probe_anacafe.py`.
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


def raw_probe() -> None:
    for name, url in ENDPOINTS.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body, status = r.read(), r.status
            (DEBUG / f"{name}.txt").write_bytes(body)
            preview = body[:200].decode("utf-8", "replace").replace("\n", " ")
            print(f"[raw] {name:11s} HTTP {status}  {len(body):>7} bytes  →  debug/anacafe_probe/{name}.txt")
            print(f"      preview: {preview}")
        except urllib.error.HTTPError as e:
            print(f"[raw] {name:11s} HTTPError {e.code} {e.reason}")
        except Exception as e:  # noqa: BLE001 — diagnostic
            print(f"[raw] {name:11s} {type(e).__name__}: {e}")


async def scraper_probe() -> dict | None:
    from playwright.async_api import async_playwright
    from scraper.sources import guatemala

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA)
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
    (DEBUG / "scraper_result.json").write_text(json.dumps(meta, indent=2))
    return meta


def main() -> None:
    print("=== RAW endpoint reachability (egress check) ===")
    raw_probe()
    print("\n=== Guatemala scraper (Playwright render + formula fallback) ===")
    meta = asyncio.run(scraper_probe())
    grades = (meta or {}).get("grades_usd_quintal") or {}
    method = meta.get("method") if meta else None
    print(f"\nRESULT: {'PASS' if grades else 'FAIL'} — {len(grades)} grades, method={method}")
    sys.exit(0 if grades else 1)


if __name__ == "__main__":
    main()
