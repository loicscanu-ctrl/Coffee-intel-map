"""
Diagnostic probe (final discovery): use page.goto (which clears Cloudflare
Turnstile — run #6 proved homepage goto → HTTP 200) to RENDER the IHCAFE listing
pages and harvest the newest comercialización bulletin link.

Recap of what we know:
  * Static /wp-content/uploads/*.pdf GET fine (200) and parse — the bulletin
    carries "El precio promedio de exportación por saco de 46kg ... es de $NNN".
  * HTML routes are Turnstile-gated for request.get (403) but OK for page.goto.
  * WP REST API is locked (401).

This run renders the likely listing pages and dumps every bulletin/mdocs/pdf
link + a slice of visible text, so we can see exactly where the latest bulletin
is linked and build discovery on it.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

LISTING_PAGES = [
    "https://www.ihcafe.hn/publicaciones/",
    "https://www.ihcafe.hn/mdocuments-library/?mdocs-cat=mdocs-cat-2",
    "https://ihcafe.hn/comercializacion-de-cafe/",
    "https://www.ihcafe.hn/estadisticas-de-comercializacion/",
    "https://www.ihcafe.hn/category/comercializacion/",
]

LINK_HINT = re.compile(r"(boletin|comercializ|mdocs-file|\.pdf)", re.I)


async def render(page, url: str) -> None:
    print(f"\n{'=' * 66}\n[goto] {url}")
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=40_000)
        st = resp.status if resp else "?"
    except Exception as e:  # noqa: BLE001
        print(f"   goto error: {type(e).__name__}: {e}")
        return
    await page.wait_for_timeout(6_000)  # let any mdocs JS render
    try:
        html = await page.content()
    except Exception as e:  # noqa: BLE001
        print(f"   content error: {e}")
        return

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    anchors = soup.find_all("a", href=True)
    hits = [(a["href"], a.get_text(" ", strip=True)[:70]) for a in anchors if LINK_HINT.search(a["href"] + " " + a.get_text(" ", strip=True))]
    print(f"   HTTP {st}  ({len(anchors)} links, {len(hits)} candidate)")
    for h, t in hits[:25]:
        print(f"      {h}   «{t}»")
    # also raw-scan the HTML for bulletin pdf URLs not in anchors
    raw = set(re.findall(r'https?://[^\s"\'<>]*?[Bb]oletin[^\s"\'<>]*?\.pdf', html))
    raw |= set(re.findall(r'wp-content/uploads/20\d\d/\d\d/[^\s"\'<>]*?\.pdf', html))
    extra = [r for r in raw if not any(r in h for h, _ in hits)]
    if extra:
        print("   --- raw HTML pdf URLs ---")
        for r in sorted(extra)[:25]:
            print(f"      {r}")
    text = soup.get_text(" ", strip=True)
    print(f"   --- visible text[:600] ---\n   {text[:600]}")


async def main() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        # warm up Turnstile
        try:
            r = await page.goto("https://www.ihcafe.hn/", wait_until="domcontentloaded", timeout=40_000)
            print(f"[warmup] homepage HTTP {r.status if r else '?'}")
            await page.wait_for_timeout(5_000)
        except Exception as e:  # noqa: BLE001
            print(f"[warmup] {type(e).__name__}")

        for url in LISTING_PAGES:
            await render(page, url)

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
