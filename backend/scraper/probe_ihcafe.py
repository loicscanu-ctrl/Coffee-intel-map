"""
Diagnostic probe (conclusive): does a recent (2024-2026) IHCAFE comercialización
bulletin exist at the predictable /wp-content/uploads path, and can we enumerate
bulletins from the Wayback CDX index?

Two independent checks:
  (A) Wayback CDX, queried correctly (matchType=domain + urlkey/original filters)
      → list every archived comercializacion PDF with timestamps.
  (B) Live wp-content date-probe over a wide window (last 240 days) for the plain
      naming, printing every 200/PDF hit. Includes a known-good 2023-02-07 URL as
      a mechanism sanity check.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

CDX = "https://web.archive.org/cdx/search/cdx"
KNOWN_GOOD = "https://www.ihcafe.hn/wp-content/uploads/2022/02/Boletin-Estadistico-Comercializacion-09-02-2022.pdf"


def cdx_query() -> None:
    queries = [
        f"{CDX}?url=ihcafe.hn&matchType=domain&collapse=urlkey&output=json&limit=2000"
        f"&filter=urlkey:.*comercializaci.*&filter=original:.*\\.pdf",
        f"{CDX}?url=ihcafe.hn&matchType=domain&collapse=urlkey&output=json&limit=2000"
        f"&filter=original:.*[Bb]oletin.*[Cc]omercializ.*",
        f"{CDX}?url=ihcafe.hn/wp-content/uploads&matchType=prefix&collapse=urlkey&output=json&limit=5",
    ]
    for q in queries:
        print(f"\n[cdx] {q}")
        try:
            req = urllib.request.Request(q, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                rows = json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001
            print(f"   failed: {type(e).__name__}: {e}")
            continue
        body = rows[1:] if rows else []
        print(f"   {len(body)} rows")
        recs = sorted(((row[1], row[2]) for row in body), reverse=True)
        for ts, u in recs[:15]:
            print(f"      {ts}  {u}")


async def date_probe(page) -> None:
    print("\n========== LIVE date-probe (last 240 days, plain name) ==========")
    # sanity check the mechanism on a known-good URL first
    try:
        resp = await page.request.get(KNOWN_GOOD, timeout=20_000)
        ok = resp.status == 200 and (await resp.body())[:4] == b"%PDF"
        print(f"   sanity known-2022: HTTP {resp.status} pdf={ok}")
    except Exception as e:  # noqa: BLE001
        print(f"   sanity known-2022 error: {type(e).__name__}: {e}")

    base = "https://www.ihcafe.hn/wp-content/uploads"
    hits = []
    today = date.today()
    for delta in range(0, 240):
        d = today - timedelta(days=delta)
        dd, mm, yyyy = f"{d.day:02d}", f"{d.month:02d}", d.year
        cands = [
            f"{base}/{yyyy}/{mm}/Boletin-Estadistico-Comercializacion-{dd}-{mm}-{yyyy}.pdf",
            f"{base}/{yyyy}/{mm}/Boletin-Estadistico-Comercializaci%C3%B3n-{dd}-{mm}-{yyyy}.pdf",
        ]
        for cand in cands:
            try:
                resp = await page.request.get(cand, timeout=12_000)
                if resp.status == 200 and (await resp.body())[:4] == b"%PDF":
                    print(f"   HIT  {cand}")
                    hits.append(cand)
            except Exception:  # noqa: BLE001
                pass
        if len(hits) >= 3:
            break
    print(f"   total live hits: {len(hits)}")


async def main() -> None:
    from playwright.async_api import async_playwright

    cdx_query()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        try:
            await page.goto("https://www.ihcafe.hn/", wait_until="domcontentloaded", timeout=40_000)
            await page.wait_for_timeout(4_000)
        except Exception as e:  # noqa: BLE001
            print(f"[warmup] {type(e).__name__}")
        await date_probe(page)
        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
