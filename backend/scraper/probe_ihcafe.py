"""
Diagnostic probe #10: find IHCAFE's bulletin index via XML SITEMAPS.

Rationale: every IHCAFE *HTML* page is Cloudflare-Turnstile-gated in headless CI,
and the WP REST API is locked — but XML sitemaps are built for crawlers and are
frequently served without the challenge. WordPress core emits /wp-sitemap.xml;
Yoast emits /sitemap_index.xml. They enumerate every published URL incl. the
mdocs document-library entries, which is where recent comercialización bulletins
live. Walk the sitemap index → child sitemaps → collect bulletin/mdocs/pdf URLs.

Bounded + line-buffered so it can never hang to the job timeout with no output.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/
try:
    sys.stdout.reconfigure(line_buffering=True)  # never lose output on a hang
except Exception:  # noqa: BLE001
    pass

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

BASE = "https://www.ihcafe.hn"
SITEMAP_SEEDS = [
    f"{BASE}/wp-sitemap.xml",
    f"{BASE}/sitemap_index.xml",
    f"{BASE}/sitemap.xml",
    f"{BASE}/wp-sitemap-posts-page-1.xml",
    f"{BASE}/mdocs-sitemap.xml",
]
HINT = re.compile(r"(boletin|comercializ|mdocs|\.pdf|publicacion|estadistic)", re.I)


async def fetch(page, url: str) -> tuple[int, str]:
    """request.get first (works for static assets); fall back to page.goto."""
    try:
        resp = await page.request.get(url, timeout=20_000)
        body = await resp.text()
        if resp.status == 200:
            return resp.status, body
        # Cloudflare-gated → try a real navigation
        nav = await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
        await page.wait_for_timeout(2_500)
        return (nav.status if nav else resp.status), await page.content()
    except Exception as e:  # noqa: BLE001
        return -1, f"<{type(e).__name__}: {e}>"


def locs(xml: str) -> list[str]:
    return re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml, re.I)


async def main() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        try:
            r = await page.goto(BASE + "/", wait_until="domcontentloaded", timeout=30_000)
            print(f"[warmup] homepage HTTP {r.status if r else '?'}")
            await page.wait_for_timeout(3_000)
        except Exception as e:  # noqa: BLE001
            print(f"[warmup] {type(e).__name__}")

        child_sitemaps: list[str] = []
        interesting: list[str] = []

        for seed in SITEMAP_SEEDS:
            st, body = await fetch(page, seed)
            ls = locs(body) if st == 200 else []
            print(f"\n[seed] {st}  {seed}  ({len(body)} bytes, {len(ls)} <loc>)")
            if st != 200:
                print(f"   head: {body[:160]!r}")
                continue
            for l in ls:
                if l.endswith(".xml"):
                    child_sitemaps.append(l)
                if HINT.search(l):
                    interesting.append(l)
            for l in ls[:20]:
                print(f"   loc: {l}")

        # walk child sitemaps (bounded)
        print(f"\n[walk] {len(child_sitemaps)} child sitemaps")
        for sm in child_sitemaps[:20]:
            st, body = await fetch(page, sm)
            ls = locs(body) if st == 200 else []
            hits = [l for l in ls if HINT.search(l)]
            print(f"   [{st}] {sm}  ({len(ls)} urls, {len(hits)} hits)")
            interesting.extend(hits)

        # report
        uniq = sorted(set(interesting), reverse=True)
        print(f"\n[result] {len(uniq)} interesting URLs (bulletin/mdocs/pdf):")
        for u in uniq[:40]:
            print(f"   {u}")

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=480))
