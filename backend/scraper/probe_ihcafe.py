"""
Diagnostic probe: locate IHCAFE's "Boletín Estadístico de Comercialización" and
read its export-price structure.

IHCAFE publishes the average export price (per 46 kg sack) in periodic PDFs named
`Boletin-Estadistico-Comercializacion-DD-MM-YYYY.pdf` under wp-content/uploads,
indexed by a WordPress document library. This probe renders the candidate index
pages, enumerates the bulletin PDF links, downloads the most recent one, and
dumps its text — so we can see exactly how the price is written and build the
real Honduras scraper.

Pure diagnostic — no DB, no commits. Run via the "Probe: IHCAFE" workflow.
"""
from __future__ import annotations

import asyncio
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

DEBUG = Path("debug/ihcafe_probe")
DEBUG.mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

INDEX_URLS = [
    "https://www.ihcafe.hn/mdocuments-library/?mdocs-cat=mdocs-cat-2",
    "https://www.ihcafe.hn/mdocuments-library-2/",
    "https://www.ihcafe.hn/publicaciones/",
    "https://ihcafe.hn/exportaciones/",
    "https://www.ihcafe.hn/",
]


def _date_key(url: str):
    m = re.search(r"/(\d{4})/(\d{2})/", url)        # wp-content/uploads/YYYY/MM/
    d = re.search(r"(\d{2})-(\d{2})-(\d{4})", url)   # ...-DD-MM-YYYY.pdf
    return (
        d.group(3) if d else (m.group(1) if m else "0000"),
        d.group(2) if d else (m.group(2) if m else "00"),
        d.group(1) if d else "00",
    )


async def main() -> None:
    from bs4 import BeautifulSoup
    from playwright.async_api import async_playwright

    all_links: set[str] = set()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()

        for url in INDEX_URLS:
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                await page.wait_for_timeout(2_500)
                html = await page.content()
            except Exception as e:  # noqa: BLE001
                print(f"[probe] {url} → {type(e).__name__}: {e}")
                continue
            links = [a.get("href") for a in BeautifulSoup(html, "html.parser").find_all("a", href=True)]
            cand = sorted({h for h in links if h and (".pdf" in h.lower()
                          or "mdocs-file" in h or "comercializ" in h.lower())})
            print(f"\n[probe] {url}\n        {len(links)} links, {len(cand)} candidate price/doc links")
            for h in cand[:30]:
                print("   ", h)
            all_links.update(cand)

        bols = [h for h in all_links if "comercializ" in h.lower() and ".pdf" in h.lower()]
        bols.sort(key=_date_key, reverse=True)
        print(f"\n[probe] {len(bols)} 'Comercializacion' bulletin PDFs found:")
        for h in bols[:12]:
            print("   BOL", h)

        if bols:
            pdf_url = bols[0] if bols[0].startswith("http") else "https://www.ihcafe.hn" + bols[0]
            print(f"\n[probe] downloading latest bulletin: {pdf_url}")
            try:
                resp = await page.request.get(pdf_url, timeout=40_000)
                content = await resp.body()
                (DEBUG / "latest_boletin.pdf").write_bytes(content)
                print(f"[probe] PDF {len(content)} bytes (HTTP {resp.status})")
                import pdfplumber
                with pdfplumber.open(io.BytesIO(content)) as pdf:
                    text = "\n".join((p.extract_text() or "") for p in pdf.pages[:4])
                (DEBUG / "latest_boletin.txt").write_text(text, encoding="utf-8")
                print(f"\n=== BULLETIN TEXT (first 3500 chars of {len(text)}) ===")
                print(text[:3500])
                # Lines that look like a price (saco / 46 / $ / precio).
                print("\n=== price-ish lines ===")
                for ln in text.splitlines():
                    if re.search(r"(precio|saco|46|export|US\$|\$|qq|quintal)", ln, re.I) and re.search(r"\d", ln):
                        print("   ", ln.strip()[:160])
            except Exception as e:  # noqa: BLE001
                print(f"[probe] PDF fetch/parse failed: {type(e).__name__}: {e}")
        else:
            print("[probe] no comercializacion bulletin PDF link found on the index pages")

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
