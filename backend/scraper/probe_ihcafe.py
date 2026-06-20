"""
Diagnostic probe: pin down IHCAFE's weekly export-price bulletin + a way to
discover the latest one programmatically.

Findings so far:
  * The IHCAFE homepage shows only the NY 'C' close + FX (not a HN price).
  * The site sits behind Cloudflare Turnstile, so HTML page navigations are
    flaky — BUT direct wp-content/uploads/*.pdf assets download fine (HTTP 200).
  * The genuine "precio promedio de exportación por saco de 46 kg" lives inside
    the periodic "Boletín Estadístico de Comercialización" PDFs at
    https://www.ihcafe.hn/wp-content/uploads/YYYY/MM/Boletin-Estadistico-Comercializacion-DD-MM-YYYY.pdf

This probe:
  1. Queries the WordPress REST media API for the newest "Comercializacion"
     bulletin (programmatic discovery for the real scraper).
  2. Downloads the discovered bulletin + a couple of known ones and dumps their
     text + price-ish lines, so we can see exactly how the per-46kg price is
     written and build the parser.

Pure diagnostic — no DB, no commits. Run via the "Probe: IHCAFE" workflow.
"""
from __future__ import annotations

import asyncio
import io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

DEBUG = Path("debug/ihcafe_probe")
DEBUG.mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# WordPress REST endpoints to try for discovery (newest media first).
API_URLS = [
    "https://www.ihcafe.hn/wp-json/wp/v2/media?search=Comercializacion&per_page=20&orderby=date&order=desc",
    "https://www.ihcafe.hn/wp-json/wp/v2/media?search=Boletin&per_page=20&orderby=date&order=desc",
    "https://www.ihcafe.hn/wp-json/wp/v2/media?per_page=30&orderby=date&order=desc",
    "https://www.ihcafe.hn/wp-json/wp/v2/search?search=comercializacion&per_page=20",
]

# Known bulletins (confirmed to exist) — fallback so we can always see the layout.
KNOWN_BULLETINS = [
    "https://www.ihcafe.hn/wp-content/uploads/2023/02/Boletin-Estadistico-ComercializaciA%CC%83%C2%B3n-07-02-2023.pdf",
    "https://www.ihcafe.hn/wp-content/uploads/2022/02/Boletin-Estadistico-Comercializacion-09-02-2022.pdf",
    "https://www.ihcafe.hn/wp-content/uploads/2021/12/Boletin-Estadistico-Comercializacion-09-12-2021.pdf",
]

PRICE_HINT = re.compile(
    r"(precio|promedio|saco|46|export|referencia|diferencial|quintal|qq|US\$|valor)",
    re.I,
)


async def fetch(page, url: str, timeout=40_000):
    resp = await page.request.get(url, timeout=timeout)
    return resp


async def discover(page) -> list[str]:
    """Hit the WP REST API; return any bulletin PDF source_urls found, newest first."""
    found: list[str] = []
    for url in API_URLS:
        print(f"\n[api] GET {url}")
        try:
            resp = await fetch(page, url)
            print(f"   HTTP {resp.status}  {resp.headers.get('content-type','')}")
            if resp.status != 200:
                body = (await resp.text())[:300]
                print(f"   body[:300]: {body!r}")
                continue
            data = json.loads(await resp.text())
        except Exception as e:  # noqa: BLE001
            print(f"   failed: {type(e).__name__}: {e}")
            continue

        items = data if isinstance(data, list) else data.get("items", data)
        if not isinstance(items, list):
            print(f"   unexpected JSON shape: {str(data)[:200]}")
            continue
        print(f"   {len(items)} items")
        for it in items:
            src = it.get("source_url") or it.get("url") or it.get("link") or ""
            title = it.get("title")
            if isinstance(title, dict):
                title = title.get("rendered", "")
            date = it.get("date") or it.get("modified") or ""
            if src.lower().endswith(".pdf") or "comercializ" in (src + str(title)).lower():
                print(f"      {date}  {src}   «{str(title)[:60]}»")
                if src.lower().endswith(".pdf"):
                    found.append(src)
    return found


async def parse_pdf(page, url: str) -> None:
    import pdfplumber
    print(f"\n[pdf] download {url}")
    try:
        resp = await fetch(page, url)
        content = await resp.body()
        print(f"   HTTP {resp.status}  {len(content)} bytes  {resp.headers.get('content-type','')}")
        if content[:4] != b"%PDF":
            print(f"   not a PDF (starts {content[:16]!r})")
            return
        fn = re.sub(r"[^0-9A-Za-z]+", "_", url)[-48:]
        (DEBUG / f"{fn}.pdf").write_bytes(content)
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        print(f"   pages parsed; {len(text)} chars")
        print("   === price-ish lines ===")
        for ln in text.splitlines():
            s = ln.strip()
            if PRICE_HINT.search(s) and re.search(r"\d", s):
                print(f"      {s[:170]}")
    except Exception as e:  # noqa: BLE001
        print(f"   fetch/parse failed: {type(e).__name__}: {e}")


async def main() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        # Visit homepage first to pick up any Cloudflare clearance cookie.
        try:
            await page.goto("https://www.ihcafe.hn/", wait_until="domcontentloaded", timeout=45_000)
            await page.wait_for_timeout(5_000)
        except Exception as e:  # noqa: BLE001
            print(f"[probe] homepage goto: {type(e).__name__}: {e}")

        discovered = await discover(page)
        print(f"\n[probe] discovered {len(discovered)} bulletin PDFs via API")

        # Parse the newest discovered bulletin (if any), else the known ones.
        targets = (discovered[:1] or []) + KNOWN_BULLETINS
        seen = set()
        for url in targets:
            if url in seen:
                continue
            seen.add(url)
            await parse_pdf(page, url)

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
