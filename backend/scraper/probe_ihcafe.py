"""
Diagnostic probe: how to DISCOVER IHCAFE's latest comercialización bulletin.

Confirmed already (run #4):
  * The bulletin PDFs download fine (HTTP 200, application/pdf) directly from
    https://www.ihcafe.hn/wp-content/uploads/YYYY/MM/Boletin-Estadistico-Comercializacion-DD-MM-YYYY.pdf
    (NOT Turnstile-gated) and parse cleanly with pdfplumber.
  * They carry the line "El precio promedio de exportación por saco de 46kg a la
    fecha es de $NNN.NN" plus a structured "Exportaciones ... Precio Prom. US$"
    table row — the genuine Honduras export price per 46 kg sack.
  * The WP REST API (/wp-json/wp/v2/media) is locked (HTTP 401).

This probe tests the two remaining discovery strategies so we can pick one:
  (A) Scan likely IHCAFE index/landing pages (domcontentloaded) and collect any
      wp-content/uploads/*Comercializ*.pdf links.
  (B) Date-probe recent filenames newest-first (last ~28 days, two name styles)
      and report which URLs resolve to a real PDF.

Pure diagnostic — no DB, no commits. Run via the "Probe: IHCAFE" workflow.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

BASE = "https://www.ihcafe.hn"

INDEX_PAGES = [
    "https://www.ihcafe.hn/",
    "https://www.ihcafe.hn/comercializacion-de-cafe/",
    "https://www.ihcafe.hn/estadisticas/",
    "https://www.ihcafe.hn/estadisticas-cafe/",
    "https://www.ihcafe.hn/publicaciones/",
    "https://www.ihcafe.hn/boletines/",
    "https://www.ihcafe.hn/sala-de-prensa/",
    "https://www.ihcafe.hn/category/boletines/",
]


def candidate_urls(d: date) -> list[str]:
    dd, mm, yyyy = f"{d.day:02d}", f"{d.month:02d}", d.year
    folder = f"{BASE}/wp-content/uploads/{yyyy}/{mm}"
    stems = [
        f"Boletin-Estadistico-Comercializacion-{dd}-{mm}-{yyyy}",
        f"Boletin-Estadistico-Comercializaci{quote('ó')}n-{dd}-{mm}-{yyyy}",  # %C3%B3
        f"Boletin-Estadistico-de-Comercializacion-{dd}-{mm}-{yyyy}",
    ]
    return [f"{folder}/{s}.pdf" for s in stems]


async def main() -> None:
    from bs4 import BeautifulSoup
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        try:
            await page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45_000)
            await page.wait_for_timeout(4_000)
        except Exception as e:  # noqa: BLE001
            print(f"[probe] homepage warmup: {type(e).__name__}: {e}")

        # ---- (A) index-page scan -------------------------------------------
        print("\n========== (A) INDEX-PAGE SCAN ==========")
        for url in INDEX_PAGES:
            try:
                resp = await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                status = resp.status if resp else "?"
                await page.wait_for_timeout(2_500)
                html = await page.content()
            except Exception as e:  # noqa: BLE001
                print(f"  {url} → {type(e).__name__}")
                continue
            soup = BeautifulSoup(html, "html.parser")
            hits = []
            for a in soup.find_all("a", href=True):
                h = a["href"]
                if "comercializ" in h.lower() and h.lower().endswith(".pdf"):
                    hits.append((h, a.get_text(" ", strip=True)[:50]))
                elif "wp-content/uploads" in h and h.lower().endswith(".pdf") and "boletin" in h.lower():
                    hits.append((h, a.get_text(" ", strip=True)[:50]))
            print(f"  [{status}] {url}  → {len(hits)} bulletin links")
            for h, t in hits[:8]:
                print(f"        {h}   «{t}»")

        # ---- (B) date-probe newest-first -----------------------------------
        print("\n========== (B) DATE-PROBE (newest first, last 28 days) ==========")
        today = date.today()
        found = []
        for delta in range(0, 28):
            d = today - timedelta(days=delta)
            for url in candidate_urls(d):
                try:
                    resp = await page.request.head(url, timeout=15_000)
                    st = resp.status
                    ctype = resp.headers.get("content-type", "")
                    if st == 200 and ("pdf" in ctype or url.endswith(".pdf")):
                        print(f"  HIT  {st}  {ctype}  {url}")
                        found.append(url)
                    elif st not in (403, 404):
                        print(f"  ?    {st}  {ctype}  {url}")
                except Exception as e:  # noqa: BLE001
                    print(f"  err  {type(e).__name__}  {url}")
            if found:
                break  # newest found; stop
        print(f"\n[probe] date-probe found {len(found)} URL(s): {found}")

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
