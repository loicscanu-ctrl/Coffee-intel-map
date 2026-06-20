"""
Diagnostic probe #11: walk the WORKING sitemap (www host, request.get only).

Run #10 found: https://www.ihcafe.hn/sitemap.xml → 200 (static XML, NOT gated),
a Google-XML-Sitemaps index listing child sitemaps:
    sitemap-misc.xml | page-sitemap.xml | archives-sitemap.xml
The children 403'd only because they were on the non-www host and we fell back
to page.goto. Static XML via request.get on the www host is NOT gated, so rewrite
every sitemap URL to www and fetch with request.get only. Dump child bodies +
every <loc>, and surface any bulletin/comercializacion/mdocs/pdf URL.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:  # noqa: BLE001
    pass

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

BASE = "https://www.ihcafe.hn"
HINT = re.compile(r"(boletin|comercializ|mdocs|\.pdf)", re.I)


def www(u: str) -> str:
    u = u.strip()
    if u.startswith("http://"):
        u = "https://" + u[7:]
    return u.replace("://ihcafe.hn", "://www.ihcafe.hn")


async def get(page, url: str) -> tuple[int, str]:
    try:
        resp = await page.request.get(www(url), timeout=20_000)
        return resp.status, await resp.text()
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

        st, body = await get(page, f"{BASE}/sitemap.xml")
        children = locs(body)
        print(f"[index] {st}  sitemap.xml  → {len(children)} children: {children}")

        all_hits: list[str] = []
        # also peek at the misc sitemap's raw body to learn the plugin layout
        for child in children:
            st, body = await get(page, child)
            ls = locs(body)
            hits = [l for l in ls if HINT.search(l)]
            all_hits += hits
            print(f"\n[child] {st}  {www(child)}  ({len(body)} bytes, {len(ls)} locs, {len(hits)} hits)")
            if st != 200:
                print(f"   head: {body[:140]!r}")
                continue
            # print newest-looking 25 locs so we see structure + any CPT sitemaps
            for l in ls[:25]:
                print(f"   {l}")
            # any nested sitemaps?
            nested = [l for l in ls if l.endswith(".xml")]
            for sm in nested[:10]:
                st2, body2 = await get(page, sm)
                ls2 = locs(body2)
                h2 = [l for l in ls2 if HINT.search(l)]
                all_hits += h2
                print(f"   [nested] {st2} {www(sm)}  ({len(ls2)} locs, {len(h2)} hits)")
                for l in h2[:15]:
                    print(f"        {l}")

        uniq = sorted(set(all_hits), reverse=True)
        print(f"\n[RESULT] {len(uniq)} bulletin/comercializ/mdocs/pdf URLs:")
        for u in uniq[:50]:
            print(f"   {u}")

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=420))
