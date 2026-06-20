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
    "https://ihcafe.hn/comercializacion-de-cafe/",
    "https://www.ihcafe.hn/mdocuments-library/?mdocs-cat=mdocs-cat-2",
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

    candidates: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()

        for url in INDEX_URLS:
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                await page.wait_for_timeout(4_000)
                html = await page.content()
            except Exception as e:  # noqa: BLE001
                print(f"[probe] {url} → {type(e).__name__}: {e}")
                continue
            anchors = BeautifulSoup(html, "html.parser").find_all("a", href=True)
            print(f"\n[probe] {url}  ({len(anchors)} links)")
            for a in anchors:
                h = a["href"]
                txt = a.get_text(" ", strip=True)[:80]
                if "mdocs-file" in h or ".pdf" in h.lower() or "comercializ" in (h + txt).lower():
                    print(f"   {h}   «{txt}»")
                    if "mdocs-file" in h or ".pdf" in h.lower():
                        candidates.append(h if h.startswith("http") else "https://ihcafe.hn" + h)

        # de-dup, keep order; always include the known recent doc.
        seen, ordered = set(), []
        for h in ["https://ihcafe.hn/?mdocs-file=6940", *candidates]:
            if h not in seen:
                seen.add(h); ordered.append(h)

        import pdfplumber
        for url in ordered[:4]:
            print(f"\n[probe] download {url}")
            try:
                resp = await page.request.get(url, timeout=40_000)
                content = await resp.body()
                ctype = resp.headers.get("content-type", "")
                print(f"   HTTP {resp.status}  {len(content)} bytes  {ctype}")
                if content[:4] != b"%PDF":
                    print(f"   not a PDF (starts {content[:16]!r}) — skipping parse")
                    continue
                fn = re.sub(r"[^0-9a-zA-Z]+", "_", url)[-40:]
                (DEBUG / f"{fn}.pdf").write_bytes(content)
                with pdfplumber.open(io.BytesIO(content)) as pdf:
                    text = "\n".join((p.extract_text() or "") for p in pdf.pages[:4])
                print(f"   === PDF TEXT (first 2500 of {len(text)}) ===")
                print(text[:2500])
                print("   === price-ish lines ===")
                for ln in text.splitlines():
                    if re.search(r"(precio|saco|46|export|US\$|\$|qq|quintal)", ln, re.I) and re.search(r"\d", ln):
                        print("     ", ln.strip()[:160])
            except Exception as e:  # noqa: BLE001
                print(f"   fetch/parse failed: {type(e).__name__}: {e}")

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
