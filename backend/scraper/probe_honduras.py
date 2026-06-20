"""
Diagnostic probe: what does preciocafehonduras.com actually serve?

The user found its data comes from a WordPress admin-ajax.php POST. This probe
renders the page in Chromium, captures every admin-ajax.php response body, and
dumps the full rendered visible text + every price-like number — so we can see
whether the site carries a genuine Honduras differential/farmgate price or just
the NY 'C' contract re-expressed in Lempiras/quintal.

Pure diagnostic — no DB, no commits. Run via the "Probe: Honduras" workflow
(workflow_dispatch). Saves the rendered HTML + captured XHR bodies as artifacts.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

DEBUG = Path("debug/honduras_probe")
DEBUG.mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

URL = "https://preciocafehonduras.com/"


async def probe() -> None:
    from bs4 import BeautifulSoup
    from playwright.async_api import async_playwright

    captured: list[tuple[int, str, str]] = []   # (status, url, body)

    async def _grab(resp) -> None:
        if "admin-ajax" in resp.url:
            try:
                body = await resp.text()
            except Exception as e:  # noqa: BLE001
                body = f"<body read failed: {e}>"
            captured.append((resp.status, resp.url, body))

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        page.on("response", lambda r: asyncio.create_task(_grab(r)))
        try:
            await page.goto(URL, wait_until="networkidle", timeout=45_000)
        except Exception as e:  # noqa: BLE001
            print(f"[probe] goto error: {e}")
        await page.wait_for_timeout(5_000)   # let the widget hydrate + poll

        html = await page.content()
        (DEBUG / "rendered.html").write_text(html, encoding="utf-8")
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        await ctx.close()
        await browser.close()

    print(f"\n=== admin-ajax responses captured: {len(captured)} ===")
    for i, (status, url, body) in enumerate(captured):
        (DEBUG / f"admin-ajax_{i}.txt").write_text(body, encoding="utf-8")
        print(f"\n[xhr {i}] HTTP {status}  {url}")
        print(body[:2000])

    print(f"\n=== rendered visible text ({len(text)} chars) ===")
    print(text[:4000])

    # Every price-like number (Lempira / USD / plain) with a little context.
    nums = list(re.finditer(r"(?:L|US?\$)?\s?[0-9][0-9,]*\.[0-9]{2}", text))
    print(f"\n=== {len(nums)} price-like numbers ===")
    for m in nums[:40]:
        s = m.start()
        print(f"  {m.group()!r}  ⟵  {text[max(0, s - 50):s]!r}")


if __name__ == "__main__":
    asyncio.run(probe())
