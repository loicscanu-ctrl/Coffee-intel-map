"""
Diagnostic probe (decisive): nail down how to DISCOVER the latest IHCAFE
comercialización bulletin, working around intermittent Cloudflare Turnstile.

Known good:
  * page.request.get() on a wp-content/uploads/*.pdf returns 200 + real PDF
    (proven run #4) and parses with pdfplumber; carries "El precio promedio de
    exportación por saco de 46kg ... es de $NNN.NN".
Open questions this run answers:
  1. Does request.get() on the HTML index pages (/publicaciones/,
     /comercializacion-de-cafe/) return usable HTML with bulletin links?
  2. Date-probe via GET (not HEAD): for each candidate, what status do we get
     (403 = Cloudflare, 404 = no such file, 200 = bulletin)? → reveals the real
     current filename + whether date-probing is viable.

Pure diagnostic — no DB, no commits.
"""
from __future__ import annotations

import asyncio
import re
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

BASE = "https://www.ihcafe.hn"
HTML_PAGES = [f"{BASE}/publicaciones/", f"{BASE}/comercializacion-de-cafe/", f"{BASE}/"]


def candidate_urls(d: date) -> list[str]:
    dd, mm, yyyy = f"{d.day:02d}", f"{d.month:02d}", d.year
    folder = f"{BASE}/wp-content/uploads/{yyyy}/{mm}"
    stems = [
        f"Boletin-Estadistico-Comercializacion-{dd}-{mm}-{yyyy}",
        f"Boletin-Estadistico-Comercializaci{quote('ó')}n-{dd}-{mm}-{yyyy}",
        f"Boletin-Estadistico-de-Comercializacion-{dd}-{mm}-{yyyy}",
        f"Boletin-Comercializacion-{dd}-{mm}-{yyyy}",
    ]
    return [f"{folder}/{s}.pdf" for s in stems]


async def warmup(page) -> None:
    """Try to clear Cloudflare Turnstile by loading the homepage a few times."""
    for attempt in range(4):
        try:
            resp = await page.goto(BASE + "/", wait_until="domcontentloaded", timeout=30_000)
            st = resp.status if resp else "?"
            print(f"[warmup {attempt}] homepage HTTP {st}")
            await page.wait_for_timeout(5_000)
            if st == 200:
                return
        except Exception as e:  # noqa: BLE001
            print(f"[warmup {attempt}] {type(e).__name__}")
        await page.wait_for_timeout(3_000)


async def main() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        await warmup(page)

        # ---- (1) request.get the HTML index pages, harvest bulletin links ----
        print("\n========== (1) request.get HTML PAGES ==========")
        for url in HTML_PAGES:
            try:
                resp = await page.request.get(url, timeout=30_000)
                body = await resp.text()
                print(f"  [{resp.status}] {url}  ({len(body)} bytes)")
                links = set(re.findall(r'https?://[^\s"\'<>]*?[Bb]oletin[^\s"\'<>]*?\.pdf', body))
                links |= set(re.findall(r'https?://[^\s"\'<>]*?[Cc]omercializ[^\s"\'<>]*?\.pdf', body))
                for l in sorted(links)[:15]:
                    print(f"        {l}")
                if resp.status == 200 and not links:
                    # show any mdocs-file refs as a fallback discovery hook
                    mdocs = set(re.findall(r'mdocs-file=\d+', body))
                    print(f"        (no pdf links; mdocs refs: {sorted(mdocs)[:10]})")
            except Exception as e:  # noqa: BLE001
                print(f"  ERR {type(e).__name__} {url}")

        # ---- (2) date-probe via GET, print real statuses --------------------
        print("\n========== (2) DATE-PROBE via GET (newest first) ==========")
        today = date.today()
        found = []
        for delta in range(0, 21):
            d = today - timedelta(days=delta)
            for url in candidate_urls(d):
                try:
                    resp = await page.request.get(url, timeout=20_000)
                    st = resp.status
                    if st == 200:
                        body = await resp.body()
                        is_pdf = body[:4] == b"%PDF"
                        print(f"  {st} {'PDF' if is_pdf else body[:8]!r}  {url}")
                        if is_pdf:
                            found.append(url)
                    elif st != 404:
                        print(f"  {st}  {url}")
                except Exception as e:  # noqa: BLE001
                    print(f"  ERR {type(e).__name__}  {url}")
            if found:
                break
        print(f"\n[probe] date-probe found: {found}")

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
